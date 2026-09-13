import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { subscribeToCollectionActiveContext, subscribeToCollectionHistory } from '@/lib/collectionService';

describe('subscribeToCollectionHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escuta INSERT e UPDATE e filtra pelo ID canônico da célula', () => {
    const callback = vi.fn();
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(() => channel),
    };
    channel.on.mockReturnValue(channel);
    vi.spyOn(supabase, 'channel').mockReturnValue(channel);

    subscribeToCollectionHistory({
      cellId: 'cell-joinery',
      cellName: 'Marcenaria ',
      callback,
    });

    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        table: 'production_collection_events',
        filter: 'cell_id=eq.cell-joinery',
      }),
      callback,
    );
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeToCollectionActiveContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filtra INSERT/UPDATE pela célula, não assina DELETE global e confirma o listener de CDC', () => {
    const callback = vi.fn();
    const onReady = vi.fn();
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(() => channel),
    };
    channel.on.mockReturnValue(channel);
    vi.spyOn(supabase, 'channel').mockReturnValue(channel);

    subscribeToCollectionActiveContext({
      cellId: 'cell-cut',
      cellName: 'Corte',
      callback,
      onReady,
    });

    expect(channel.on).toHaveBeenCalledTimes(3);
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        table: 'production_cell_active_contexts',
        filter: 'cell_id=eq.cell-cut',
      }),
      callback,
    );
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'UPDATE',
        table: 'production_cell_active_contexts',
        filter: 'cell_id=eq.cell-cut',
      }),
      callback,
    );
    expect(channel.on).not.toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ event: 'DELETE' }),
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith('system', {}, expect.any(Function));
    expect(Math.max(...channel.on.mock.invocationCallOrder))
      .toBeLessThan(channel.subscribe.mock.invocationCallOrder[0]);

    const systemCallback = channel.on.mock.calls.find(([type]) => type === 'system')[2];
    systemCallback({ extension: 'presence', status: 'ok' });
    systemCallback({ extension: 'postgres_changes', status: 'error' });
    expect(onReady).not.toHaveBeenCalled();

    const readyPayload = { extension: 'postgres_changes', status: 'ok' };
    systemCallback(readyPayload);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(readyPayload);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });
});

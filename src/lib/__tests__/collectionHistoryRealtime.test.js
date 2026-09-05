import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { subscribeToCollectionHistory } from '@/lib/collectionService';

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

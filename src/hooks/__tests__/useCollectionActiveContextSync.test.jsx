import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTION_CONTEXT_SAFETY_MIN_MS,
  useCollectionActiveContextSync,
} from '@/hooks/useCollectionActiveContextSync';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock('@/lib/collectionService', () => ({
  subscribeToCollectionActiveContext: mocks.subscribe,
  unsubscribeFromCollectionActiveContext: mocks.unsubscribe,
}));

vi.mock('@/hooks/collectionQueryInvalidation', () => ({
  scheduleCollectionQueryInvalidation: mocks.schedule,
}));

describe('useCollectionActiveContextSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribe.mockReturnValue({ topic: 'active-context' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aplica a troca da máquina ativa e invalida somente collection-kpis', () => {
    const queryClient = {};
    const { result } = renderHook(() => useCollectionActiveContextSync({
      cellId: 'cell-1',
      cellName: 'Corte',
      machineId: 'machine-1',
      queryClient,
    }));
    const subscription = mocks.subscribe.mock.calls[0][0];
    const context = {
      cell_id: 'cell-1',
      machine_id: 'machine-1',
      active_general_lot_code: 'GER-002',
      active_lot_code: 'CLI-002',
    };

    act(() => subscription.callback({ eventType: 'UPDATE', new: context }));

    expect(result.current).toMatchObject({
      activeContext: context,
      hasRealtimeUpdate: true,
      preferSnapshot: true,
    });
    expect(mocks.schedule).toHaveBeenCalledOnce();
    const filter = mocks.schedule.mock.calls[0][1];
    expect(filter.predicate({ queryKey: ['collection-kpis', 'Corte', 'machine-1'] })).toBe(true);
    expect(filter.predicate({ queryKey: ['stageReadings', 'Corte', 'machine-1'] })).toBe(false);
    expect(filter.predicate({ queryKey: ['collection-kpis', 'Bordo', 'machine-1'] })).toBe(false);
  });

  it('ignora outra máquina, confirma o snapshot ao assinar e permite devolver prioridade à leitura local', () => {
    const queryClient = {};
    const { result } = renderHook(() => useCollectionActiveContextSync({
      cellId: 'cell-1',
      cellName: 'Corte',
      machineId: 'machine-1',
      queryClient,
    }));
    const subscription = mocks.subscribe.mock.calls[0][0];

    act(() => subscription.callback({
      eventType: 'UPDATE',
      new: { machine_id: 'machine-2', active_lot_code: 'OUTRA' },
    }));
    expect(result.current.hasRealtimeUpdate).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();

    act(() => subscription.onStatus('SUBSCRIBED'));
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(result.current.preferSnapshot).toBe(true);

    act(() => subscription.callback({
      eventType: 'UPDATE',
      new: { machine_id: 'machine-1', active_lot_code: 'CLI-002' },
    }));
    expect(result.current.hasRealtimeUpdate).toBe(true);
    act(() => subscription.onStatus('SUBSCRIBED'));
    expect(result.current.hasRealtimeUpdate).toBe(false);

    act(() => subscription.callback({
      eventType: 'UPDATE',
      new: { machine_id: 'machine-1', active_lot_code: 'CLI-003' },
    }));
    expect(result.current.hasRealtimeUpdate).toBe(true);
    act(() => result.current.resetRealtimeUpdate());
    expect(result.current.hasRealtimeUpdate).toBe(false);
    expect(result.current.preferSnapshot).toBe(false);
  });

  it('na confirmação do listener remove o overlay e reconcilia o snapshot autoritativo', () => {
    const queryClient = {};
    const { result } = renderHook(() => useCollectionActiveContextSync({
      cellId: 'cell-1',
      cellName: 'Corte',
      machineId: 'machine-1',
      queryClient,
    }));
    const subscription = mocks.subscribe.mock.calls[0][0];
    const context = {
      cell_id: 'cell-1',
      machine_id: 'machine-1',
      active_general_lot_code: 'GER-002',
      active_lot_code: 'CLI-002',
    };

    act(() => subscription.callback({ eventType: 'UPDATE', new: context }));
    expect(result.current).toMatchObject({
      activeContext: context,
      hasRealtimeUpdate: true,
    });

    mocks.schedule.mockClear();
    act(() => subscription.onReady({ extension: 'postgres_changes', status: 'ok' }));

    expect(result.current.activeContext).toBeNull();
    expect(result.current.hasRealtimeUpdate).toBe(false);
    expect(result.current.preferSnapshot).toBe(true);
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });

  it('revalida o snapshot em erro, retomada da tela e reconciliação de segurança', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const queryClient = {};
    const { result, unmount } = renderHook(() => useCollectionActiveContextSync({
      cellId: 'cell-1',
      cellName: 'Corte',
      machineId: 'machine-1',
      queryClient,
    }));
    const subscription = mocks.subscribe.mock.calls[0][0];

    act(() => subscription.onStatus('CHANNEL_ERROR'));
    expect(result.current.preferSnapshot).toBe(true);
    expect(mocks.schedule).toHaveBeenCalledOnce();

    mocks.schedule.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    expect(mocks.schedule).toHaveBeenCalledOnce();

    mocks.schedule.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLECTION_CONTEXT_SAFETY_MIN_MS);
    });
    expect(mocks.schedule).toHaveBeenCalledOnce();

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledWith({ topic: 'active-context' });
  });
});

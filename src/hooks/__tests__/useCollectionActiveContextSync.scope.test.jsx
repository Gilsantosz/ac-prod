import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionActiveContextSync } from '@/hooks/useCollectionActiveContextSync';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(), unsubscribe: vi.fn(), schedule: vi.fn(),
}));
vi.mock('@/lib/collectionService', () => ({
  subscribeToCollectionActiveContext: mocks.subscribe,
  unsubscribeFromCollectionActiveContext: mocks.unsubscribe,
}));
vi.mock('@/hooks/collectionQueryInvalidation', () => ({
  scheduleCollectionQueryInvalidation: mocks.schedule,
}));
const scope = { realtimeEnabled: true, cellId: 'cell-1', cellName: 'Corte', machineId: 'machine-1' };

describe('regressões do contexto entre postos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribe.mockReturnValue({ topic: 'active-context' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('linha geral atrasada não sobrescreve o lote da máquina nem agenda consulta', () => {
    const queryClient = {};
    const { result, unmount } = renderHook(() => useCollectionActiveContextSync({ ...scope, queryClient }));
    const subscription = mocks.subscribe.mock.calls[0][0];
    const correctContext = { machine_id: 'machine-1', active_lot_code: 'LOTE-ATUAL' };
    act(() => subscription.callback({ new: correctContext }));
    mocks.schedule.mockClear();
    act(() => subscription.callback({ new: { machine_id: null, active_lot_code: 'LOTE-ANTIGO' } }));
    expect(result.current.activeContext).toEqual(correctContext);
    expect(result.current.hasRealtimeUpdate).toBe(true);
    expect(mocks.schedule).not.toHaveBeenCalled();
    unmount();
  });

  it('preserva acompanhamento da célula quando não há máquina selecionada', () => {
    const queryClient = {};
    const { result, unmount } = renderHook(() => useCollectionActiveContextSync({ ...scope, machineId: null, queryClient }));
    const subscription = mocks.subscribe.mock.calls[0][0];
    const context = { machine_id: null, active_lot_code: 'LOTE-CELULA' };
    act(() => subscription.callback({ new: context }));
    expect(result.current.activeContext).toEqual(context);
    const machineContext = { machine_id: 'machine-2', active_lot_code: 'LOTE-POSTO' };
    act(() => subscription.callback({ new: machineContext }));
    expect(result.current.activeContext).toEqual(machineContext);
    unmount();
  });

  it('payload sem linha não apaga contexto nem dispara invalidação', () => {
    const queryClient = {};
    const { result, unmount } = renderHook(() => useCollectionActiveContextSync({ ...scope, machineId: null, queryClient }));
    const subscription = mocks.subscribe.mock.calls[0][0];
    act(() => subscription.callback({}));
    expect(result.current.hasRealtimeUpdate).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
    unmount();
  });

  it('ignora callback da assinatura antiga após trocar de máquina', () => {
    const queryClient = {};
    const { result, rerender, unmount } = renderHook(
      ({ machineId }) => useCollectionActiveContextSync({ ...scope, machineId, queryClient }),
      { initialProps: { machineId: 'machine-1' } },
    );
    const previousSubscription = mocks.subscribe.mock.calls[0][0];
    rerender({ machineId: 'machine-2' });
    const currentSubscription = mocks.subscribe.mock.calls[1][0];
    const current = { machine_id: 'machine-2', active_lot_code: 'NOVO' };
    act(() => currentSubscription.callback({ new: current }));
    mocks.schedule.mockClear();
    act(() => previousSubscription.callback({ new: { machine_id: 'machine-1', active_lot_code: 'ANTIGO' } }));
    expect(result.current.activeContext).toEqual(current);
    expect(mocks.schedule).not.toHaveBeenCalled();
    unmount();
  });
});

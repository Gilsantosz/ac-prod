import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCollectionSnapshotAfterLocalUpdates, scheduleCollectionCounterReconciliation } from '@/hooks/collectionCounterReconciliation';

describe('reconciliação limitada da corrida entre snapshot e ACK', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  function client() {
    const state = { counter_reconciliation_required: true };
    return {
      state,
      getQueryData: vi.fn(() => state),
      getQueryState: vi.fn(() => ({ fetchStatus: 'idle' })),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };
  }

  it.each([
    [['collection-kpis', 'Corte'], { approved: 20 }, { approved: 21 }],
    [['operator-shift-kpis', 'operator-corte'], { approved: 20 }, { approved: 21 }],
    [['stageReadings', 'Corte'], { readings: [], totalCount: 0 },
      { readings: [{ client_event_id: 'confirmed-event' }], totalCount: 1 }],
  ])('preserva a confirmação local recebida enquanto a consulta %j estava aberta', (queryKey, snapshot, currentCache) => {
    const queryClient = { getQueryData: vi.fn(() => currentCache) };
    const result = resolveCollectionSnapshotAfterLocalUpdates({
      queryClient, queryKey, startedGeneration: 4, currentGeneration: 5, snapshot,
    });
    expect(result).toEqual({ ...currentCache, counter_reconciliation_required: true });
    expect(queryClient.getQueryData).toHaveBeenCalledWith(queryKey);
  });

  it('aceita snapshot sem corrida e preserva o retorno inicial quando ainda não havia cache', () => {
    const queryClient = { getQueryData: vi.fn(() => undefined) };
    const input = { queryClient, queryKey: ['collection-kpis', 'Corte'],
      startedGeneration: 4, currentGeneration: 4, snapshot: { approved: 20 } };
    expect(resolveCollectionSnapshotAfterLocalUpdates(input)).toMatchObject({
      approved: 20, _collection_snapshot_completed_at: expect.any(Number),
    });
    expect(resolveCollectionSnapshotAfterLocalUpdates({ ...input, currentGeneration: 5 }))
      .toEqual({ approved: 20, counter_reconciliation_required: true });
  });

  it('reúne várias confirmações em no máximo duas consultas da chave afetada', async () => {
    const queryClient = client();
    const key = ['collection-kpis', 'Corte', 'machine-corte'];
    for (let index = 0; index < 100; index += 1) {
      scheduleCollectionCounterReconciliation(queryClient, key);
    }
    await vi.advanceTimersByTimeAsync(2_999);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    scheduleCollectionCounterReconciliation(queryClient, key);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      { queryKey: key, exact: true, refetchType: 'active' }, { cancelRefetch: false },
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('dispensa a segunda consulta depois que a primeira reconciliou o agregado', async () => {
    const queryClient = client();
    queryClient.invalidateQueries.mockImplementation(async () => {
      queryClient.state.counter_reconciliation_required = false;
    });
    scheduleCollectionCounterReconciliation(queryClient, ['operator-shift-kpis', 'operator-corte']);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('não cancela uma consulta em andamento e usa a segunda oportunidade', async () => {
    const queryClient = client();
    queryClient.getQueryState.mockReturnValue({ fetchStatus: 'fetching' });
    scheduleCollectionCounterReconciliation(queryClient, ['collection-kpis', 'Bordo']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    queryClient.getQueryState.mockReturnValue({ fetchStatus: 'idle' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

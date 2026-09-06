import { act, renderHook, waitFor } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  maintenanceIntervalMs: 6 * 60 * 60 * 1000,
  dispatchCollectionEventBatch: vi.fn(),
  enqueueCollectionEvent: vi.fn(),
  flushCollectionMicroBatchQueue: vi.fn(),
  flushCollectionQueue: vi.fn(),
  getOperatorSession: vi.fn(),
  getQueueStats: vi.fn(),
  getQueueStatsByCellMachine: vi.fn(),
  processCollectionEvent: vi.fn(),
  retryErrors: vi.fn(),
  runCollectionQueueMaintenance: vi.fn(),
  runStaleProcessingRecovery: vi.fn(),
  getCollectionPipelineFlagsV3: vi.fn(),
  isCollectionPipelineFlagEnabled: vi.fn(),
  isCollectionPipelineV3Enabled: vi.fn(),
  reconcileCollectionEventsV3: vi.fn(),
  persistCollectionBroadcastMessage: vi.fn(),
  subscribeToCollectionBroadcastV3: vi.fn(),
  unsubscribeFromCollectionBroadcastV3: vi.fn(),
}));

vi.mock('@/lib/collectionBatchService', () => ({
  COLLECTION_PIPELINE_FLAGS_CACHE_MS: 60_000,
  getCollectionPipelineFlagsV3: mocks.getCollectionPipelineFlagsV3,
  isCollectionPipelineFlagEnabled: mocks.isCollectionPipelineFlagEnabled,
  isCollectionPipelineV3Enabled: mocks.isCollectionPipelineV3Enabled,
}));

vi.mock('@/lib/collectionRealtimeService', () => ({
  reconcileCollectionEventsV3: mocks.reconcileCollectionEventsV3,
  persistCollectionBroadcastMessage: mocks.persistCollectionBroadcastMessage,
  subscribeToCollectionBroadcastV3: mocks.subscribeToCollectionBroadcastV3,
  unsubscribeFromCollectionBroadcastV3: mocks.unsubscribeFromCollectionBroadcastV3,
}));

vi.mock('@/lib/collectionEventQueue', () => ({
  COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS: mocks.maintenanceIntervalMs,
  enqueueCollectionEvent: mocks.enqueueCollectionEvent,
  flushCollectionQueue: mocks.flushCollectionQueue,
  getQueueStats: mocks.getQueueStats,
  getQueueStatsByCellMachine: mocks.getQueueStatsByCellMachine,
  processCollectionEvent: mocks.processCollectionEvent,
  retryErrors: mocks.retryErrors,
  runCollectionQueueMaintenance: mocks.runCollectionQueueMaintenance,
  runStaleProcessingRecovery: mocks.runStaleProcessingRecovery,
}));

vi.mock('@/lib/collectionMicroBatchQueue', () => ({
  flushCollectionMicroBatchQueue: mocks.flushCollectionMicroBatchQueue,
}));

vi.mock('@/lib/collectionEventDispatcher', () => ({
  COLLECTION_EVENT_KINDS: {
    PRODUCTION_STAGE: 'production_stage',
    REPLACEMENT_STAGE: 'replacement_stage',
  },
  dispatchCollectionEventBatch: mocks.dispatchCollectionEventBatch,
}));

vi.mock('@/lib/operatorSessionService', () => ({
  getOperatorSession: mocks.getOperatorSession,
}));

vi.mock('@/lib/collectionDeviceIdentity', () => ({
  getCollectionDeviceId: () => 'test-device-id',
  getCollectionAppVersion: () => 'test',
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { useCollectionQueue, withCollectionQueueLock } from '@/hooks/useCollectionQueue';

const MAINTENANCE_INTERVAL_MS = mocks.maintenanceIntervalMs;

const defaultStats = {
  total: 0,
  pending: 0,
  processing: 0,
  synced: 0,
  error: 0,
  hasStalePending: false,
  hasSlowEnqueue: false,
};

const originalRequestIdleCallback = window.requestIdleCallback;
const originalCancelIdleCallback = window.cancelIdleCallback;
const originalNavigatorLocks = navigator.locks;

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function setNavigatorLocks(value) {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value,
  });
}

function removeIdleCallbacks() {
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    value: undefined,
  });
}

describe('useCollectionQueue maintenance scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setOnline(false);
    setNavigatorLocks(undefined);
    removeIdleCallbacks();
    mocks.enqueueCollectionEvent.mockResolvedValue('event-1');
    mocks.flushCollectionMicroBatchQueue.mockResolvedValue({
      processed: 0,
      synced: 0,
      errors: 0,
      batches: 0,
    });
    mocks.flushCollectionQueue.mockResolvedValue({
      processed: 0,
      synced: 0,
      errors: 0,
    });
    mocks.getQueueStats.mockResolvedValue(defaultStats);
    mocks.getQueueStatsByCellMachine.mockResolvedValue(defaultStats);
    mocks.retryErrors.mockResolvedValue(0);
    mocks.runCollectionQueueMaintenance.mockResolvedValue({
      pruned: 0,
      hasMore: false,
      skipped: false,
    });
    mocks.runStaleProcessingRecovery.mockResolvedValue(0);
    mocks.getCollectionPipelineFlagsV3.mockResolvedValue([]);
    mocks.isCollectionPipelineFlagEnabled.mockReturnValue(false);
    mocks.isCollectionPipelineV3Enabled.mockReturnValue(false);
    mocks.reconcileCollectionEventsV3.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    setOnline(true);
    setNavigatorLocks(originalNavigatorLocks);
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: originalRequestIdleCallback,
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: originalCancelIdleCallback,
    });
  });

  it('agenda prune fora do hotpath e repete somente após seis horas', async () => {
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      flushIntervalMs: MAINTENANCE_INTERVAL_MS + 60_000,
    }));

    expect(mocks.runCollectionQueueMaintenance).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(mocks.runCollectionQueueMaintenance).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.runCollectionQueueMaintenance).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS - 1);
    });
    expect(mocks.runCollectionQueueMaintenance).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.runCollectionQueueMaintenance).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS + 5_000);
    });
    expect(mocks.runCollectionQueueMaintenance).toHaveBeenCalledTimes(2);
  });

  it('reagenda cada fatia restante em um novo requestIdleCallback', async () => {
    const idleCallbacks = [];
    const requestIdleCallback = vi.fn((callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    const cancelIdleCallback = vi.fn();
    mocks.runCollectionQueueMaintenance
      .mockResolvedValueOnce({ pruned: 100, hasMore: true, skipped: false })
      .mockResolvedValueOnce({ pruned: 7, hasMore: false, skipped: false });
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: cancelIdleCallback,
    });

    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      flushIntervalMs: MAINTENANCE_INTERVAL_MS + 60_000,
    }));

    expect(requestIdleCallback).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 5_000 },
    );
    expect(mocks.runCollectionQueueMaintenance).not.toHaveBeenCalled();

    await act(async () => {
      idleCallbacks.shift()({ didTimeout: false, timeRemaining: () => 10 });
      await Promise.resolve();
    });
    expect(mocks.runCollectionQueueMaintenance).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).toHaveBeenCalledTimes(2);

    await act(async () => {
      idleCallbacks.shift()({ didTimeout: false, timeRemaining: () => 10 });
      await Promise.resolve();
    });
    expect(mocks.runCollectionQueueMaintenance).toHaveBeenCalledTimes(2);
    expect(requestIdleCallback).toHaveBeenCalledTimes(2);

    unmount();
    expect(cancelIdleCallback).not.toHaveBeenCalled();
  });

  it('executa uma recuperação por flush sem duplicar a varredura no intervalo', async () => {
    vi.useRealTimers();
    setOnline(true);

    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      flushIntervalMs: 60_000,
    }));

    await waitFor(() => {
      expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(1);
    });
    expect(mocks.runStaleProcessingRecovery).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('continua o flush de pending quando a recuperação defensiva falha', async () => {
    vi.useRealTimers();
    setOnline(true);
    mocks.runStaleProcessingRecovery.mockRejectedValueOnce(
      new Error('IndexedDB recovery unavailable'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      flushIntervalMs: 60_000,
    }));

    await waitFor(() => {
      expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(1);
    });
    expect(warn).toHaveBeenCalledWith(
      '[CollectionQueue] Falha ao recuperar eventos travados:',
      expect.any(Error),
    );
    unmount();
    warn.mockRestore();
  });

  it('consolida rajadas de mudanças locais em uma única leitura de estatísticas', async () => {
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      flushIntervalMs: MAINTENANCE_INTERVAL_MS + 60_000,
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mocks.getQueueStatsByCellMachine.mockClear();

    act(() => {
      for (let index = 0; index < 25; index += 1) {
        window.dispatchEvent(new CustomEvent('collection-queue-changed'));
      }
    });
    expect(mocks.getQueueStatsByCellMachine).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mocks.getQueueStatsByCellMachine).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('reconcilia ACKs V2 mesmo com V3 desabilitada, sem sobreposição e com catch-up paginado', async () => {
    setOnline(true);
    let finish;
    const firstRequest = new Promise((resolve) => { finish = resolve; });
    mocks.reconcileCollectionEventsV3.mockReturnValueOnce(firstRequest);
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      enableV3Realtime: false,
      flushIntervalMs: 60_000,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledWith({
      eventKind: 'production_stage', limit: 100, olderThanMs: 2_000,
    });
    expect(mocks.subscribeToCollectionBroadcastV3).not.toHaveBeenCalled();
    await act(async () => {
      const updates = [];
      Object.defineProperty(updates, 'hasMore', { value: true });
      finish(updates);
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(3);
  });

  it('atualiza projeção de outro dispositivo sem somar delta nem notificar leitura alheia', async () => {
    setOnline(true);
    mocks.isCollectionPipelineFlagEnabled.mockReturnValue(true);
    mocks.isCollectionPipelineV3Enabled.mockReturnValue(true);
    const payload = {
      broadcast_event: 'collection.projection_delta', client_event_id: 'remote-event',
      outbox_id: 'outbox-1', projected_at: '2026-09-06T10:00:00Z',
      cell_name: 'Corte', machine_id: 'remote-machine', decision: 'approved',
    };
    mocks.persistCollectionBroadcastMessage.mockResolvedValue({ payload, event: null, state: null });
    const queryClient = { invalidateQueries: vi.fn().mockResolvedValue(), setQueriesData: vi.fn() };
    const onResult = vi.fn();
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      cellId: 'cell-1', cellName: 'Corte', machineId: 'local-machine',
      eventKind: 'production_stage', queryClient, onResult,
    }));
    await act(async () => { await Promise.resolve(); });
    const { onMessage } = mocks.subscribeToCollectionBroadcastV3.mock.calls[0][0];
    await act(async () => {
      await onMessage(payload);
      await onMessage(payload);
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(onResult).not.toHaveBeenCalled();
    expect(queryClient.setQueriesData).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = queryClient.invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: ['stageReadings', 'Corte', null] })).toBe(true);
    expect(predicate({ queryKey: ['stageReadings', 'Corte', 'remote-machine'] })).toBe(true);
    expect(predicate({ queryKey: ['stageReadings', 'Corte', 'local-machine'] })).toBe(false);
    expect(predicate({ queryKey: ['collection-kpis', 'Bordo', null] })).toBe(false);
    unmount();
  });

  it('acorda a reconciliação após ACK durável sem aguardar o fallback de 15 segundos', async () => {
    setOnline(true);
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false,
    }));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(1);
    const { onResult } = mocks.flushCollectionMicroBatchQueue.mock.calls[0][1];
    act(() => onResult({
      event: { client_event_id: 'durable-v2' },
      result: { message: 'ACK durável' }, state: 'DATABASE_ACKNOWLEDGED',
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.reconcileCollectionEventsV3).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('entrega uma única confirmação individual para mensagens finais duplicadas', async () => {
    setOnline(true);
    const onResult = vi.fn();
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', onResult,
    }));
    await act(async () => { await Promise.resolve(); });
    const batchResult = mocks.flushCollectionMicroBatchQueue.mock.calls[0][1].onResult;
    const payload = {
      event: { client_event_id: 'final-1' }, result: { message: 'Aprovada' }, state: 'APPROVED',
    };
    act(() => {
      batchResult(payload);
      batchResult(payload);
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('não rebaixa APPROVED do Broadcast para ACK atrasado e mantém feedback da próxima leitura', async () => {
    setOnline(true);
    mocks.isCollectionPipelineFlagEnabled.mockReturnValue(true);
    mocks.isCollectionPipelineV3Enabled.mockReturnValue(true);
    const onResult = vi.fn();
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', cellId: 'cell-1', cellName: 'Corte', onResult,
    }));
    await act(async () => { await Promise.resolve(); });
    const batchResult = mocks.flushCollectionMicroBatchQueue.mock.calls[0][1].onResult;
    const { onMessage } = mocks.subscribeToCollectionBroadcastV3.mock.calls[0][0];
    const event = { client_event_id: 'broadcast-before-http' };
    const ack = { event, result: { message: 'ACK' }, state: 'DATABASE_ACKNOWLEDGED' };
    const payload = {
      broadcast_event: 'collection.finalized', client_event_id: event.client_event_id,
      result: { status: 'approved', message: 'Aprovada' },
    };
    mocks.persistCollectionBroadcastMessage.mockResolvedValue({ payload, event, state: 'APPROVED' });

    act(() => batchResult(ack));
    await act(async () => { await onMessage(payload); });
    act(() => {
      batchResult(ack);
      batchResult({ ...ack, state: 'PROCESSING' });
      batchResult({ ...ack, event: { client_event_id: 'independent-next-event' } });
    });

    expect(onResult.mock.calls.map(([result]) => [result.event.client_event_id, result.state])).toEqual([
      ['broadcast-before-http', 'DATABASE_ACKNOWLEDGED'],
      ['broadcast-before-http', 'APPROVED'],
      ['independent-next-event', 'DATABASE_ACKNOWLEDGED'],
    ]);
    unmount();
  });

  it('não acumula tarefas aguardando um Web Lock e separa os projetos', async () => {
    const task = vi.fn();
    const request = vi.fn((_name, _options, callback) => callback(null));
    setNavigatorLocks({ request });
    await withCollectionQueueLock(task, 'sync', 'test-project');
    await withCollectionQueueLock(task, 'sync', 'production-project');
    expect(task).not.toHaveBeenCalled();
    expect(request).toHaveBeenNthCalledWith(1, 'acprod-collection-sync:test-project', { ifAvailable: true }, expect.any(Function));
    expect(request).toHaveBeenNthCalledWith(2, 'acprod-collection-sync:production-project', { ifAvailable: true }, expect.any(Function));
  });

  it('fallback sem Web Locks não cria cadeia de Promises para tarefa ocupada', async () => {
    let finish;
    const running = withCollectionQueueLock(() => new Promise((resolve) => { finish = resolve; }), 'sync', 'same-project');
    const duplicate = vi.fn();
    expect(await withCollectionQueueLock(duplicate, 'sync', 'same-project')).toBeNull();
    expect(duplicate).not.toHaveBeenCalled();
    finish();
    await running;
    await withCollectionQueueLock(duplicate, 'sync', 'same-project');
    expect(duplicate).toHaveBeenCalledTimes(1);
  });
});

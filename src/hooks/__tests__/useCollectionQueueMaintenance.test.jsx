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
  sanitizeCollectionEventPayload: (value) => value,
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
import { toast } from 'sonner';

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
const originalBroadcastChannel = globalThis.BroadcastChannel;

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
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: originalBroadcastChannel,
    });
  });

  it('aceita decisão local somente para a sessão/evento da aba e fecha o canal ao desmontar', () => {
    const channels = [];
    class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        channels.push(this);
      }

      postMessage() {}

      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    mocks.getOperatorSession.mockReturnValue({ session_id: 'operator-session-b' });
    const onResult = vi.fn();
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      onResult,
      enableV3Realtime: false,
    }));
    const channel = channels[0];
    const payload = {
      event: {
        client_event_id: 'client-event-b',
        operator_session_id: 'operator-session-b',
      },
      result: {
        client_event_id: 'client-event-b',
        status: 'approved',
      },
      state: 'APPROVED',
    };

    act(() => {
      channel.onmessage({ data: {
        source: 'sibling-tab',
        operator_session_id: 'outra-sessao',
        client_event_id: 'client-event-b',
        payload,
      } });
      channel.onmessage({ data: {
        source: 'sibling-tab',
        operator_session_id: 'operator-session-b',
        client_event_id: 'evento-divergente',
        payload,
      } });
    });
    expect(onResult).not.toHaveBeenCalled();

    act(() => {
      channel.onmessage({ data: {
        source: 'sibling-tab',
        operator_session_id: 'operator-session-b',
        client_event_id: 'client-event-b',
        payload,
      } });
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(payload);

    unmount();
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
  });

  it('a aba que escoa a fila apenas retransmite o resultado pertencente à sessão irmã', async () => {
    setOnline(true);
    const channels = [];
    class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.postMessage = vi.fn();
        channels.push(this);
      }

      close() {}
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    mocks.getOperatorSession.mockReturnValue({ session_id: 'operator-session-a' });
    const onResult = vi.fn();
    const observed = [];
    const observeResult = (event) => observed.push(event.detail);
    window.addEventListener('collection-batch-result', observeResult);
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      onResult,
      enableV3Realtime: false,
    }));
    await act(async () => { await Promise.resolve(); });

    const batchResult = mocks.flushCollectionMicroBatchQueue.mock.calls[0][1].onResult;
    const siblingPayload = {
      event: {
        client_event_id: 'client-event-b',
        operator_session_id: 'operator-session-b',
      },
      result: { client_event_id: 'client-event-b', status: 'approved' },
      state: 'APPROVED',
    };
    const ownPayload = {
      event: {
        client_event_id: 'client-event-a',
        operator_session_id: 'operator-session-a',
      },
      result: { client_event_id: 'client-event-a', status: 'approved' },
      state: 'APPROVED',
    };

    act(() => {
      batchResult(siblingPayload);
      batchResult(ownPayload);
    });

    expect(channels[0].postMessage).toHaveBeenCalledTimes(2);
    expect(channels[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({
      operator_session_id: 'operator-session-b',
      client_event_id: 'client-event-b',
    }));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(ownPayload);
    expect(observed).toEqual([ownPayload]);

    // O identificador do lote pode chegar depois do recibo compacto. Essa
    // atualização também chega à aba dona, sem emitir feedback nesta aba.
    act(() => {
      batchResult({ ...siblingPayload, result: { ...siblingPayload.result,
        lot: { id: 'lot-b', lot_code: 'CLIENTE-B' } } });
    });
    expect(channels[0].postMessage).toHaveBeenCalledTimes(3);
    expect(channels[0].postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      operator_session_id: 'operator-session-b',
      payload: expect.objectContaining({ enrichmentOnly: true,
        result: expect.objectContaining({ lot: { id: 'lot-b', lot_code: 'CLIENTE-B' } }) }),
    }));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([ownPayload]);

    window.removeEventListener('collection-batch-result', observeResult);
    unmount();
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

  it('envia a leitura após gravação durável sem esperar debounce ou lote de 25', async () => {
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    let finishEnqueue;
    mocks.enqueueCollectionEvent.mockReturnValueOnce(new Promise((resolve) => { finishEnqueue = resolve; }));
    setOnline(true);
    let enqueuePromise;
    act(() => { enqueuePromise = result.current.enqueue({ raw_value: '09890701' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.flushCollectionMicroBatchQueue).not.toHaveBeenCalled();

    await act(async () => {
      finishEnqueue('new-event');
      await enqueuePromise;
    });

    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();
    expect(mocks.flushCollectionMicroBatchQueue.mock.calls[0][1]).toMatchObject({ batchSize: 5 });
    unmount();
  });

  it('respeita autoFlush false no micro-lote e processNow dispara uma única tentativa', async () => {
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    setOnline(true);

    let clientEventId;
    await act(async () => {
      clientEventId = await result.current.enqueue(
        { raw_value: '09890707' },
        { autoFlush: false },
      );
      await Promise.resolve();
    });
    expect(mocks.flushCollectionMicroBatchQueue).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.processNow(clientEventId);
      await Promise.resolve();
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();

    await act(async () => { await Promise.resolve(); });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();
    unmount();
  });

  it('envia a leitura que chega durante o flush logo após a requisição em andamento', async () => {
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    let finishFirstFlush;
    mocks.flushCollectionMicroBatchQueue.mockReturnValueOnce(new Promise((resolve) => { finishFirstFlush = resolve; }));
    setOnline(true);
    let flushPromise;
    act(() => { flushPromise = result.current.flush(); });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.enqueue({ raw_value: '09890702' });
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();

    await act(async () => {
      finishFirstFlush({ processed: 1 });
      await flushPromise;
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('não perde nem atrasa uma leitura durante a atualização de estatísticas', async () => {
    let held = false;
    const request = vi.fn(async (_name, _options, callback) => {
      if (held) return callback(null);
      held = true;
      try {
        return await callback({ name: 'test-lock' });
      } finally {
        held = false;
      }
    });
    setNavigatorLocks({ request });
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    mocks.getQueueStatsByCellMachine.mockClear();
    let finishStats;
    mocks.getQueueStatsByCellMachine.mockReturnValueOnce(new Promise((resolve) => { finishStats = resolve; }));
    setOnline(true);
    await act(async () => {
      await result.current.flush();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(finishStats).toBeTypeOf('function');
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.enqueue({ raw_value: '09890703' });
      await Promise.resolve();
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(2);

    await act(async () => {
      finishStats(defaultStats);
      await Promise.resolve();
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('não agenda novo envio após desmontagem enquanto uma requisição termina', async () => {
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    mocks.getQueueStatsByCellMachine.mockClear();
    let finishFirstFlush;
    mocks.flushCollectionMicroBatchQueue.mockReturnValueOnce(new Promise((resolve) => { finishFirstFlush = resolve; }));
    setOnline(true);
    let flushPromise;
    act(() => { flushPromise = result.current.flush(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      await result.current.enqueue({ raw_value: '09890704' });
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();
    unmount();

    await act(async () => {
      finishFirstFlush({ processed: 1 });
      await flushPromise;
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();
    expect(mocks.getQueueStatsByCellMachine).not.toHaveBeenCalled();
  });

  it('envia a próxima leitura só após liberação efetiva do Web Lock, sem timer', async () => {
    let releaseFirstLock;
    let held = false;
    let locks = 0;
    const request = vi.fn(async (_name, _options, callback) => {
      if (held) return callback(null);
      held = true;
      const first = ++locks === 1;
      try {
        const value = await callback({ name: 'test-lock' });
        if (first) await new Promise((resolve) => { releaseFirstLock = resolve; });
        return value;
      } finally {
        held = false;
      }
    });
    setNavigatorLocks({ request });
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    setOnline(true);
    let flushPromise;
    act(() => { flushPromise = result.current.flush(); });
    await act(async () => { await Promise.resolve(); });
    expect(releaseFirstLock).toBeTypeOf('function');
    await act(async () => { await result.current.enqueue({ raw_value: '09890705' }); });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      releaseFirstLock();
      await flushPromise;
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('envia imediatamente após outra aba liberar o Web Lock, sem esperar o intervalo', async () => {
    let grantQueuedLock;
    const request = vi.fn((name, optionsOrCallback, callback) => {
      if (optionsOrCallback?.ifAvailable) {
        return Promise.resolve(callback(null));
      }

      return new Promise((resolve, reject) => {
        grantQueuedLock = async () => {
          try {
            const queuedCallback = typeof optionsOrCallback === 'function'
              ? optionsOrCallback
              : callback;
            resolve(await queuedCallback({ name }));
          } catch (error) {
            reject(error);
          }
        };
      });
    });
    setNavigatorLocks({ request });
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    setOnline(true);

    await act(async () => {
      await result.current.enqueue({ raw_value: '09890708' }, { autoFlush: false });
      await result.current.processNow('09890708');
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toEqual({ ifAvailable: true });
    expect(request.mock.calls[1][1]).toMatchObject({ signal: expect.any(AbortSignal) });
    expect(grantQueuedLock).toBeTypeOf('function');
    expect(mocks.flushCollectionMicroBatchQueue).not.toHaveBeenCalled();

    await act(async () => {
      await grantQueuedLock();
      await Promise.resolve();
    });

    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
  });

  it('cancela a espera do Web Lock ao desmontar sem deixar waiter órfão', async () => {
    let queuedSignal;
    const request = vi.fn((_name, options, callback) => {
      if (options?.ifAvailable) return Promise.resolve(callback(null));
      queuedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        queuedSignal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    });
    setNavigatorLocks({ request });
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    setOnline(true);

    await act(async () => {
      await result.current.enqueue({ raw_value: '09890709' }, { autoFlush: false });
      await result.current.processNow('09890709');
      await Promise.resolve();
    });

    expect(queuedSignal).toBeInstanceOf(AbortSignal);
    expect(queuedSignal.aborted).toBe(false);
    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(queuedSignal.aborted).toBe(true);
    expect(mocks.flushCollectionMicroBatchQueue).not.toHaveBeenCalled();
  });

  it('preserva o envio solicitado quando a consulta de estatísticas falha', async () => {
    const { result, unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage', enableV3Realtime: false, flushIntervalMs: 60_000,
    }));
    await act(async () => { await Promise.resolve(); });
    mocks.getQueueStatsByCellMachine.mockClear();
    let rejectStats;
    mocks.getQueueStatsByCellMachine.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectStats = reject; }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setOnline(true);
    await act(async () => {
      await result.current.flush();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(rejectStats).toBeTypeOf('function');
    await act(async () => {
      await result.current.enqueue({ raw_value: '09890706' });
      await Promise.resolve();
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(2);
    await act(async () => {
      rejectStats(new Error('stats indisponível'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.flushCollectionMicroBatchQueue).toHaveBeenCalledTimes(2);
    unmount();
    warn.mockRestore();
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

  it('não inicia outro refresh enfileirado após desmontar durante uma consulta de estatísticas', async () => {
    let finishStats;
    mocks.getQueueStatsByCellMachine.mockReturnValueOnce(new Promise((resolve) => {
      finishStats = resolve;
    }));
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), {
      eventKind: 'production_stage',
      flushIntervalMs: MAINTENANCE_INTERVAL_MS + 60_000,
    }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getQueueStatsByCellMachine).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('collection-queue-changed'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mocks.getQueueStatsByCellMachine).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      finishStats(defaultStats);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getQueueStatsByCellMachine).toHaveBeenCalledTimes(1);
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

  it('entrega os detalhes do HTTP após Broadcast como enriquecimento sem repetir a decisão', async () => {
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
    const event = { client_event_id: 'broadcast-metadata-first', rawValue: '09890703' };
    const compact = { decision: 'approved', reading_id: 'reading-3', lot: { id: 'lot-1' } };
    const payload = { broadcast_event: 'collection.finalized', client_event_id: event.client_event_id, result: compact };
    mocks.persistCollectionBroadcastMessage.mockResolvedValue({ payload, event, state: 'APPROVED' });
    await act(async () => { await onMessage(payload); });
    const complete = { event, state: 'APPROVED', result: { ...compact,
      item: { id: 'piece-3', traceability_code: '09890703', piece_name: 'PECA TESTE 03' },
      lot: { id: 'lot-1', lot_code: '947001', general_lot_code: 'TESTECOLETA20260907' },
    } };
    act(() => {
      batchResult(complete);
      batchResult(complete);
      batchResult({ event, state: 'APPROVED', result: compact });
      batchResult({ event, state: 'DATABASE_ACKNOWLEDGED', result: { message: 'Aguardando processamento' } });
    });
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls[0][0].enrichmentOnly).not.toBe(true);
    expect(onResult.mock.calls[1][0]).toMatchObject({ enrichmentOnly: true, state: 'APPROVED',
      result: { decision: 'approved', item: { traceability_code: '09890703' },
        lot: { lot_code: '947001', general_lot_code: 'TESTECOLETA20260907' } } });
    unmount();
  });

  it('não repete toast ou vibração do hook ao completar metadados', async () => {
    setOnline(true);
    const vibrate = vi.fn();
    const originalVibrate = navigator.vibrate;
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const { unmount } = renderHook(() => useCollectionQueue(vi.fn(), { eventKind: 'production_stage' }));
    await act(async () => { await Promise.resolve(); });
    const batchResult = mocks.flushCollectionMicroBatchQueue.mock.calls[0][1].onResult;
    const event = { client_event_id: 'notify-once' };
    act(() => {
      batchResult({ event, state: 'APPROVED', result: { decision: 'approved' } });
      batchResult({ event, state: 'APPROVED', result: { decision: 'approved', item: { piece_uid: '09890703' } } });
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    unmount();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: originalVibrate });
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

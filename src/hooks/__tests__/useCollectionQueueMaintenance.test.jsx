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

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useCollectionQueue } from '@/hooks/useCollectionQueue';

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
  });

  afterEach(() => {
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
});

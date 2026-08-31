import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  enqueueCollectionEvent,
  flushCollectionQueue,
  getCollectionEvent,
  getQueueStats,
  getQueueStatsByCellMachine,
  getServerPendingEvents,
  markEventServerPending,
  markEventSynced,
  markEventTerminalError,
  processCollectionEvent,
  retryErrors,
  recoverStaleProcessingEvents,
} from '@/lib/collectionEventQueue';
import { flushCollectionMicroBatchQueue } from '@/lib/collectionMicroBatchQueue';
import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEventBatch,
} from '@/lib/collectionEventDispatcher';
import { getOperatorSession } from '@/lib/operatorSessionService';
import {
  fetchProductionCollectionResults,
} from '@/lib/collectionBatchService';
import {
  isFinalCollectionIngress,
  subscribeToCollectionInbox,
} from '@/lib/collectionInboxMonitor';

const SERVER_POLL_INTERVAL_MS = 2_000;
const FLUSH_DEBOUNCE_MS = 120;
const SERVER_QUERY_CHUNK = 100;

function emitBatchResult(payload) {
  try {
    window.dispatchEvent(new CustomEvent('collection-batch-result', {
      detail: payload,
    }));
  } catch {
    // Ambiente sem window, como testes unitários.
  }
}

function notifyBatchResult({ result, error }) {
  if (result?.pending === true || result?.accepted === true) return;

  if (error) {
    toast.error(error.message || 'Falha ao processar leitura.', {
      id: 'collection-final-result',
    });
    return;
  }

  if (result?.success) {
    toast.success(result.message || 'Leitura aprovada.', {
      id: 'collection-final-result',
    });
    navigator.vibrate?.([70, 40, 70]);
    return;
  }

  if (['wrong_step', 'wrong_cell', 'duplicated', 'blocked'].includes(
    result?.status,
  ) || result?.alert_level === 'yellow') {
    toast.warning(result?.message || 'Leitura bloqueada.', {
      id: 'collection-final-result',
    });
    return;
  }

  toast.error(result?.message || 'Leitura não aprovada.', {
    id: 'collection-final-result',
  });
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/**
 * Fila industrial em duas confirmações:
 * 1. IndexedDB -> inbox durável do Supabase;
 * 2. inbox -> decisão produtiva do worker assíncrono.
 */
export function useCollectionQueue(processFn, options = {}) {
  const {
    cellName,
    machineId,
    eventKind,
    batchSize = 50,
    onResult = null,
  } = options;
  const microBatch = options.microBatch
    ?? eventKind === COLLECTION_EVENT_KINDS.PRODUCTION_STAGE;
  const processBatchFn = options.processBatchFn
    || (microBatch ? dispatchCollectionEventBatch : null);
  const flushIntervalMs = options.flushIntervalMs
    ?? (microBatch ? 2_000 : 15_000);

  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    processing: 0,
    serverPending: 0,
    synced: 0,
    error: 0,
    retryableError: 0,
    hasStalePending: false,
    hasStaleServerPending: false,
    hasSlowEnqueue: false,
  });
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);
  const fallbackLockRef = useRef(Promise.resolve());
  const flushTimerRef = useRef(null);
  const processFnRef = useRef(processFn);
  const processBatchFnRef = useRef(processBatchFn);
  const onResultRef = useRef(onResult);
  processFnRef.current = processFn;
  processBatchFnRef.current = processBatchFn;
  onResultRef.current = onResult;

  const refreshStats = useCallback(async () => {
    const nextStats = (cellName || machineId || eventKind)
      ? await getQueueStatsByCellMachine(cellName, machineId, eventKind)
      : await getQueueStats();
    setStats(nextStats);
  }, [cellName, machineId, eventKind]);

  const refreshStatsSafely = useCallback(() => {
    Promise.resolve(refreshStats()).catch((error) => {
      console.warn('[CollectionQueue] Falha ao atualizar estatísticas locais:', error);
    });
  }, [refreshStats]);

  const withQueueLock = useCallback(async (task) => {
    if (navigator.locks?.request) {
      return navigator.locks.request('acprod-collection-sync', task);
    }

    const currentTask = fallbackLockRef.current.then(task, task);
    fallbackLockRef.current = currentTask.catch(() => undefined);
    return currentTask;
  }, []);

  const handleBatchResult = useCallback((payload) => {
    emitBatchResult(payload);
    if (typeof onResultRef.current === 'function') {
      onResultRef.current(payload);
    } else {
      notifyBatchResult(payload);
    }
  }, []);

  const handleServerEnvelope = useCallback(async (envelope) => {
    const clientEventId = envelope?.client_event_id;
    if (!clientEventId) return;

    const event = await getCollectionEvent(clientEventId);
    if (!event) return;
    if (event.status === 'synced') return;
    if (event.status === 'error' && event.retryable === false) return;

    const result = envelope.result ?? envelope.resultado ?? envelope;

    if (!isFinalCollectionIngress(envelope)) {
      await markEventServerPending(
        clientEventId,
        result,
        envelope.ingress,
      );
      refreshStatsSafely();
      return;
    }

    if (envelope.status_sincronizacao === 'sincronizada') {
      await markEventSynced(clientEventId, result, envelope.ingress);
      handleBatchResult({
        event,
        result,
        error: null,
        batchIndex: 0,
        batchCount: 1,
        final: true,
      });
    } else {
      const error = new Error(
        envelope.error
          || result?.message
          || 'O servidor não conseguiu processar a leitura.',
      );
      error.retryable = false;
      error.result = result;
      await markEventTerminalError(clientEventId, error, envelope.ingress);
      handleBatchResult({
        event,
        result,
        error,
        batchIndex: 0,
        batchCount: 1,
        final: true,
      });
    }

    refreshStatsSafely();
  }, [handleBatchResult, refreshStatsSafely]);

  const reconcileServerPending = useCallback(async () => {
    if (!microBatch || !navigator.onLine) return;
    const pending = await getServerPendingEvents();
    if (!pending.length) return;

    const ids = pending.map((event) => event.client_event_id);
    for (const group of chunks(ids, SERVER_QUERY_CHUNK)) {
      const envelopes = await fetchProductionCollectionResults(group);
      for (const envelope of envelopes) {
        await handleServerEnvelope(envelope);
      }
    }
  }, [handleServerEnvelope, microBatch]);

  const flush = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;

    await withQueueLock(async () => {
      if (flushingRef.current || !navigator.onLine) return;
      flushingRef.current = true;
      setFlushing(true);
      try {
        await recoverStaleProcessingEvents(30_000);

        if (microBatch && typeof processBatchFnRef.current === 'function') {
          await flushCollectionMicroBatchQueue(processBatchFnRef.current, {
            batchSize,
            onResult: handleBatchResult,
          });
        } else {
          await flushCollectionQueue(processFnRef.current);
        }
      } finally {
        flushingRef.current = false;
        setFlushing(false);
        await refreshStats();
      }
    });
  }, [
    batchSize,
    handleBatchResult,
    microBatch,
    refreshStats,
    withQueueLock,
  ]);

  const scheduleFlush = useCallback((delayMs = FLUSH_DEBOUNCE_MS) => {
    if (!navigator.onLine) return;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flush().catch((error) => {
        console.warn('[CollectionQueue] Flush agendado falhou:', error);
      });
    }, Math.max(0, Number(delayMs) || 0));
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    const intervalMs = Math.max(
      1_000,
      Number(flushIntervalMs) || (microBatch ? 2_000 : 15_000),
    );

    const recoverAndFlush = async () => {
      await recoverStaleProcessingEvents(30_000);
      if (!cancelled && navigator.onLine) await flush();
    };

    recoverAndFlush();
    const interval = setInterval(recoverAndFlush, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [flush, flushIntervalMs, microBatch]);

  useEffect(() => {
    const handler = () => refreshStatsSafely();
    window.addEventListener('collection-queue-changed', handler);
    refreshStatsSafely();
    return () => window.removeEventListener('collection-queue-changed', handler);
  }, [refreshStatsSafely]);

  useEffect(() => {
    if (!microBatch) return undefined;

    const unsubscribe = subscribeToCollectionInbox((envelope) => {
      handleServerEnvelope(envelope).catch((error) => {
        console.warn('[CollectionQueue] Realtime do inbox falhou:', error);
      });
    });

    const reconcile = () => {
      reconcileServerPending().catch((error) => {
        console.warn('[CollectionQueue] Poll do inbox falhou:', error);
      });
    };
    reconcile();
    const interval = setInterval(reconcile, SERVER_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [handleServerEnvelope, microBatch, reconcileServerPending]);

  useEffect(() => {
    const tryFlush = async () => {
      if (!navigator.onLine) return;
      const currentStats = await getQueueStats();
      if (currentStats.pending > 0) await flush();
      await reconcileServerPending();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryFlush();
    };
    window.addEventListener('online', tryFlush);
    window.addEventListener('focus', tryFlush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', tryFlush);
      window.removeEventListener('focus', tryFlush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush, reconcileServerPending]);

  const enqueue = useCallback(async (payload, enqueueOpts = {}) => {
    if (microBatch) {
      const operatorSession = getOperatorSession();
      const operatorSessionToken = payload.operatorSessionToken
        || payload.operator_session_token
        || operatorSession?.token
        || null;
      payload = {
        ...payload,
        operatorSessionToken,
        operator_session_token: operatorSessionToken,
      };
    }

    const id = await enqueueCollectionEvent(payload);
    refreshStatsSafely();

    const shouldFlushImmediately = enqueueOpts.autoFlush === true
      || (!microBatch && enqueueOpts.autoFlush !== false);
    if (navigator.onLine && shouldFlushImmediately) {
      scheduleFlush(0);
    }
    return id;
  }, [microBatch, refreshStatsSafely, scheduleFlush]);

  const processNow = useCallback(async (clientEventId) => {
    if (microBatch) {
      scheduleFlush(FLUSH_DEBOUNCE_MS);
      refreshStatsSafely();
      return {
        success: true,
        accepted: true,
        pending: true,
        status: 'queued',
        alert_level: 'blue',
        client_event_id: clientEventId,
        message: 'Leitura salva localmente. Envio ao servidor iniciado.',
      };
    }

    const result = await withQueueLock(() => (
      processCollectionEvent(clientEventId, processFnRef.current)
    ));
    refreshStatsSafely();
    return result;
  }, [microBatch, refreshStatsSafely, scheduleFlush, withQueueLock]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    refreshStatsSafely();
    if (count > 0 && navigator.onLine) scheduleFlush(0);
    return count;
  }, [refreshStatsSafely, scheduleFlush]);

  return {
    stats,
    flushing,
    enqueue,
    flush,
    processNow,
    retryQueueErrors,
    reconcileServerPending,
  };
}

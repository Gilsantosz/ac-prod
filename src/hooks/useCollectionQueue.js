import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  enqueueCollectionEvent,
  flushCollectionQueue,
  getQueueStats,
  getQueueStatsByCellMachine,
  processCollectionEvent,
  retryErrors,
  recoverStaleProcessingEvents,
  pruneSettledEvents,
} from '@/lib/collectionEventQueue';
import { flushCollectionMicroBatchQueue } from '@/lib/collectionMicroBatchQueue';
import {
  reconcileAcceptedCollectionEvents,
  subscribeToCollectionInboxUpdates,
  unsubscribeFromCollectionInbox,
} from '@/lib/collectionInboxReconciler';
import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEventBatch,
} from '@/lib/collectionEventDispatcher';
import { getOperatorSession } from '@/lib/operatorSessionService';

const notificationBucket = {
  timer: null,
  approved: 0,
  warning: 0,
  error: 0,
  lastWarning: null,
  lastError: null,
};

function flushNotificationBucket() {
  const bucket = notificationBucket;
  bucket.timer = null;

  if (bucket.error > 0) {
    toast.error(
      bucket.error === 1
        ? (bucket.lastError || 'Uma leitura não pôde ser processada.')
        : `${bucket.error} leituras terminaram com erro. Consulte a fila para detalhes.`,
    );
  }
  if (bucket.warning > 0) {
    toast.warning(
      bucket.warning === 1
        ? (bucket.lastWarning || 'Uma leitura foi bloqueada.')
        : `${bucket.warning} leituras foram bloqueadas ou duplicadas.`,
    );
  }
  if (bucket.approved > 0) {
    toast.success(
      bucket.approved === 1
        ? 'Leitura aprovada.'
        : `${bucket.approved} leituras aprovadas pelo servidor.`,
    );
    navigator.vibrate?.([70, 40, 70]);
  }

  bucket.approved = 0;
  bucket.warning = 0;
  bucket.error = 0;
  bucket.lastWarning = null;
  bucket.lastError = null;
}

function enqueueFinalNotification({ result, error }) {
  if (error) {
    notificationBucket.error += 1;
    notificationBucket.lastError = error.message;
  } else if (result?.success) {
    notificationBucket.approved += 1;
  } else if (
    ['wrong_step', 'wrong_cell', 'duplicated', 'blocked'].includes(result?.status)
    || result?.alert_level === 'yellow'
  ) {
    notificationBucket.warning += 1;
    notificationBucket.lastWarning = result?.message;
  } else {
    notificationBucket.error += 1;
    notificationBucket.lastError = result?.message || 'Leitura não aprovada.';
  }

  if (!notificationBucket.timer) {
    notificationBucket.timer = setTimeout(flushNotificationBucket, 350);
  }
}

function emitBatchResult(payload) {
  try {
    window.dispatchEvent(new CustomEvent('collection-batch-result', {
      detail: payload,
    }));
  } catch {
    // Ambiente sem window, como testes unitários.
  }
}

function notifyBatchResult(payload) {
  const {
    result,
    error,
    batchIndex = 0,
    batchCount = 1,
    source,
  } = payload;

  if (source === 'transport') {
    if (batchIndex !== batchCount - 1) return;
    toast.error(
      batchCount > 1
        ? `${batchCount} leituras permanecem protegidas na fila local para nova tentativa.`
        : (error?.message || 'Falha ao enviar a leitura; ela permanece na fila local.'),
    );
    return;
  }

  enqueueFinalNotification({ result, error });
}

/**
 * Hook que encapsula fila local, micro-lote de transporte e reconciliação do
 * resultado final produzido pelo worker assíncrono do Supabase.
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
    ?? (microBatch ? 500 : 15_000);
  const reconcileIntervalMs = options.reconcileIntervalMs ?? 1000;

  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    processing: 0,
    accepted: 0,
    serverReceived: 0,
    serverProcessing: 0,
    synced: 0,
    error: 0,
    hasStalePending: false,
    hasStaleServer: false,
    hasSlowEnqueue: false,
  });
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);
  const reconcilingRef = useRef(false);
  const fallbackLockRef = useRef(Promise.resolve());
  const statsRefreshTimerRef = useRef(null);
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

  const refreshStatsSafely = useCallback((delayMs = 75) => {
    if (statsRefreshTimerRef.current) return;
    statsRefreshTimerRef.current = setTimeout(() => {
      statsRefreshTimerRef.current = null;
      Promise.resolve(refreshStats()).catch((error) => {
        console.warn('[CollectionQueue] Falha ao atualizar estatísticas locais:', error);
      });
    }, Math.max(0, Number(delayMs) || 0));
  }, [refreshStats]);

  useEffect(() => () => {
    if (statsRefreshTimerRef.current) {
      clearTimeout(statsRefreshTimerRef.current);
      statsRefreshTimerRef.current = null;
    }
  }, []);

  const withQueueLock = useCallback(async (task) => {
    if (navigator.locks?.request) {
      return navigator.locks.request('acprod-collection-sync', task);
    }

    const currentTask = fallbackLockRef.current.then(task, task);
    fallbackLockRef.current = currentTask.catch(() => undefined);
    return currentTask;
  }, []);

  const handleFinalResult = useCallback((payload) => {
    emitBatchResult(payload);
    notifyBatchResult(payload);
    if (typeof onResultRef.current === 'function') {
      onResultRef.current(payload);
    }
  }, []);

  const reconcile = useCallback(async () => {
    if (!microBatch || reconcilingRef.current || !navigator.onLine) return;
    reconcilingRef.current = true;
    try {
      await reconcileAcceptedCollectionEvents({
        onResult: handleFinalResult,
      });
    } catch (error) {
      console.warn('[CollectionQueue] Reconciliação do inbox adiada:', error);
    } finally {
      reconcilingRef.current = false;
      refreshStatsSafely();
    }
  }, [handleFinalResult, microBatch, refreshStatsSafely]);

  const flush = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;

    await withQueueLock(async () => {
      if (flushingRef.current || !navigator.onLine) return;
      flushingRef.current = true;
      setFlushing(true);
      try {
        if (microBatch && typeof processBatchFnRef.current === 'function') {
          await flushCollectionMicroBatchQueue(processBatchFnRef.current, {
            batchSize,
            onResult: handleFinalResult,
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
    handleFinalResult,
    microBatch,
    refreshStats,
    withQueueLock,
  ]);

  useEffect(() => {
    let cancelled = false;
    const intervalMs = Math.max(
      250,
      Number(flushIntervalMs) || (microBatch ? 500 : 15_000),
    );

    const tryFlush = async () => {
      if (!cancelled && navigator.onLine) await flush();
    };

    tryFlush();
    const interval = setInterval(tryFlush, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [flush, flushIntervalMs, microBatch]);

  useEffect(() => {
    let cancelled = false;
    const recover = async () => {
      const recovered = await recoverStaleProcessingEvents();
      if (!cancelled && recovered > 0 && navigator.onLine) await flush();
    };
    recover().catch((error) => {
      console.warn('[CollectionQueue] Recuperação local adiada:', error);
    });
    const interval = setInterval(() => {
      recover().catch((error) => {
        console.warn('[CollectionQueue] Recuperação local adiada:', error);
      });
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [flush]);

  useEffect(() => {
    if (!microBatch) return undefined;
    const intervalMs = Math.max(500, Number(reconcileIntervalMs) || 1000);
    reconcile();
    const interval = setInterval(reconcile, intervalMs);
    return () => clearInterval(interval);
  }, [microBatch, reconcile, reconcileIntervalMs]);

  useEffect(() => {
    if (!microBatch) return undefined;
    const channel = subscribeToCollectionInboxUpdates({
      onResult: handleFinalResult,
    });
    return () => {
      unsubscribeFromCollectionInbox(channel);
    };
  }, [handleFinalResult, microBatch]);

  useEffect(() => {
    const prune = () => pruneSettledEvents({
      maxAgeMs: 60_000,
      keepLatest: 500,
    }).catch((error) => {
      console.warn('[CollectionQueue] Falha ao compactar fila local:', error);
    });
    prune();
    const interval = setInterval(prune, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = () => refreshStatsSafely();
    window.addEventListener('collection-queue-changed', handler);
    refreshStatsSafely();
    return () => window.removeEventListener('collection-queue-changed', handler);
  }, [refreshStatsSafely]);

  useEffect(() => {
    const trySync = async () => {
      if (!navigator.onLine) return;
      const currentStats = await getQueueStats();
      if (currentStats.pending > 0) await flush();
      if (currentStats.accepted > 0) await reconcile();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') trySync();
    };
    window.addEventListener('online', trySync);
    window.addEventListener('focus', trySync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', trySync);
      window.removeEventListener('focus', trySync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush, reconcile]);

  const enqueue = useCallback(async (payload, enqueueOpts = {}) => {
    // A persistência local libera o scanner e não bloqueia o próximo código.
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
    if (navigator.onLine && shouldFlushImmediately) flush();
    return id;
  }, [flush, microBatch, refreshStatsSafely]);

  const processNow = useCallback(async (clientEventId) => {
    if (microBatch) {
      refreshStatsSafely();
      return {
        success: true,
        accepted: true,
        pending: true,
        status: 'queued',
        alert_level: 'blue',
        client_event_id: clientEventId,
        message: 'Leitura protegida na fila local. Confirmação do servidor em andamento.',
      };
    }

    const result = await withQueueLock(() => (
      processCollectionEvent(clientEventId, processFnRef.current)
    ));
    refreshStatsSafely();
    return result;
  }, [microBatch, refreshStatsSafely, withQueueLock]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    refreshStatsSafely();
    if (count > 0 && navigator.onLine) flush();
    return count;
  }, [flush, refreshStatsSafely]);

  return {
    stats,
    flushing,
    enqueue,
    flush,
    reconcile,
    processNow,
    retryQueueErrors,
  };
}

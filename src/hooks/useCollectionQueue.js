import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS,
  enqueueCollectionEvent,
  flushCollectionQueue,
  getQueueStats,
  getQueueStatsByCellMachine,
  processCollectionEvent,
  retryErrors,
  runCollectionQueueMaintenance,
  runStaleProcessingRecovery,
} from '@/lib/collectionEventQueue';
import { flushCollectionMicroBatchQueue } from '@/lib/collectionMicroBatchQueue';
import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEventBatch,
} from '@/lib/collectionEventDispatcher';
import { getOperatorSession } from '@/lib/operatorSessionService';

const QUEUE_MAINTENANCE_IDLE_TIMEOUT_MS = 5_000;
const QUEUE_STATS_REFRESH_DEBOUNCE_MS = 100;

function emitBatchResult(payload) {
  try {
    window.dispatchEvent(new CustomEvent('collection-batch-result', {
      detail: payload,
    }));
  } catch {
    // Ambiente sem window, como testes unitários.
  }
}

function notifyBatchResult({
  result,
  error,
  batchIndex = 0,
  batchCount = 1,
}) {
  if (error) {
    toast.error(error.message || 'Falha ao sincronizar leitura.', {
      id: 'collection-sync-error',
    });
    return;
  }

  if (result?.success) {
    if (batchIndex === batchCount - 1) {
      const message = batchCount > 1
        ? `${batchCount} leituras processadas pelo servidor.`
        : (result.message || 'Leitura aprovada.');
      toast.success(message, { id: 'collection-sync-success' });
      navigator.vibrate?.([70, 40, 70]);
    }
    return;
  }

  if (['wrong_step', 'wrong_cell', 'duplicated', 'blocked'].includes(
    result?.status,
  ) || result?.alert_level === 'yellow') {
    toast.warning(result?.message || 'Leitura bloqueada.', {
      id: 'collection-sync-warning',
    });
    return;
  }

  toast.error(result?.message || 'Leitura não aprovada.', {
    id: 'collection-sync-error',
  });
}

/**
 * Hook que encapsula a fila de eventos de coleta em estado React.
 * A leitura física termina na gravação IndexedDB; o PostgreSQL é sincronizado
 * em segundo plano e nunca faz parte do caminho crítico do scanner.
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
    ?? (microBatch ? 1_000 : 15_000);
  const flushDebounceMs = Math.max(
    100,
    Number(options.flushDebounceMs) || 250,
  );

  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    processing: 0,
    synced: 0,
    error: 0,
    hasStalePending: false,
    hasSlowEnqueue: false,
  });
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);
  const scheduledFlushRef = useRef(null);
  const scheduledStatsRefreshRef = useRef(null);
  const statsRefreshInFlightRef = useRef(false);
  const statsRefreshQueuedRef = useRef(false);
  const fallbackLockRef = useRef(Promise.resolve());
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

  const runStatsRefresh = useCallback(async () => {
    if (statsRefreshInFlightRef.current) {
      statsRefreshQueuedRef.current = true;
      return;
    }

    statsRefreshInFlightRef.current = true;
    try {
      do {
        statsRefreshQueuedRef.current = false;
        try {
          await refreshStats();
        } catch (error) {
          console.warn('[CollectionQueue] Falha ao atualizar estatísticas locais:', error);
        }
      } while (statsRefreshQueuedRef.current);
    } finally {
      statsRefreshInFlightRef.current = false;
    }
  }, [refreshStats]);

  const refreshStatsSafely = useCallback((immediate = false) => {
    if (scheduledStatsRefreshRef.current !== null) {
      clearTimeout(scheduledStatsRefreshRef.current);
      scheduledStatsRefreshRef.current = null;
    }

    if (immediate) {
      runStatsRefresh();
      return;
    }

    scheduledStatsRefreshRef.current = setTimeout(() => {
      scheduledStatsRefreshRef.current = null;
      runStatsRefresh();
    }, QUEUE_STATS_REFRESH_DEBOUNCE_MS);
  }, [runStatsRefresh]);

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

  const flush = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;

    await withQueueLock(async () => {
      if (flushingRef.current || !navigator.onLine) return;
      flushingRef.current = true;
      setFlushing(true);
      try {
        try {
          await runStaleProcessingRecovery();
        } catch (error) {
          // Recuperar itens órfãos é manutenção defensiva; uma falha aqui não
          // pode impedir o envio dos eventos pending já prontos para o servidor.
          console.warn('[CollectionQueue] Falha ao recuperar eventos travados:', error);
        }

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

  const scheduleFlush = useCallback(() => {
    if (!navigator.onLine || scheduledFlushRef.current) return;

    scheduledFlushRef.current = setTimeout(() => {
      scheduledFlushRef.current = null;
      flush().catch((error) => {
        console.warn('[CollectionQueue] Falha no flush agendado:', error);
      });
    }, flushDebounceMs);
  }, [flush, flushDebounceMs]);

  useEffect(() => {
    let cancelled = false;
    const intervalMs = Math.max(
      1_000,
      Number(flushIntervalMs) || (microBatch ? 1_000 : 15_000),
    );

    const flushIfOnline = async () => {
      if (!cancelled && navigator.onLine) await flush();
    };

    flushIfOnline();
    const interval = setInterval(flushIfOnline, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (scheduledFlushRef.current) {
        clearTimeout(scheduledFlushRef.current);
        scheduledFlushRef.current = null;
      }
    };
  }, [flush, flushIntervalMs, microBatch]);

  useEffect(() => {
    let cancelled = false;
    let idleHandle = null;
    let timeoutHandle = null;

    const runMaintenance = () => {
      idleHandle = null;
      timeoutHandle = null;
      if (cancelled) return;
      Promise.resolve(runCollectionQueueMaintenance())
        .then((result) => {
          if (!cancelled && result?.hasMore) scheduleMaintenance();
        })
        .catch((error) => {
          console.warn('[CollectionQueue] Falha na manutenção da fila local:', error);
        });
    };

    const scheduleMaintenance = () => {
      if (cancelled || idleHandle !== null || timeoutHandle !== null) return;

      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(runMaintenance, {
          timeout: QUEUE_MAINTENANCE_IDLE_TIMEOUT_MS,
        });
      } else {
        timeoutHandle = window.setTimeout(
          runMaintenance,
          QUEUE_MAINTENANCE_IDLE_TIMEOUT_MS,
        );
      }
    };

    scheduleMaintenance();
    const interval = window.setInterval(
      scheduleMaintenance,
      COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (idleHandle !== null) {
        window.cancelIdleCallback?.(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

  useEffect(() => {
    const handler = () => refreshStatsSafely();
    window.addEventListener('collection-queue-changed', handler);
    refreshStatsSafely(true);
    return () => {
      window.removeEventListener('collection-queue-changed', handler);
      if (scheduledStatsRefreshRef.current !== null) {
        clearTimeout(scheduledStatsRefreshRef.current);
        scheduledStatsRefreshRef.current = null;
      }
    };
  }, [refreshStatsSafely]);

  useEffect(() => {
    const tryFlush = async () => {
      if (!navigator.onLine) return;
      const currentStats = await getQueueStats();
      if (currentStats.pending > 0) scheduleFlush();
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
  }, [scheduleFlush]);

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

    // A gravação durável no IndexedDB não bloqueia o próximo código; o envio
    // ao Supabase é agendado separadamente e preserva a ordem FIFO da fila.
    const id = await enqueueCollectionEvent(payload);
    refreshStatsSafely();

    if (navigator.onLine && microBatch) {
      scheduleFlush();
    } else if (
      navigator.onLine
      && (enqueueOpts.autoFlush === true || enqueueOpts.autoFlush !== false)
    ) {
      flush();
    }
    return id;
  }, [
    flush,
    microBatch,
    refreshStatsSafely,
    scheduleFlush,
  ]);

  const processNow = useCallback(async (clientEventId) => {
    if (microBatch) {
      scheduleFlush();
      refreshStatsSafely();
      return {
        success: true,
        accepted: true,
        pending: true,
        status: 'queued',
        alert_level: 'blue',
        client_event_id: clientEventId,
        message: 'Leitura recebida localmente. Validação em segundo plano.',
      };
    }

    const result = await withQueueLock(() => (
      processCollectionEvent(clientEventId, processFnRef.current)
    ));
    refreshStatsSafely();
    return result;
  }, [
    microBatch,
    refreshStatsSafely,
    scheduleFlush,
    withQueueLock,
  ]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    refreshStatsSafely();
    if (count > 0 && navigator.onLine) scheduleFlush();
    return count;
  }, [refreshStatsSafely, scheduleFlush]);

  return {
    stats,
    flushing,
    enqueue,
    flush,
    processNow,
    retryQueueErrors,
  };
}

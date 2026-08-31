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
} from '@/lib/collectionEventQueue';
import { flushCollectionMicroBatchQueue } from '@/lib/collectionMicroBatchQueue';
import {
  COLLECTION_EVENT_KINDS,
  dispatchCollectionEventBatch,
} from '@/lib/collectionEventDispatcher';

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
    toast.error(error.message || 'Falha ao sincronizar leitura.');
    return;
  }

  if (result?.success) {
    if (batchIndex === batchCount - 1) {
      const message = batchCount > 1
        ? `${batchCount} leituras sincronizadas com o Supabase.`
        : (result.message || 'Leitura aprovada.');
      toast.success(message);
      navigator.vibrate?.([70, 40, 70]);
    }
    return;
  }

  if (['wrong_step', 'wrong_cell', 'duplicated', 'blocked'].includes(
    result?.status,
  ) || result?.alert_level === 'yellow') {
    toast.warning(result?.message || 'Leitura bloqueada.');
    return;
  }

  toast.error(result?.message || 'Leitura não aprovada.');
}

/**
 * Hook que encapsula a fila de eventos de coleta em estado React.
 * @param {function} processFn — função legada que processa um evento individual
 * @param {object} options — filtros e configuração de sincronização
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
    ?? (microBatch ? 5000 : 15000);

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

  const refreshStatsSafely = useCallback(() => {
    Promise.resolve(refreshStats()).catch((error) => {
      console.warn('[CollectionQueue] Falha ao atualizar estatísticas locais:', error);
    });
  }, [refreshStats]);

  const withQueueLock = useCallback(async (task) => {
    if (navigator.locks?.request) {
      return navigator.locks.request('acprod-collection-sync', task);
    }

    // Safari e navegadores antigos: preserva FIFO por uma corrente de Promises,
    // sem impedir que novos códigos continuem sendo gravados no IndexedDB.
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
        await recoverStaleProcessingEvents();

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

  useEffect(() => {
    let cancelled = false;
    const intervalMs = Math.max(
      1000,
      Number(flushIntervalMs) || (microBatch ? 5000 : 15000),
    );

    const recoverAndFlush = async () => {
      await recoverStaleProcessingEvents();
      if (!cancelled && navigator.onLine) await flush();
    };

    recoverAndFlush();
    const interval = setInterval(recoverAndFlush, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [flush, flushIntervalMs, microBatch]);

  useEffect(() => {
    const handler = () => refreshStatsSafely();
    window.addEventListener('collection-queue-changed', handler);
    refreshStatsSafely();
    return () => window.removeEventListener('collection-queue-changed', handler);
  }, [refreshStatsSafely]);

  useEffect(() => {
    const tryFlush = async () => {
      if (!navigator.onLine) return;
      const currentStats = await getQueueStats();
      if (currentStats.pending > 0) await flush();
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
  }, [flush]);

  const enqueue = useCallback(async (payload, enqueueOpts = {}) => {
    // O retorno acontece logo após a gravação durável no IndexedDB. O cálculo
    // dos contadores e a sincronização não bloqueiam o próximo código.
    const id = await enqueueCollectionEvent(payload);
    refreshStatsSafely();

    const shouldFlushImmediately = enqueueOpts.autoFlush === true
      || (!microBatch && enqueueOpts.autoFlush !== false);
    if (navigator.onLine && shouldFlushImmediately) {
      flush();
    }
    return id;
  }, [flush, microBatch, refreshStatsSafely]);

  const processNow = useCallback(async (clientEventId) => {
    if (microBatch) {
      // Compatibilidade com a tela atual: confirma a recepção local, mas não
      // espera o PostgreSQL. O setInterval fará o envio em lote em até 5s.
      refreshStatsSafely();
      return {
        success: true,
        accepted: true,
        pending: true,
        status: 'queued',
        alert_level: 'blue',
        client_event_id: clientEventId,
        message: 'Leitura recebida. Sincronização em micro-lote iniciada.',
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
    processNow,
    retryQueueErrors,
  };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  enqueueCollectionEvent,
  flushCollectionQueue,
  getQueueStats,
  getQueueStatsByCellMachine,
  processCollectionEvent,
  retryErrors,
  recoverStaleProcessingEvents,
} from '@/lib/collectionEventQueue';

/**
 * Hook que encapsula a fila de eventos de coleta em estado React.
 * @param {function} processFn — função que processa um evento e o persiste no Supabase
 * @param {object} options — opções de filtro (cellName, machineId)
 */
export function useCollectionQueue(processFn, options = {}) {
  const { cellName, machineId, eventKind } = options;
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
  processFnRef.current = processFn;

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

  const flush = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;

    await withQueueLock(async () => {
      if (flushingRef.current || !navigator.onLine) return;
      flushingRef.current = true;
      setFlushing(true);
      try {
        await recoverStaleProcessingEvents();
        await flushCollectionQueue(processFnRef.current);
      } finally {
        flushingRef.current = false;
        setFlushing(false);
        await refreshStats();
      }
    });
  }, [refreshStats, withQueueLock]);

  useEffect(() => {
    let cancelled = false;

    const recoverAndFlush = async () => {
      await recoverStaleProcessingEvents();
      if (!cancelled && navigator.onLine) await flush();
    };

    recoverAndFlush();
    const interval = setInterval(recoverAndFlush, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [flush]);

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
    // dos contadores é assíncrono e não bloqueia o próximo código do coletor.
    const id = await enqueueCollectionEvent(payload);
    refreshStatsSafely();
    if (navigator.onLine && enqueueOpts.autoFlush !== false) {
      flush();
    }
    return id;
  }, [flush, refreshStatsSafely]);

  const processNow = useCallback(async (clientEventId) => {
    const result = await withQueueLock(() => (
      processCollectionEvent(clientEventId, processFnRef.current)
    ));
    refreshStatsSafely();
    return result;
  }, [refreshStatsSafely, withQueueLock]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    refreshStatsSafely();
    if (count > 0 && navigator.onLine) flush();
    return count;
  }, [flush, refreshStatsSafely]);

  return { stats, flushing, enqueue, flush, processNow, retryQueueErrors };
}

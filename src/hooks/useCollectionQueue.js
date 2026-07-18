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
  const { cellName, machineId } = options;
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
  const processFnRef = useRef(processFn);
  processFnRef.current = processFn;

  const refreshStats = useCallback(async () => {
    const s = (cellName || machineId)
      ? await getQueueStatsByCellMachine(cellName, machineId)
      : await getQueueStats();
    setStats(s);
  }, [cellName, machineId]);

  const withQueueLock = useCallback(async (task) => {
    if (navigator.locks?.request) {
      return navigator.locks.request('acprod-collection-sync', task);
    }
    return task();
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

  // Recupera eventos interrompidos e tenta sincronizar também quando a página
  // já é aberta online (não apenas após um evento offline -> online).
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

  // Escuta eventos de mudança da fila
  useEffect(() => {
    const handler = () => refreshStats();
    window.addEventListener('collection-queue-changed', handler);
    refreshStats(); // estado inicial
    return () => window.removeEventListener('collection-queue-changed', handler);
  }, [refreshStats]);

  // Flush automático ao reconectar, voltar para a aba ou focar a janela.
  useEffect(() => {
    const tryFlush = async () => {
      if (!navigator.onLine) return;
      const s = await getQueueStats();
      if (s.pending > 0) await flush();
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
    const id = await enqueueCollectionEvent(payload);
    await refreshStats();
    if (navigator.onLine && enqueueOpts.autoFlush !== false) {
      flush();
    }
    return id;
  }, [flush, refreshStats]);

  const processNow = useCallback(async (clientEventId) => {
    const result = await withQueueLock(() => (
      processCollectionEvent(clientEventId, processFnRef.current)
    ));
    await refreshStats();
    return result;
  }, [refreshStats, withQueueLock]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    await refreshStats();
    if (count > 0 && navigator.onLine) flush();
    return count;
  }, [refreshStats, flush]);

  return { stats, flushing, enqueue, flush, processNow, retryQueueErrors };
}

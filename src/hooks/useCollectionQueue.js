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
  const processFnRef = useRef(processFn);
  processFnRef.current = processFn;

  const refreshStats = useCallback(async () => {
    const s = (cellName || machineId)
      ? await getQueueStatsByCellMachine(cellName, machineId)
      : await getQueueStats();
    setStats(s);
  }, [cellName, machineId]);

  // Recuperação de processamento travado periódico
  useEffect(() => {
    recoverStaleProcessingEvents();
    const interval = setInterval(() => {
      recoverStaleProcessingEvents();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Escuta eventos de mudança da fila
  useEffect(() => {
    const handler = () => refreshStats();
    window.addEventListener('collection-queue-changed', handler);
    refreshStats(); // estado inicial
    return () => window.removeEventListener('collection-queue-changed', handler);
  }, [refreshStats]);

  // Flush automático quando voltar online
  useEffect(() => {
    const onOnline = async () => {
      const s = await getQueueStats();
      if (s.pending > 0) flush();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    if (flushing || !navigator.onLine) return;
    setFlushing(true);
    try {
      await recoverStaleProcessingEvents(); // recuperar antes do flush
      await flushCollectionQueue(processFnRef.current);
    } finally {
      setFlushing(false);
      refreshStats();
    }
  }, [flushing, refreshStats]);

  const enqueue = useCallback(async (payload, enqueueOpts = {}) => {
    const id = await enqueueCollectionEvent(payload);
    await refreshStats();
    if (navigator.onLine && enqueueOpts.autoFlush !== false) {
      flush();
    }
    return id;
  }, [flush, refreshStats]);

  const processNow = useCallback(async (clientEventId) => {
    const result = await processCollectionEvent(clientEventId, processFnRef.current);
    await refreshStats();
    return result;
  }, [refreshStats]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    await refreshStats();
    if (count > 0 && navigator.onLine) flush();
    return count;
  }, [refreshStats, flush]);

  return { stats, flushing, enqueue, flush, processNow, retryQueueErrors };
}

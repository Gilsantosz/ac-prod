import { useState, useEffect, useCallback, useRef } from 'react';
import {
  enqueueCollectionEvent,
  flushCollectionQueue,
  getQueueStats,
  retryErrors,
} from '@/lib/collectionEventQueue';

/**
 * Hook que encapsula a fila de eventos de coleta em estado React.
 * @param {function} processFn — função que processa um evento e o persiste no Supabase
 */
export function useCollectionQueue(processFn) {
  const [stats, setStats] = useState({ total: 0, pending: 0, processing: 0, synced: 0, error: 0 });
  const [flushing, setFlushing] = useState(false);
  const processFnRef = useRef(processFn);
  processFnRef.current = processFn;

  const refreshStats = useCallback(async () => {
    const s = await getQueueStats();
    setStats(s);
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

  const enqueue = useCallback(async (payload) => {
    const id = await enqueueCollectionEvent(payload);
    await refreshStats();
    // Tenta processar imediatamente se online
    if (navigator.onLine) {
      flush(); // não aguarda
    }
    return id;
  }, [refreshStats]);

  const flush = useCallback(async () => {
    if (flushing || !navigator.onLine) return;
    setFlushing(true);
    try {
      await flushCollectionQueue(processFnRef.current);
    } finally {
      setFlushing(false);
      refreshStats();
    }
  }, [flushing, refreshStats]);

  const retryQueueErrors = useCallback(async () => {
    const count = await retryErrors();
    await refreshStats();
    if (count > 0 && navigator.onLine) flush();
    return count;
  }, [refreshStats, flush]);

  return { stats, flushing, enqueue, flush, retryQueueErrors };
}

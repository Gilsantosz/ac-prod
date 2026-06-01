import { useState, useEffect, useCallback } from 'react';
import { getQueue, enqueue, flushQueue } from '@/lib/offlineQueue';

// Gerencia status online/offline, fila pendente e sincronização automática.
export function useOfflineSync(createFn, onSynced) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(getQueue().length);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => setPending(getQueue().length), []);

  const sync = useCallback(async () => {
    if (!navigator.onLine || syncing || getQueue().length === 0) return;
    setSyncing(true);
    const res = await flushQueue(createFn);
    refresh();
    setSyncing(false);
    if (res.synced > 0) onSynced?.(res.synced);
  }, [createFn, onSynced, syncing, refresh]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('offline-queue-changed', refresh);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('offline-queue-changed', refresh);
    };
  }, [sync, refresh]);

  // Tenta sincronizar ao montar (caso tenha ficado pendente de sessão anterior)
  useEffect(() => { sync(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Salva: online cria direto; offline enfileira
  const save = useCallback(async (data) => {
    if (navigator.onLine) {
      await createFn(data);
    } else {
      enqueue(data);
      refresh();
    }
  }, [createFn, refresh]);

  return { online, pending, syncing, save, sync };
}
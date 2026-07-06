/**
 * @deprecated-scope FASE 1 — AC.Prod MES (2025-07)
 *
 * Este hook serve APENAS para apontamentos manuais de produção (Entry.jsx).
 * Usa localStorage via offlineQueue.js — sem idempotência, sem audit_log.
 *
 * Para coleta rastreável por código de barras/RFID:
 *   → usar: src/hooks/useCollectionQueue.js   (IndexedDB + idempotência por client_event_id)
 *
 * Não criar novos usos deste hook para funcionalidades de rastreabilidade.
 */
import { useState, useEffect, useCallback } from 'react';
import { getQueue, enqueue, flushQueue } from '@/lib/offlineQueue';

// Gerencia status online/offline, fila pendente e sincronização automática.
// ESCOPO: apontamentos manuais de produção (Entry.jsx) ← não usar para coleta rastreável
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
  useEffect(() => { sync(); }, []);  

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
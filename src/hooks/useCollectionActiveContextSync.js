import { useCallback, useEffect, useMemo, useState } from 'react';
import { scheduleCollectionQueryInvalidation } from '@/hooks/collectionQueryInvalidation';
import { collectionContextMatchesMachine } from '@/lib/collectionContextScope';
import {
  subscribeToCollectionActiveContext,
  unsubscribeFromCollectionActiveContext,
} from '@/lib/collectionService';

export const COLLECTION_CONTEXT_SAFETY_MIN_MS = 4 * 60 * 1000;
export const COLLECTION_CONTEXT_SAFETY_JITTER_MS = 2 * 60 * 1000;

/**
 * Mantém apenas o contexto de lote da estação sincronizado. O retorno mais
 * recente pode ser aplicado imediatamente ao banner; a fotografia dos KPIs é
 * refeita em seguida para confirmar o estado autoritativo do banco.
 */
export function useCollectionActiveContextSync({
  cellId,
  cellName,
  machineId,
  queryClient,
}) {
  const scopeKey = useMemo(() => [
    cellId || '',
    String(cellName || '').trim().toLowerCase(),
    machineId || '',
  ].join(':'), [cellId, cellName, machineId]);
  const [latestUpdate, setLatestUpdate] = useState(null);
  const [snapshotPriorityScope, setSnapshotPriorityScope] = useState(null);

  const invalidateContextSnapshot = useCallback(() => {
    if (!cellName) return;
    scheduleCollectionQueryInvalidation(
      queryClient,
      {
        predicate: (query) => {
          const key = query.queryKey || [];
          return key[0] === 'collection-kpis'
            && key[1] === cellName
            && (!machineId || !key[2] || String(key[2]) === String(machineId));
        },
      },
      JSON.stringify(['collection-active-context', cellName, machineId || null]),
    );
  }, [cellName, machineId, queryClient]);

  useEffect(() => {
    if (!cellName) return undefined;
    let cancelled = false;

    const channel = subscribeToCollectionActiveContext({
      cellId,
      cellName,
      channelSuffix: 'station',
      callback: (payload = {}) => {
        if (cancelled) return;
        const row = payload.new || null;
        const eventMachineId = row?.machine_id || null;
        if (!row || !collectionContextMatchesMachine(machineId, eventMachineId)) return;

        setLatestUpdate({ scopeKey, context: row });
        setSnapshotPriorityScope(scopeKey);
        invalidateContextSnapshot();
      },
      onReady: () => {
        if (cancelled) return;
        // Confirma qualquer troca ocorrida entre o primeiro GET e o listener
        // de Postgres Changes ficar efetivamente pronto no servidor.
        setLatestUpdate((current) => current?.scopeKey === scopeKey ? null : current);
        setSnapshotPriorityScope(scopeKey);
        invalidateContextSnapshot();
      },
      onStatus: (status) => {
        if (cancelled) return;
        // SUBSCRIBED permanece como fallback para versões do protocolo que não
        // emitam system/ok. Erros e reconexões também descartam o overlay.
        if (status === 'SUBSCRIBED'
          || status === 'CHANNEL_ERROR'
          || status === 'TIMED_OUT'
          || status === 'CLOSED') {
          // Em uma reconexão, descarte a linha recebida antes da queda. O GET
          // estreito passa a ser a autoridade até chegar o próximo evento.
          setLatestUpdate((current) => current?.scopeKey === scopeKey ? null : current);
          setSnapshotPriorityScope(scopeKey);
          invalidateContextSnapshot();
        }
      },
    });

    return () => {
      cancelled = true;
      unsubscribeFromCollectionActiveContext(channel);
    };
  }, [cellId, cellName, invalidateContextSnapshot, machineId, scopeKey]);

  useEffect(() => {
    if (!cellName) return undefined;
    let cancelled = false;
    let safetyTimer = null;

    const reconcileSnapshot = () => {
      if (cancelled) return;
      setLatestUpdate((current) => current?.scopeKey === scopeKey ? null : current);
      setSnapshotPriorityScope(scopeKey);
      invalidateContextSnapshot();
    };
    const scheduleSafetyCheck = () => {
      const jitter = Math.floor(Math.random() * COLLECTION_CONTEXT_SAFETY_JITTER_MS);
      safetyTimer = window.setTimeout(() => {
        reconcileSnapshot();
        if (!cancelled) scheduleSafetyCheck();
      }, COLLECTION_CONTEXT_SAFETY_MIN_MS + jitter);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconcileSnapshot();
    };

    window.addEventListener('focus', reconcileSnapshot);
    window.addEventListener('online', reconcileSnapshot);
    document.addEventListener('visibilitychange', onVisibility);
    scheduleSafetyCheck();

    return () => {
      cancelled = true;
      if (safetyTimer !== null) window.clearTimeout(safetyTimer);
      window.removeEventListener('focus', reconcileSnapshot);
      window.removeEventListener('online', reconcileSnapshot);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cellName, invalidateContextSnapshot, scopeKey]);

  const hasRealtimeUpdate = latestUpdate?.scopeKey === scopeKey;
  const preferSnapshot = snapshotPriorityScope === scopeKey;
  const resetRealtimeUpdate = useCallback(() => {
    setLatestUpdate(null);
    setSnapshotPriorityScope(null);
  }, []);

  return {
    activeContext: hasRealtimeUpdate ? latestUpdate.context : null,
    hasRealtimeUpdate,
    preferSnapshot,
    resetRealtimeUpdate,
  };
}

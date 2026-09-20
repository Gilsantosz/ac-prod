import { useCallback, useEffect, useMemo, useState } from 'react';
import { scheduleCollectionQueryInvalidation } from '@/hooks/collectionQueryInvalidation';
import { collectionContextMatchesMachine } from '@/lib/collectionContextScope';
import {
  subscribeToCollectionActiveContext,
  unsubscribeFromCollectionActiveContext,
} from '@/lib/collectionService';

export const COLLECTION_CONTEXT_SAFETY_MIN_MS = 60_000;
export const COLLECTION_CONTEXT_SAFETY_JITTER_MS = 30_000;
export const COLLECTION_CONTEXT_HTTP_MIN_MS = 60_000;
export const COLLECTION_CONTEXT_HTTP_JITTER_MS = 30_000;

export function getCollectionContextSafetyDelay(realtimeEnabled, randomValue = Math.random()) {
  const numericValue = Number(randomValue);
  const boundedValue = Number.isFinite(numericValue)
    ? Math.min(1, Math.max(0, numericValue))
    : 0;
  const minMs = realtimeEnabled ? COLLECTION_CONTEXT_SAFETY_MIN_MS : COLLECTION_CONTEXT_HTTP_MIN_MS;
  const jitterMs = realtimeEnabled ? COLLECTION_CONTEXT_SAFETY_JITTER_MS : COLLECTION_CONTEXT_HTTP_JITTER_MS;
  return minMs + Math.floor(boundedValue * jitterMs);
}

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
  realtimeEnabled = false,
  periodicReconciliationEnabled = true,
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
    if (!realtimeEnabled) {
      setLatestUpdate((current) => current?.scopeKey === scopeKey ? null : current);
      setSnapshotPriorityScope(scopeKey);
      return undefined;
    }
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
  }, [cellId, cellName, invalidateContextSnapshot, machineId, realtimeEnabled, scopeKey]);

  useEffect(() => {
    if (!cellName || !periodicReconciliationEnabled) return undefined;
    let cancelled = false;
    let safetyTimer = null;

    const reconcileSnapshot = () => {
      if (cancelled || navigator.onLine === false || document.visibilityState === 'hidden') return;
      setLatestUpdate((current) => current?.scopeKey === scopeKey ? null : current);
      setSnapshotPriorityScope(scopeKey);
      invalidateContextSnapshot();
    };
    const scheduleSafetyCheck = () => {
      safetyTimer = window.setTimeout(() => {
        reconcileSnapshot();
        if (!cancelled) scheduleSafetyCheck();
      }, getCollectionContextSafetyDelay(realtimeEnabled));
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
  }, [
    cellName,
    invalidateContextSnapshot,
    periodicReconciliationEnabled,
    realtimeEnabled,
    scopeKey,
  ]);

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

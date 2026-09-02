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
import { getCollectionDeviceId } from '@/lib/collectionDeviceIdentity';
import {
  COLLECTION_PIPELINE_FLAGS_CACHE_MS,
  getCollectionPipelineFlagsV3,
  isCollectionPipelineFlagEnabled,
  isCollectionPipelineV3Enabled,
} from '@/lib/collectionBatchService';
import {
  persistCollectionBroadcastMessage,
  reconcileCollectionEventsV3,
  subscribeToCollectionBroadcastV3,
  unsubscribeFromCollectionBroadcastV3,
} from '@/lib/collectionRealtimeService';
import {
  COLLECTION_STATES,
  collectionStateFromResult,
  isCollectionTerminalState,
} from '@/lib/collectionStateMachine';

const QUEUE_MAINTENANCE_IDLE_TIMEOUT_MS = 5_000;
const QUEUE_STATS_REFRESH_DEBOUNCE_MS = 100;
const COLLECTION_RECONCILIATION_INTERVAL_MS = 15_000;
const COLLECTION_RECONCILIATION_CONNECTED_STALE_MS = 30_000;
const COLLECTION_RECONCILIATION_DISCONNECTED_STALE_MS = 5_000;

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
  state: providedState,
  batchIndex = 0,
  batchCount = 1,
}) {
  const state = collectionStateFromResult(result)
    || collectionStateFromResult({ state: providedState });
  if (error) {
    toast.error(error.message || 'Falha ao sincronizar leitura.', {
      id: 'collection-sync-error',
    });
    return;
  }

  if (state === COLLECTION_STATES.APPROVED) {
    if (batchIndex === batchCount - 1) {
      const message = batchCount > 1
        ? `${batchCount} leituras processadas pelo servidor.`
        : (result.message || 'Leitura aprovada.');
      toast.success(message, { id: 'collection-sync-success' });
      navigator.vibrate?.([70, 40, 70]);
    }
    return;
  }

  if (!state || !isCollectionTerminalState(state)) {
    if (batchIndex === batchCount - 1) {
      toast.info(
        result?.message || 'Leitura recebida e aguardando decisão final.',
        { id: 'collection-sync-pending' },
      );
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

function updateCounter(previous, delta, key) {
  const change = Number(delta?.[key] ?? delta?.[`${key}_delta`]);
  if (!Number.isFinite(change) || change === 0) return previous;
  return Math.max(0, (Number(previous) || 0) + change);
}

export function applyCollectionProjectionDelta(queryClient, payload = {}, defaults = {}) {
  if (!queryClient?.setQueriesData) return;
  const quantity = Math.max(1, Number(payload.quantity) || 1);
  const decision = String(payload.decision || '').toLowerCase();
  const delta = payload.delta || payload.projection_delta || (decision ? {
    total: quantity,
    [decision === 'pending_review' ? 'pending' : decision]: quantity,
  } : payload);
  const affectedCell = payload.cell_name || payload.cellName || defaults.cellName;
  const affectedMachine = payload.machine_id || payload.machineId || defaults.machineId;
  const affectedGeneralLot = payload.pcp_import_batch_id || payload.pcpImportBatchId;
  queryClient.setQueriesData({
    predicate: (query) => query.queryKey?.[0] === 'collection-kpis'
      && (!affectedCell || query.queryKey?.[1] === affectedCell)
      && (!affectedMachine || !query.queryKey?.[2] || query.queryKey?.[2] === affectedMachine)
      && (!query.queryKey?.[6]
        || (affectedGeneralLot && query.queryKey?.[6] === affectedGeneralLot)),
  }, (previous) => {
    if (!previous || typeof previous !== 'object') return previous;
    return {
      ...previous,
      total: updateCounter(previous.total, delta, 'total'),
      approved: updateCounter(previous.approved, delta, 'approved'),
      rejected: updateCounter(previous.rejected, delta, 'rejected'),
      blocked: updateCounter(previous.blocked, delta, 'blocked'),
      duplicated: updateCounter(previous.duplicated, delta, 'duplicated'),
      pending: updateCounter(previous.pending, delta, 'pending'),
      rework: updateCounter(previous.rework, delta, 'rework'),
      replacement: updateCounter(previous.replacement, delta, 'replacement'),
    };
  });
}

export function getCollectionProjectionDedupeKey(payload = {}) {
  return [
    // O mesmo outbox chega nos canais device e cell. outbox_id preserva a
    // distinção entre projeções/compensações futuras do mesmo evento.
    payload.outbox_id || payload.client_event_id,
    payload.projected_at,
    payload.decision,
  ].filter(Boolean).join(':');
}

export function invalidateAffectedCollectionQueries(queryClient, payload = {}, defaults = {}) {
  if (!queryClient?.invalidateQueries) return;
  const cellName = payload.cell_name || payload.cellName || defaults.cellName;
  const machineId = payload.machine_id || payload.machineId || defaults.machineId;
  const affectedOperatorId = payload.operator_id
    || payload.operatorId
    || defaults.operatorId;
  const affected = (query) => {
    const key = query.queryKey || [];
    if (key[0] === 'collection-kpis') return !cellName || key[1] === cellName;
    if (key[0] === 'operator-shift-kpis') {
      return !affectedOperatorId || key[1] === affectedOperatorId;
    }
    if (key[0] === 'stageReadings') {
      return (!cellName || key[1] === cellName)
        && (!machineId || !key[2] || key[2] === machineId);
    }
    return false;
  };
  queryClient.invalidateQueries({ predicate: affected });
}

/**
 * Hook que encapsula a fila de eventos de coleta em estado React.
 * A leitura física termina na gravação IndexedDB; o PostgreSQL é sincronizado
 * em segundo plano e nunca faz parte do caminho crítico do scanner.
 */
export function useCollectionQueue(processFn, options = {}) {
  const {
    cellName,
    cellId,
    machineId,
    eventKind,
    batchSize = 25,
    operatorId = null,
    queryClient = null,
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
  const [pipelineV3Enabled, setPipelineV3Enabled] = useState(false);
  const [pipelineFlagsRefreshTick, setPipelineFlagsRefreshTick] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState('DISCONNECTED');
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const [deviceId] = useState(() => getCollectionDeviceId());
  const flushingRef = useRef(false);
  const scheduledFlushRef = useRef(null);
  const scheduledStatsRefreshRef = useRef(null);
  const statsRefreshInFlightRef = useRef(false);
  const statsRefreshQueuedRef = useRef(false);
  const fallbackLockRef = useRef(Promise.resolve());
  const realtimeStatusRef = useRef('DISCONNECTED');
  const appliedProjectionIdsRef = useRef(new Set());
  const pipelineFlagModesRef = useRef({ ingress: null, broadcast: null });
  const processFnRef = useRef(processFn);
  const processBatchFnRef = useRef(processBatchFn);
  const onResultRef = useRef(onResult);
  processFnRef.current = processFn;
  processBatchFnRef.current = processBatchFn;
  onResultRef.current = onResult;

  const setRealtimeStatusSafely = useCallback((status) => {
    realtimeStatusRef.current = status;
    setRealtimeStatus(status);
  }, []);

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

  useEffect(() => {
    const realtimeRequested = microBatch
      && eventKind === COLLECTION_EVENT_KINDS.PRODUCTION_STAGE
      && Boolean(cellId)
      && options.enableV3Realtime !== false;
    if (!realtimeRequested) {
      setPipelineV3Enabled(false);
      setRealtimeStatusSafely('DISABLED');
      return undefined;
    }

    let cancelled = false;
    let subscription = null;
    let reconciliationInterval = null;
    let flagRefreshInterval = null;
    const channelStatuses = new Map();

    const resolveFlagModes = (flags) => ({
      ingress: options.forceV3 === true
        || isCollectionPipelineV3Enabled(flags, { deviceId, cellId, machineId }),
      broadcast: isCollectionPipelineFlagEnabled(
        flags,
        'collection_pipeline_v3_broadcast',
        { deviceId, cellId, machineId },
      ),
    });

    // Uma tela aberta durante rollout/rollback não pode ficar eternamente com
    // a primeira fotografia das flags. A checagem é global por dispositivo,
    // nunca por leitura; uma mudança recria os canais e a reconciliação.
    const refreshFlagModes = async () => {
      if (cancelled || options.pipelineFlags) return;
      try {
        const freshFlags = await getCollectionPipelineFlagsV3({ force: true });
        const nextModes = resolveFlagModes(freshFlags);
        const currentModes = pipelineFlagModesRef.current;
        if (nextModes.ingress !== currentModes.ingress
          || nextModes.broadcast !== currentModes.broadcast) {
          pipelineFlagModesRef.current = nextModes;
          setPipelineFlagsRefreshTick((value) => value + 1);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[CollectionQueue] Falha ao atualizar flags V3:', error);
        }
      }
    };

    const requestFlagRefresh = () => {
      if (globalThis.navigator?.onLine !== false) refreshFlagModes();
    };
    if (!options.pipelineFlags) {
      flagRefreshInterval = window.setInterval(
        refreshFlagModes,
        COLLECTION_PIPELINE_FLAGS_CACHE_MS,
      );
      window.addEventListener('focus', requestFlagRefresh);
      window.addEventListener('online', requestFlagRefresh);
    }

    const publishUpdate = async (update) => {
      if (cancelled || !update) return;
      const payload = update.payload || {};
      const eventName = payload.broadcast_event;
      if (eventName === 'collection.projection_delta') {
        const projectionKey = getCollectionProjectionDedupeKey(payload);
        if (projectionKey && appliedProjectionIdsRef.current.has(projectionKey)) return;
        if (projectionKey) {
          appliedProjectionIdsRef.current.add(projectionKey);
          if (appliedProjectionIdsRef.current.size > 500) {
            const oldest = appliedProjectionIdsRef.current.values().next().value;
            appliedProjectionIdsRef.current.delete(oldest);
          }
        }
        applyCollectionProjectionDelta(queryClient, payload, {
          cellName,
          machineId,
        });
        options.onProjectionDelta?.(payload);
        if (update.event && update.state) {
          handleBatchResult({
            event: update.event,
            result: payload,
            error: null,
            state: update.state,
            acknowledged: false,
            finalized: isCollectionTerminalState(update.state),
            batchIndex: 0,
            batchCount: 1,
          });
          invalidateAffectedCollectionQueries(queryClient, payload, {
            cellName,
            machineId,
            operatorId,
          });
          options.onFinalized?.(payload);
        }
        return;
      }

      const state = update.state || collectionStateFromResult(payload);
      handleBatchResult({
        event: update.event,
        result: payload.result ?? payload.resultado ?? payload,
        error: state === COLLECTION_STATES.DEAD_LETTERED
          ? new Error(payload.message || payload.error || 'Leitura enviada para análise manual.')
          : null,
        state,
        acknowledged: state === COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
        finalized: isCollectionTerminalState(state),
        batchIndex: 0,
        batchCount: 1,
      });
      if (isCollectionTerminalState(state)) {
        invalidateAffectedCollectionQueries(queryClient, payload, {
          cellName,
          machineId,
          operatorId,
        });
        options.onFinalized?.(payload);
      }
    };

    const handleMessage = async (payload) => {
      try {
        const update = await persistCollectionBroadcastMessage(payload);
        await publishUpdate(update);
      } catch (error) {
        console.warn('[CollectionQueue] Falha ao aplicar evento Broadcast V3:', error);
      }
    };

    const reconcile = async () => {
      if (cancelled || globalThis.navigator?.onLine === false) return;
      const connected = realtimeStatusRef.current === 'SUBSCRIBED';
      try {
        const updates = await reconcileCollectionEventsV3({
          eventKind,
          limit: 25,
          olderThanMs: connected
            ? COLLECTION_RECONCILIATION_CONNECTED_STALE_MS
            : COLLECTION_RECONCILIATION_DISCONNECTED_STALE_MS,
        });
        for (const update of updates) await publishUpdate(update);
      } catch (error) {
        if (!cancelled) {
          console.warn('[CollectionQueue] Reconciliação V3 indisponível:', error);
        }
      }
    };

    Promise.resolve(options.pipelineFlags || getCollectionPipelineFlagsV3())
      .then((flags) => {
        if (cancelled) return;
        const {
          ingress: ingressEnabled,
          broadcast: broadcastEnabled,
        } = resolveFlagModes(flags);
        pipelineFlagModesRef.current = {
          ingress: ingressEnabled,
          broadcast: broadcastEnabled,
        };
        setPipelineV3Enabled(ingressEnabled);
        if (!ingressEnabled) {
          setRealtimeStatusSafely('DISABLED');
          return;
        }

        if (broadcastEnabled) {
          setRealtimeStatusSafely('CONNECTING');
          subscription = subscribeToCollectionBroadcastV3({
            deviceId,
            cellId,
            onMessage: handleMessage,
            onStatus: (status, channelName) => {
              if (cancelled) return;
              channelStatuses.set(channelName, status);
              const statuses = [...channelStatuses.values()];
              if (statuses.length === (cellId ? 2 : 1)
                && statuses.every((item) => item === 'SUBSCRIBED')) {
                setRealtimeStatusSafely('SUBSCRIBED');
              } else if (statuses.some((item) => (
                item === 'CHANNEL_ERROR'
                || item === 'TIMED_OUT'
                || item === 'CLOSED'
              ))) {
                setRealtimeStatusSafely('DISCONNECTED');
              }
            },
          });
        } else {
          setRealtimeStatusSafely('DISCONNECTED');
        }

        reconciliationInterval = window.setInterval(
          reconcile,
          COLLECTION_RECONCILIATION_INTERVAL_MS,
        );
        reconcile();
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[CollectionQueue] Não foi possível ativar o realtime V3:', error);
        pipelineFlagModesRef.current = { ingress: false, broadcast: false };
        setPipelineV3Enabled(false);
        setRealtimeStatusSafely('DISABLED');
      });

    return () => {
      cancelled = true;
      if (reconciliationInterval) window.clearInterval(reconciliationInterval);
      if (flagRefreshInterval) window.clearInterval(flagRefreshInterval);
      window.removeEventListener('focus', requestFlagRefresh);
      window.removeEventListener('online', requestFlagRefresh);
      if (subscription) unsubscribeFromCollectionBroadcastV3(subscription);
    };
  }, [
    cellId,
    cellName,
    deviceId,
    eventKind,
    handleBatchResult,
    machineId,
    microBatch,
    operatorId,
    options.enableV3Realtime,
    options.forceV3,
    options.onFinalized,
    options.onProjectionDelta,
    options.pipelineFlags,
    pipelineFlagsRefreshTick,
    queryClient,
    setRealtimeStatusSafely,
  ]);

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
            eventKind,
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
    eventKind,
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
      setOnline(true);
      if (!navigator.onLine) return;
      const currentStats = await getQueueStats();
      if (currentStats.pending > 0) scheduleFlush();
    };
    const onOffline = () => setOnline(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryFlush();
    };
    window.addEventListener('online', tryFlush);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', tryFlush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', tryFlush);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', tryFlush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [scheduleFlush]);

  const enqueue = useCallback(async (inputPayload, enqueueOpts = {}) => {
    const operatorSession = microBatch ? getOperatorSession() : null;
    const payload = microBatch
      ? {
        ...inputPayload,
        operator_session_id: inputPayload.operator_session_id
          || inputPayload.operatorSessionId
          || operatorSession?.session_id
          || null,
      }
      : inputPayload;

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
        success: false,
        accepted: true,
        pending: true,
        status: 'pending_database',
        collection_state: COLLECTION_STATES.PENDING_DATABASE,
        alert_level: 'blue',
        client_event_id: clientEventId,
        message: 'Leitura capturada. Aguardando registro no banco.',
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
    pipelineV3Enabled,
    realtimeStatus,
    online,
    deviceId,
  };
}

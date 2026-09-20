import {
  COLLECTION_STATES,
  collectionStateFromResult,
} from '@/lib/collectionStateMachine';

const HISTORY_STATUS_BY_STATE = {
  [COLLECTION_STATES.APPROVED]: 'approved',
  [COLLECTION_STATES.REJECTED]: 'rejected',
  [COLLECTION_STATES.BLOCKED]: 'blocked',
  [COLLECTION_STATES.DUPLICATED]: 'duplicated',
  [COLLECTION_STATES.PENDING_REVIEW]: 'pending_review',
  [COLLECTION_STATES.DEAD_LETTERED]: 'dead_lettered',
};

const TERMINAL_OUTCOME_COUNTER = {
  [COLLECTION_STATES.APPROVED]: 'approved',
  [COLLECTION_STATES.REJECTED]: 'rejected',
  [COLLECTION_STATES.BLOCKED]: 'blocked',
};

function sameValue(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function mergeDefined(previous, incoming) {
  const defined = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
  return { ...previous, ...defined };
}

function sameHistoryEvent(left, right) {
  const leftIds = [left?.client_event_id, left?.event_id, left?.id].filter(Boolean);
  return [right?.client_event_id, right?.event_id, right?.id]
    .some((id) => id && leftIds.includes(id));
}

function snapshotCouldAlreadyIncludeEvent(previous, event, clientEventId) {
  if (previous?.active_context?.source_client_event_id === clientEventId) return true;
  const capturedAt = Date.parse(event?.captured_at_client || event?.created_at_client
    || event?.createdAtClient || event?.occurred_at);
  const snapshotCompletedAt = Number(previous?._collection_snapshot_completed_at);
  // O recibo não possui um watermark comparável ao agregado. Se uma consulta
  // terminou após a captura, ela pode já incluir a peça: não some outra vez.
  // O próximo snapshot automático confirma a base sem consulta por ACK.
  return Number.isFinite(capturedAt) && Number.isFinite(snapshotCompletedAt)
    && snapshotCompletedAt > 0 && capturedAt <= snapshotCompletedAt;
}

function contextIdentityChanged(previous, row, clientLot = false) {
  const previousId = clientLot ? previous?.active_lot_id : previous?.active_pcp_import_batch_id;
  const incomingId = clientLot ? row.lot_id : row.pcp_import_batch_id;
  if (previousId && incomingId) return !sameValue(previousId, incomingId);
  const previousCode = clientLot ? previous?.active_lot_code : previous?.active_general_lot_code;
  const incomingCode = clientLot ? row.lot_code : row.pcp_batch_name;
  if (!previousId && !previousCode) return Boolean(incomingId || incomingCode);
  return Boolean(previousCode && incomingCode && !sameValue(previousCode, incomingCode));
}

export function collectionSnapshotMatchesPendingLot(previous, incoming, now = Date.now()) {
  if (!previous?.lot_kpis_stale) return true;
  // Após a janela limitada de projeção, o snapshot volta a prevalecer, inclusive
  // se outro posto já tiver confirmado uma troca de lote mais recente.
  if (now - previous.lot_kpis_pending_since >= 30_000) return true;
  const pending = previous.active_context;
  const received = incoming?.active_context;
  if (pending?.active_pcp_import_batch_id) {
    return sameValue(pending.active_pcp_import_batch_id, received?.active_pcp_import_batch_id);
  }
  return Boolean(pending?.active_general_lot_code && sameValue(
    pending.active_general_lot_code, received?.active_general_lot_code,
  ));
}

/** Um snapshot compacto do mesmo lote não apaga nomes já confirmados. */
export function preserveCollectionSnapshotIdentity(previous, incoming) {
  const oldContext = previous?.active_context;
  const context = incoming?.active_context;
  if (!oldContext || !context) return incoming;
  const sameClient = oldContext.active_lot_id && context.active_lot_id
    && sameValue(oldContext.active_lot_id, context.active_lot_id);
  const sameBatch = oldContext.active_pcp_import_batch_id && context.active_pcp_import_batch_id
    && sameValue(oldContext.active_pcp_import_batch_id, context.active_pcp_import_batch_id);
  const changedBatch = contextIdentityChanged(oldContext, {
    pcp_import_batch_id: context.active_pcp_import_batch_id,
    pcp_batch_name: context.active_general_lot_code,
  });
  if ((!sameClient && !sameBatch) || changedBatch) return incoming;
  return {
    ...incoming,
    active_context: {
      ...context,
      active_general_lot_code: context.active_general_lot_code || oldContext.active_general_lot_code,
      ...(sameClient ? {
        active_lot_code: context.active_lot_code || oldContext.active_lot_code,
        customer_name: context.customer_name || oldContext.customer_name,
      } : {}),
    },
  };
}

function statusMatchesFilter(status, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'approved') return ['approved', 'approved_via_replacement'].includes(status);
  return sameValue(status, filter);
}

function eventIsInsidePeriod(createdAt, period) {
  if (!period || period === 'all') return true;
  const occurredAt = Date.parse(createdAt);
  if (!Number.isFinite(occurredAt)) return true;
  const periodMs = period === '24h' ? 24 * 60 * 60 * 1000
    : period === '7days' ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  return occurredAt >= Date.now() - periodMs;
}

function historyQueryMatches(queryKey, row) {
  if (queryKey?.[0] !== 'stageReadings') return false;
  const [, cellName, machineId, cellId, operatorId, shift, period, statusFilter] = queryKey;
  return (!cellName || sameValue(cellName, row.cell_name))
    && (!machineId || sameValue(machineId, row.machine_id))
    && (!cellId || sameValue(cellId, row.cell_id))
    && (!operatorId || sameValue(operatorId, row.operator_id))
    && (!shift || sameValue(shift, row.shift))
    && statusMatchesFilter(row.reading_status, statusFilter)
    && eventIsInsidePeriod(row.created_at, period);
}

function addCounter(previous, key, amount) {
  if (!key || !Number.isFinite(amount) || amount === 0) return previous;
  return {
    ...previous,
    [key]: Math.max(0, (Number(previous?.[key]) || 0) + amount),
  };
}

function applyOutcomeDelta(previous, state, quantity, { decrementPending = false } = {}) {
  if (!previous || typeof previous !== 'object') return previous;
  const outcome = TERMINAL_OUTCOME_COUNTER[state];
  if (!outcome) return previous;
  let next = addCounter(previous, outcome, quantity);
  if (decrementPending && [COLLECTION_STATES.APPROVED, COLLECTION_STATES.REJECTED].includes(state)) {
    next = addCounter(next, 'pending', -quantity);
  }
  return next;
}

function applyActiveContext(previous, row, result = {}) {
  if (!previous || typeof previous !== 'object') return previous;
  if (!row.pcp_import_batch_id && !row.pcp_batch_name && !row.lot_id && !row.lot_code) return previous;
  const generalLotChanged = contextIdentityChanged(previous.active_context, row);
  const clientLotChanged = contextIdentityChanged(previous.active_context, row, true);
  const previousContext = { ...previous.active_context };
  if (generalLotChanged) {
    // Progresso e identidade do cliente anterior não pertencem ao novo lote.
    delete previousContext.progress_percent;
    delete previousContext.active_lot_id;
    delete previousContext.active_lot_code;
    delete previousContext.customer_name;
  } else if (clientLotChanged) {
    delete previousContext.customer_name;
  }
  return {
    ...previous,
    active_context: mergeDefined(previousContext, {
      cell_id: row.cell_id,
      cell_name: row.cell_name,
      machine_id: row.machine_id,
      active_pcp_import_batch_id: row.pcp_import_batch_id,
      active_general_lot_code: row.pcp_batch_name,
      active_lot_id: row.lot_id,
      active_lot_code: row.lot_code,
      customer_name: row.client_name,
      progress_percent: result.general_lot?.progress_percent
        ?? result.lot_progress_percent
        ?? result.progress_percent,
      source_client_event_id: row.client_event_id,
    }),
  };
}

export function collectionHistoryRowFromTerminalResult({
  event = {},
  result = {},
  state,
  defaults = {},
} = {}) {
  const clientEventId = event.client_event_id || result.client_event_id || null;
  if (!clientEventId) return null;
  const reading = result.reading || {};
  const item = result.item || {};
  const lot = result.lot || {};
  const generalLot = result.general_lot || {};
  const order = result.order || {};
  const route = result.route || {};
  // A peça já pode estar na próxima etapa. O histórico descreve a operação
  // decidida pelo servidor, que o recibo V3 identifica em step_code.
  const operationName = reading.step_name || result.step_code || route.step_name
    || event.operation_name || reading.cell_name || route.cell_name
    || event.cellName || event.cell_name || defaults.cellName || null;
  const createdAt = reading.created_at
    || result.decided_at
    || event.created_at_client
    || event.occurred_at
    || new Date().toISOString();
  const normalizedState = collectionStateFromResult({ collection_state: state })
    || collectionStateFromResult(result)
    || state;
  const status = HISTORY_STATUS_BY_STATE[normalizedState]
    || String(result.status || normalizedState || '').trim().toLowerCase();

  return {
    id: reading.id || result.reading_id || result.event_id || clientEventId,
    event_id: result.event_id || null,
    client_event_id: clientEventId,
    created_at: createdAt,
    server_created_at: result.received_at_db || createdAt,
    traceability_code: item.traceability_code || item.piece_uid
      || reading.tag_value || event.raw_value || event.rawValue,
    raw_value: event.raw_value || event.rawValue || reading.tag_value || null,
    piece_id: item.id || reading.piece_id || null,
    piece_status: item.status || null,
    piece_current_stage: item.current_stage || item.current_step || null,
    piece_name: item.piece_name || null,
    lot_id: lot.id || event.lot_id || null,
    lot_code: lot.lot_code || item.lot_code || null,
    pcp_import_batch_id: lot.pcp_import_batch_id || generalLot.id
      || event.pcp_import_batch_id || null,
    pcp_batch_name: generalLot.general_lot_code || lot.general_lot_code
      || result.general_lot_code || null,
    order_number: order.order_number || order.order_code || null,
    client_name: order.customer_name || result.customer_name || null,
    customer_name: order.customer_name || result.customer_name || null,
    cell_id: reading.cell_id || event.cellId || event.cell_id || defaults.cellId || null,
    cell_name: reading.cell_name || route.cell_name || event.cellName
      || event.cell_name || defaults.cellName || null,
    machine_id: reading.machine_id || event.machineId || event.machine_id
      || defaults.machineId || null,
    machine_name: reading.machine_name || event.machineName || event.machine_name
      || defaults.machineName || null,
    station_name: reading.station_name || event.station_name || defaults.machineName || null,
    operator_id: reading.operator_id || event.operatorId || event.operator_id
      || defaults.operatorId || null,
    operator_name: reading.operator || event.operator || defaults.operatorName || null,
    registration: event.operator_registration || defaults.operatorRegistration || null,
    shift: reading.shift || event.shift || defaults.shift || null,
    operation_name: operationName,
    reading_stage_name: operationName,
    current_stage_name: operationName,
    reading_status: status,
    event_status: status,
    result_status: status,
    collection_state: normalizedState,
    message: result.message || null,
    result_payload: result,
    route_steps: result.route_steps || item.route_steps || [],
    completed_steps: result.completed_steps || item.completed_steps || [],
  };
}

/**
 * Projeta uma decisão já confirmada pelo servidor nos caches visíveis da
 * estação. Nenhuma query é invalidada: o snapshot HTTP periódico continuará
 * sendo a autoridade e corrigirá qualquer divergência eventual.
 */
export function applyCollectionTerminalResultToCache(queryClient, payload = {}, seenEventIds = new Set()) {
  if (!queryClient?.setQueriesData) return false;
  const state = collectionStateFromResult({ collection_state: payload.state })
    || collectionStateFromResult(payload.result || {})
    || payload.state;
  const row = collectionHistoryRowFromTerminalResult({ ...payload, state });
  const clientEventId = row?.client_event_id;
  if (!row || (seenEventIds.has(clientEventId) && !payload.enrichmentOnly)) return false;
  seenEventIds.add(clientEventId);
  if (seenEventIds.size > 2_000) seenEventIds.delete(seenEventIds.values().next().value);
  // Enriquecer um recibo antigo não o torna a coleta mais recente. O Set
  // preserva a ordem das primeiras decisões, inclusive após um snapshot HTTP
  // substituir os metadados locais do cache.
  const latestObservedEventId = Array.from(seenEventIds).at(-1);
  const contextEventAt = Date.parse(payload.event?.captured_at_client
    || payload.event?.created_at_client || payload.event?.createdAtClient
    || payload.event?.occurred_at || row.created_at);

  queryClient.setQueriesData({
    predicate: (query) => historyQueryMatches(query.queryKey, row),
  }, (previous) => {
    if (!previous || !Array.isArray(previous.readings)) return previous;
    const rows = [...previous.readings];
    const index = rows.findIndex((candidate) => sameHistoryEvent(candidate, row));
    if (index >= 0) rows[index] = mergeDefined(rows[index], row);
    else rows.unshift(row);
    const limit = Math.max(50, previous.readings.length);
    return {
      ...previous,
      readings: rows.slice(0, limit),
      totalCount: (Number(previous.totalCount) || 0) + (index < 0 ? 1 : 0),
    };
  });

  const quantity = Math.max(1, Number(payload.event?.quantity || payload.result?.quantity) || 1);
  queryClient.setQueriesData({
    predicate: (query) => {
      const key = query.queryKey || [];
      if (key[0] !== 'collection-kpis') return false;
      const batchId = row.pcp_import_batch_id;
      return (!key[1] || sameValue(key[1], row.cell_name))
        && (!key[2] || sameValue(key[2], row.machine_id))
        && (!key[6] || (batchId && sameValue(key[6], batchId)));
    },
  }, (previous) => {
    if (!previous) return previous;
    const previousContextAt = Number(previous._collection_context_event_at);
    const contextMayAdvance = payload.enrichmentOnly
      ? latestObservedEventId === clientEventId
        && (!previous._collection_context_event_id
          || previous._collection_context_event_id === clientEventId)
      : !(Number.isFinite(previousContextAt) && Number.isFinite(contextEventAt)
        && previousContextAt > contextEventAt);
    const differentGeneralLot = contextIdentityChanged(previous.active_context, row);
    const generalLotChanged = contextMayAdvance && differentGeneralLot;
    const snapshotOverlap = snapshotCouldAlreadyIncludeEvent(previous, payload.event, clientEventId);
    const next = !contextMayAdvance && differentGeneralLot ? previous : generalLotChanged ? {
      ...previous,
      expected: null, approved: null, rejected: null, pending: null,
      rework: null, replacement: null,
      lot_kpis_stale: true,
      lot_kpis_pending_since: Date.now(),
    } : snapshotOverlap ? { ...previous, counter_reconciliation_required: true }
      : previous.lot_kpis_stale || payload.enrichmentOnly ? previous
      : applyOutcomeDelta(previous, state, quantity, { decrementPending: true });
    if (!contextMayAdvance) return next;
    return applyActiveContext({
      ...next,
      _collection_context_event_id: clientEventId,
      _collection_context_event_at: contextEventAt,
    }, row, payload.result);
  });

  queryClient.setQueriesData({
    predicate: (query) => {
      const key = query.queryKey || [];
      return key[0] === 'operator-shift-kpis'
        && (!key[1] || sameValue(key[1], row.operator_id))
        && (!key[2] || sameValue(key[2], row.shift));
    },
  }, (previous) => {
    if (payload.enrichmentOnly) return previous;
    if (snapshotCouldAlreadyIncludeEvent(previous, payload.event, clientEventId)) {
      return { ...previous, counter_reconciliation_required: true };
    }
    return applyOutcomeDelta(previous, state, quantity);
  });

  return true;
}

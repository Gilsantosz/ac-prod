/**
 * AC.Prod — Fila durável de coleta em IndexedDB.
 *
 * Estados locais:
 * - pending: ainda não transportado;
 * - processing: POST do micro-lote em andamento;
 * - accepted: inbox do Supabase confirmou persistência, decisão pendente;
 * - synced: decisão canônica concluída;
 * - error: falha final.
 */

const DB_NAME = 'acprod_collection_queue';
const DB_VERSION = 2;
const STORE = 'events';
let databasePromise = null;

function openDb() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      let store;
      if (!database.objectStoreNames.contains(STORE)) {
        store = database.createObjectStore(STORE, {
          keyPath: 'client_event_id',
        });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_created', 'created_at_client', { unique: false });
      } else {
        store = event.target.transaction.objectStore(STORE);
      }
      if (!store.indexNames.contains('by_next_attempt')) {
        store.createIndex('by_next_attempt', 'next_attempt_at', { unique: false });
      }
    };
    request.onsuccess = (event) => {
      const database = event.target.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = (event) => {
      databasePromise = null;
      reject(event.target.error);
    };
  });

  return databasePromise;
}

async function dbPutMany(items) {
  if (!items.length) return items;
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    items.forEach((item) => store.put(item));
    transaction.oncomplete = () => resolve(items);
    transaction.onerror = (event) => reject(event.target.error);
    transaction.onabort = (event) => reject(event.target.error);
  });
}

async function dbPut(item) {
  await dbPutMany([item]);
  return item;
}

/**
 * Aplica transições em uma única transação readwrite. Isso impede que um ACK
 * atrasado sobrescreva uma decisão final recebida pelo Realtime.
 */
async function dbTransformMany(items, transform) {
  if (!items.length) return [];
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const updates = [];

    items.forEach((item, index) => {
      const key = item?.client_event_id || item?.event?.client_event_id;
      if (!key) return;

      const request = store.get(key);
      request.onsuccess = () => {
        const update = transform(request.result, item, index);
        if (!update) return;
        updates.push(update);
        store.put(update);
      };
      request.onerror = (event) => {
        try { transaction.abort(); } catch {}
        reject(event.target.error);
      };
    });

    transaction.oncomplete = () => resolve(updates);
    transaction.onerror = (event) => reject(event.target.error);
    transaction.onabort = (event) => reject(event.target.error);
  });
}

async function dbGetMany(keys) {
  if (!keys.length) return [];
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const store = transaction.objectStore(STORE);
    const results = [];

    keys.forEach((key) => {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) results.push(request.result);
      };
      request.onerror = (event) => reject(event.target.error);
    });

    transaction.oncomplete = () => resolve(results);
    transaction.onerror = (event) => reject(event.target.error);
    transaction.onabort = (event) => reject(event.target.error);
  });
}

async function dbGetByIndex(indexName, value) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).index(indexName).getAll(value);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function dbGetAll() {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function dbGet(key) {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function dbDeleteMany(keys) {
  if (!keys.length) return 0;
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    keys.forEach((key) => store.delete(key));
    transaction.oncomplete = () => resolve(keys.length);
    transaction.onerror = (event) => reject(event.target.error);
    transaction.onabort = (event) => reject(event.target.error);
  });
}

function generateClientEventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function notifyChange() {
  try {
    window.dispatchEvent(new CustomEvent('collection-queue-changed'));
  } catch {
    // Ambiente sem window, como testes unitários.
  }
}

function nowIso() {
  return new Date().toISOString();
}

function monotonicNow() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function eventTimestampMs(event) {
  return new Date(event.updated_at || event.created_at_client || 0).getTime();
}

function statsFor(events) {
  const now = Date.now();
  const localStaleThreshold = now - 60_000;
  const serverStaleThreshold = now - 90_000;
  const pending = events.filter((event) => event.status === 'pending');
  const processing = events.filter((event) => event.status === 'processing');
  const accepted = events.filter((event) => event.status === 'accepted');
  const serverProcessing = accepted.filter(
    (event) => event.server_status === 'processando',
  );
  const serverReceived = accepted.filter(
    (event) => event.server_status !== 'processando',
  );

  return {
    total: events.length,
    pending: pending.length,
    processing: processing.length,
    accepted: accepted.length,
    serverReceived: serverReceived.length,
    serverProcessing: serverProcessing.length,
    synced: events.filter((event) => event.status === 'synced').length,
    error: events.filter((event) => event.status === 'error').length,
    hasStalePending: pending.some(
      (event) => eventTimestampMs(event) < localStaleThreshold,
    ) || processing.some(
      (event) => eventTimestampMs(event) < localStaleThreshold,
    ),
    hasStaleServer: accepted.some(
      (event) => eventTimestampMs(event) < serverStaleThreshold,
    ),
    hasSlowEnqueue: events.some(
      (event) => Number(event.enqueue_duration_ms) > 800,
    ),
  };
}

function withProcessingState(event, timestamp = nowIso()) {
  if (!event || ['synced', 'error', 'accepted'].includes(event.status)) return null;
  return {
    ...event,
    status: 'processing',
    next_attempt_at: null,
    sync_started_at: event.sync_started_at || timestamp,
    updated_at: timestamp,
  };
}

function withAcceptedState(event, ingress = {}, timestamp = nowIso()) {
  if (!event || ['synced', 'error'].includes(event.status)) return null;
  return {
    ...event,
    status: 'accepted',
    server_status: ingress.status_sincronizacao
      || event.server_status
      || 'recebida',
    server_received_at: ingress.server_received_at
      || ingress.created_at
      || event.server_received_at
      || timestamp,
    server_updated_at: ingress.updated_at || timestamp,
    server_attempt_count: Number(ingress.attempt_count || 0),
    server_queue_delay_ms: ingress.queue_delay_ms ?? null,
    ingress_id: ingress.id || event.ingress_id || null,
    next_attempt_at: null,
    updated_at: timestamp,
  };
}

function withoutOperationalSecrets(event) {
  if (!event) return event;
  const {
    operatorSessionToken,
    operator_session_token,
    session_token,
    ...safeEvent
  } = event;
  return safeEvent;
}

function withSyncedState(event, result, ingress = null, timestamp = nowIso()) {
  if (!event || event.status === 'synced') return null;
  const syncStartedAt = event.sync_started_at;
  return {
    ...withoutOperationalSecrets(event),
    status: 'synced',
    server_status: 'sincronizada',
    next_attempt_at: null,
    result,
    ingress: ingress || event.ingress || null,
    sync_finished_at: timestamp,
    sync_duration_ms: syncStartedAt
      ? new Date(timestamp).getTime() - new Date(syncStartedAt).getTime()
      : event.sync_duration_ms,
    processed_at: timestamp,
    updated_at: timestamp,
  };
}

function withErrorState(event, error, maxRetries = 8, timestamp = nowIso()) {
  if (!event || event.status === 'synced') return null;
  if (event.status === 'error' && error?.retryable === false) return null;

  const retries = (event.retries || 0) + 1;
  const retryable = error?.retryable !== false;
  const status = retryable && retries < maxRetries ? 'pending' : 'error';
  const baseDelayMs = Math.min(
    300_000,
    1_000 * (2 ** Math.max(retries - 1, 0)),
  );
  const jitterMs = Math.round(baseDelayMs * Math.random() * 0.25);
  const syncStartedAt = event.sync_started_at;

  const baseEvent = status === 'error' && error?.serverFinal === true
    ? withoutOperationalSecrets(event)
    : event;

  return {
    ...baseEvent,
    status,
    server_status: status === 'error' ? 'erro' : null,
    retries,
    last_error: error?.message || String(error),
    last_result: error?.result || null,
    next_attempt_at: status === 'pending'
      ? new Date(Date.now() + baseDelayMs + jitterMs).toISOString()
      : null,
    sync_finished_at: timestamp,
    sync_duration_ms: syncStartedAt
      ? new Date(timestamp).getTime() - new Date(syncStartedAt).getTime()
      : event.sync_duration_ms,
    updated_at: timestamp,
  };
}

/**
 * Persiste primeiro e libera o scanner. A atualização do tempo de gravação é
 * diagnóstica e ocorre depois, sem adicionar uma segunda espera ao operador.
 */
export async function enqueueCollectionEvent(payload) {
  const timestamp = nowIso();
  const clientEventId = payload.client_event_id || generateClientEventId();
  const event = {
    client_event_id: clientEventId,
    status: 'pending',
    retries: 0,
    created_at_client: timestamp,
    updated_at: timestamp,
    event_kind: payload.event_kind
      || (payload.is_replacement_event ? 'replacement_stage' : 'production_stage'),
    next_attempt_at: timestamp,
    raw_value: payload.rawValue ?? payload.raw_value ?? '',
    lot_id: payload.lotId ?? payload.lot_id ?? null,
    lot_code: payload.lotCode ?? payload.lot_code ?? null,
    load_number: payload.loadNumber ?? payload.load_number ?? null,
    order_number: payload.orderNumber ?? payload.order_number ?? null,
    customer_name: payload.customerName ?? payload.customer_name ?? null,
    environment_name: payload.environmentName ?? payload.environment_name ?? null,
    machine_id: payload.machineId ?? payload.machine_id ?? null,
    machine_name: payload.machineName ?? payload.machine_name ?? null,
    station_name: payload.stationName ?? payload.station_name ?? null,
    enqueue_duration_ms: 0,
    sync_started_at: null,
    server_received_at: null,
    sync_finished_at: null,
    sync_duration_ms: null,
    server_status: null,
    ...payload,
    client_event_id: clientEventId,
  };

  const existing = await dbGet(event.client_event_id);
  if (existing) return existing.client_event_id;

  const startedAt = monotonicNow();
  await dbPut(event);
  const elapsed = monotonicNow() - startedAt;

  // A duração é somente telemetria de console. Uma segunda escrita com o
  // snapshot antigo poderia sobrescrever o estado processing/accepted.

  if (elapsed > 800) {
    console.warn(`[Queue] Local save exceeded 800ms: ${elapsed.toFixed(1)}ms`);
  }
  notifyChange();
  return event.client_event_id;
}

export async function getQueueStats() {
  return statsFor(await dbGetAll());
}

export async function getQueueStatsByCellMachine(
  cellName,
  machineId,
  eventKind = null,
) {
  const all = await dbGetAll();
  return statsFor(all.filter((event) => (
    (!cellName || event.cellName === cellName || event.cell_name === cellName)
    && (!machineId || event.machineId === machineId || event.machine_id === machineId)
    && (!eventKind || event.event_kind === eventKind)
  )));
}

export async function getEventsByStatus(status) {
  return dbGetByIndex('by_status', status);
}

export async function getCollectionEvent(clientEventId) {
  return dbGet(clientEventId);
}

export async function getCollectionEvents(clientEventIds = []) {
  return dbGetMany(Array.from(new Set(clientEventIds.filter(Boolean))));
}

export async function recoverStaleProcessingEvents(maxAgeMs = 120_000) {
  const all = await dbGetAll();
  const cutoff = Date.now() - maxAgeMs;
  const timestamp = nowIso();
  const recovered = all
    .filter((event) => (
      event.status === 'processing' && eventTimestampMs(event) < cutoff
    ))
    .map((event) => ({
      ...event,
      status: 'pending',
      retries: 0,
      next_attempt_at: timestamp,
      updated_at: timestamp,
    }));

  await dbPutMany(recovered);
  if (recovered.length > 0) {
    console.log(`[Queue] Recovered ${recovered.length} stale processing events.`);
    notifyChange();
  }
  return recovered.length;
}

export async function getOldestPendingEvent() {
  const pending = await dbGetByIndex('by_status', 'pending');
  if (!pending?.length) return null;
  const now = Date.now();
  const due = pending.filter((event) => (
    !event.next_attempt_at
    || new Date(event.next_attempt_at).getTime() <= now
  ));
  due.sort((left, right) => (
    left.created_at_client.localeCompare(right.created_at_client)
  ));
  return due[0] || null;
}

export async function markEventPending(clientEventId) {
  const timestamp = nowIso();
  const updates = await dbTransformMany(
    [{ client_event_id: clientEventId }],
    (event) => {
      if (!event || ['synced', 'error'].includes(event.status)) return null;
      return {
        ...event,
        status: 'pending',
        server_status: null,
        next_attempt_at: timestamp,
        updated_at: timestamp,
      };
    },
  );
  if (updates.length > 0) notifyChange();
}

export async function markEventsProcessing(events) {
  const timestamp = nowIso();
  const updates = await dbTransformMany(
    events,
    (current) => withProcessingState(current, timestamp),
  );
  if (updates.length > 0) notifyChange();
  return updates;
}

export async function markEventProcessing(clientEventId) {
  const updates = await dbTransformMany(
    [{ client_event_id: clientEventId }],
    (current) => withProcessingState(current),
  );
  if (updates.length > 0) notifyChange();
}

export async function markEventsAccepted(items) {
  const timestamp = nowIso();
  const updates = await dbTransformMany(
    items,
    (current, item) => withAcceptedState(current, item.ingress, timestamp),
  );
  if (updates.length > 0) notifyChange();
  return updates;
}

export async function markEventAccepted(clientEventId, ingress = {}) {
  const updates = await dbTransformMany(
    [{ client_event_id: clientEventId, ingress }],
    (current, item) => withAcceptedState(current, item.ingress),
  );
  if (updates.length > 0) notifyChange();
}

export async function markEventsSynced(items) {
  const timestamp = nowIso();
  const updates = await dbTransformMany(
    items,
    (current, item) => withSyncedState(
      current,
      item.result,
      item.ingress,
      timestamp,
    ),
  );
  if (updates.length > 0) notifyChange();
  return updates;
}

export async function markEventSynced(clientEventId, result, ingress = null) {
  const updates = await dbTransformMany(
    [{ client_event_id: clientEventId, result, ingress }],
    (current, item) => withSyncedState(current, item.result, item.ingress),
  );
  if (updates.length > 0) notifyChange();
}

export async function markEventsError(items, maxRetries = 8) {
  const timestamp = nowIso();
  const updates = await dbTransformMany(
    items,
    (current, item) => withErrorState(
      current,
      item.error,
      maxRetries,
      timestamp,
    ),
  );
  if (updates.length > 0) notifyChange();
  return updates;
}

export async function markEventError(clientEventId, error, maxRetries = 8) {
  const updates = await dbTransformMany(
    [{ client_event_id: clientEventId, error }],
    (current, item) => withErrorState(current, item.error, maxRetries),
  );
  if (updates.length > 0) notifyChange();
}

export async function processCollectionEvent(clientEventId, processFn, opts = {}) {
  const event = await dbGet(clientEventId);
  if (!event) throw new Error('Evento de coleta não localizado na fila local.');
  if (event.status === 'synced') return event.result;

  await markEventProcessing(clientEventId);
  const processingEvent = await dbGet(clientEventId);

  try {
    const result = await processFn(processingEvent);
    await markEventSynced(clientEventId, result);
    return result;
  } catch (error) {
    await markEventError(clientEventId, error, opts.maxRetries || 8);
    throw error;
  }
}

export async function flushCollectionQueue(processFn, opts = {}) {
  const { onProgress } = opts;
  const now = Date.now();
  const pending = (await dbGetByIndex('by_status', 'pending'))
    .filter((event) => (
      !event.next_attempt_at
      || new Date(event.next_attempt_at).getTime() <= now
    ))
    .sort((left, right) => (
      left.created_at_client.localeCompare(right.created_at_client)
    ));

  let synced = 0;
  let errors = 0;
  for (const event of pending) {
    try {
      await processCollectionEvent(event.client_event_id, processFn, opts);
      synced += 1;
    } catch {
      errors += 1;
    }
    onProgress?.({ synced, errors, current: event.client_event_id });
  }

  return { processed: pending.length, synced, errors };
}

export async function retryErrors() {
  const errorEvents = await dbGetByIndex('by_status', 'error');
  const timestamp = nowIso();
  const updates = errorEvents.map((event) => ({
    ...event,
    status: 'pending',
    server_status: null,
    retries: 0,
    last_error: null,
    next_attempt_at: timestamp,
    updated_at: timestamp,
  }));
  await dbPutMany(updates);
  if (updates.length > 0) notifyChange();
  return updates.length;
}

export async function pruneOldSynced(daysOld = 3) {
  const cutoff = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  const all = await dbGetAll();
  const keys = all
    .filter((event) => (
      event.status === 'synced'
      && event.processed_at
      && event.processed_at < cutoff
    ))
    .map((event) => event.client_event_id);
  const removed = await dbDeleteMany(keys);
  if (removed > 0) notifyChange();
  return removed;
}

/**
 * Mantém a fila operacional pequena mesmo em linhas de alta cadência. O
 * histórico definitivo continua no PostgreSQL; localmente guardamos apenas os
 * finalizados recentes necessários para feedback visual.
 */
export async function pruneSettledEvents({
  maxAgeMs = 60_000,
  keepLatest = 500,
} = {}) {
  const all = await dbGetAll();
  const synced = all
    .filter((event) => event.status === 'synced')
    .sort((left, right) => eventTimestampMs(right) - eventTimestampMs(left));
  const cutoff = Date.now() - Math.max(5_000, Number(maxAgeMs) || 60_000);
  const keys = synced
    .filter((event, index) => (
      index >= Math.max(50, Number(keepLatest) || 500)
      || eventTimestampMs(event) < cutoff
    ))
    .map((event) => event.client_event_id);
  const removed = await dbDeleteMany(keys);
  if (removed > 0) notifyChange();
  return removed;
}

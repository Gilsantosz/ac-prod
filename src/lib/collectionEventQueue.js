/**
 * AC.Prod — Fila de eventos de coleta durável (IndexedDB)
 *
 * Estados locais:
 * pending        aguardando transporte
 * processing     requisição de transporte em andamento
 * server_pending persistido no inbox do Supabase, aguardando decisão do worker
 * synced         decisão final recebida
 * error          falha terminal ou transporte esgotado
 */

const DB_NAME = 'acprod_collection_queue';
const DB_VERSION = 2;
const STORE = 'events';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      let store;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: 'client_event_id' });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_created', 'created_at_client', { unique: false });
      } else {
        store = e.target.transaction.objectStore(STORE);
      }
      if (!store.indexNames.contains('by_next_attempt')) {
        store.createIndex('by_next_attempt', 'next_attempt_at', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbPut(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetByIndex(indexName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index(indexName).getAll(value);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function generateClientEventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function notifyChange() {
  try {
    window.dispatchEvent(new CustomEvent('collection-queue-changed'));
  } catch (_) {
    // Ambiente sem window, como testes unitários.
  }
}

function eventTimestamp(event, fallbackField = 'created_at_client') {
  return new Date(
    event.server_received_at
      || event.transport_completed_at
      || event.updated_at
      || event[fallbackField],
  ).getTime();
}

function buildStats(events) {
  const now = Date.now();
  const staleThreshold = now - 60_000;
  const pending = events.filter((event) => event.status === 'pending');
  const processing = events.filter((event) => event.status === 'processing');
  const serverPending = events.filter((event) => event.status === 'server_pending');
  const errors = events.filter((event) => event.status === 'error');

  return {
    total: events.length,
    pending: pending.length,
    processing: processing.length,
    serverPending: serverPending.length,
    synced: events.filter((event) => event.status === 'synced').length,
    error: errors.length,
    retryableError: errors.filter((event) => event.retryable !== false).length,
    hasStalePending: pending.some((event) => (
      eventTimestamp(event) < staleThreshold
    )) || processing.some((event) => (
      eventTimestamp(event) < staleThreshold
    )),
    hasStaleServerPending: serverPending.some((event) => (
      eventTimestamp(event) < staleThreshold
    )),
    hasSlowEnqueue: events.some((event) => (
      Number(event.enqueue_duration_ms) > 800
    )),
  };
}

export async function enqueueCollectionEvent(payload) {
  const now = new Date().toISOString();
  const clientEventId = payload.client_event_id || generateClientEventId();
  const event = {
    client_event_id: clientEventId,
    status: 'pending',
    retries: 0,
    retryable: true,
    created_at_client: now,
    updated_at: now,
    event_kind: payload.event_kind || (
      payload.is_replacement_event ? 'replacement_stage' : 'production_stage'
    ),
    next_attempt_at: now,
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
    sync_finished_at: null,
    sync_duration_ms: null,
    server_status: null,
    server_received_at: null,
    server_finished_at: null,
    ...payload,
    client_event_id: clientEventId,
  };

  const existing = await dbGet(event.client_event_id);
  if (existing) return existing.client_event_id;

  const t0 = performance.now();
  await dbPut(event);
  const elapsed = performance.now() - t0;
  event.enqueue_duration_ms = elapsed;
  await dbPut(event);

  if (elapsed > 800) {
    console.warn(`[Queue] Local save exceeded 800ms: ${elapsed.toFixed(1)}ms`);
  }

  notifyChange();
  return event.client_event_id;
}

export async function getQueueStats() {
  return buildStats(await dbGetAll());
}

export async function getQueueStatsByCellMachine(
  cellName,
  machineId,
  eventKind = null,
) {
  const all = await dbGetAll();
  const filtered = all.filter((event) => (
    (!cellName || event.cellName === cellName || event.cell_name === cellName)
    && (!machineId || event.machineId === machineId || event.machine_id === machineId)
    && (!eventKind || event.event_kind === eventKind)
  ));
  return buildStats(filtered);
}

export async function getEventsByStatus(status) {
  return dbGetByIndex('by_status', status);
}

export async function getCollectionEvent(clientEventId) {
  return dbGet(clientEventId);
}

export async function getServerPendingEvents() {
  return dbGetByIndex('by_status', 'server_pending');
}

export async function recoverStaleProcessingEvents(maxAgeMs = 30_000) {
  const all = await dbGetAll();
  const cutoff = Date.now() - maxAgeMs;
  let count = 0;

  for (const event of all) {
    if (event.status !== 'processing') continue;
    const timestamp = new Date(
      event.updated_at || event.created_at_client,
    ).getTime();
    if (timestamp >= cutoff) continue;

    event.status = 'pending';
    event.retries = 0;
    event.retryable = true;
    event.next_attempt_at = new Date().toISOString();
    event.updated_at = new Date().toISOString();
    await dbPut(event);
    count += 1;
  }

  if (count > 0) {
    console.log(`[Queue] Recovered ${count} stale processing events.`);
    notifyChange();
  }
  return count;
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
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'pending';
  event.retryable = true;
  event.next_attempt_at = new Date().toISOString();
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

export async function markEventProcessing(clientEventId) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'processing';
  event.next_attempt_at = null;
  event.sync_started_at = new Date().toISOString();
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

export async function markEventServerPending(
  clientEventId,
  result,
  ingress = null,
) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  if (
    event.status === 'synced'
    || (event.status === 'error' && event.retryable === false)
  ) return;
  const now = new Date().toISOString();
  event.status = 'server_pending';
  event.retryable = false;
  event.next_attempt_at = null;
  event.result = result;
  event.last_result = result;
  event.server_status = ingress?.status_sincronizacao || 'recebida';
  event.server_received_at = ingress?.server_received_at
    || event.server_received_at
    || now;
  event.server_ingress = ingress;
  event.transport_completed_at = event.transport_completed_at || now;
  event.sync_finished_at = now;
  if (event.sync_started_at) {
    event.sync_duration_ms = new Date(now).getTime()
      - new Date(event.sync_started_at).getTime();
  }
  event.updated_at = now;
  await dbPut(event);
  notifyChange();
}

export async function markEventSynced(clientEventId, result, ingress = null) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  const now = new Date().toISOString();
  event.status = 'synced';
  event.retryable = false;
  event.next_attempt_at = null;
  event.result = result;
  event.last_result = result;
  event.server_status = 'sincronizada';
  event.server_ingress = ingress || event.server_ingress || null;
  event.server_finished_at = ingress?.processado_em || now;
  event.sync_finished_at = event.sync_finished_at || now;
  if (event.sync_started_at && event.sync_duration_ms == null) {
    event.sync_duration_ms = new Date(event.sync_finished_at).getTime()
      - new Date(event.sync_started_at).getTime();
  }
  event.processed_at = now;
  event.updated_at = now;
  await dbPut(event);
  notifyChange();
}

export async function markEventTerminalError(
  clientEventId,
  error,
  ingress = null,
) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  const now = new Date().toISOString();
  event.status = 'error';
  event.retryable = false;
  event.next_attempt_at = null;
  event.last_error = error?.message || String(error);
  event.last_result = error?.result || ingress?.resultado || null;
  event.result = event.last_result;
  event.server_status = 'erro';
  event.server_ingress = ingress || event.server_ingress || null;
  event.server_finished_at = ingress?.processado_em || now;
  event.sync_finished_at = now;
  event.processed_at = now;
  event.updated_at = now;
  await dbPut(event);
  notifyChange();
}

export async function markEventError(clientEventId, error, maxRetries = 8) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  const retries = (event.retries || 0) + 1;
  const retryable = error?.retryable !== false;
  event.status = retryable && retries < maxRetries ? 'pending' : 'error';
  event.retryable = retryable && retries < maxRetries;
  event.retries = retries;
  event.last_error = error?.message || String(error);
  event.last_result = error?.result || null;
  const baseDelayMs = Math.min(
    300_000,
    1_000 * (2 ** Math.max(retries - 1, 0)),
  );
  const jitterMs = Math.round(baseDelayMs * Math.random() * 0.25);
  event.next_attempt_at = event.status === 'pending'
    ? new Date(Date.now() + baseDelayMs + jitterMs).toISOString()
    : null;
  event.sync_finished_at = new Date().toISOString();
  if (event.sync_started_at) {
    event.sync_duration_ms = new Date(event.sync_finished_at).getTime()
      - new Date(event.sync_started_at).getTime();
  }
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

export async function processCollectionEvent(
  clientEventId,
  processFn,
  opts = {},
) {
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
  const pending = (await dbGetByIndex('by_status', 'pending')).filter((event) => (
    !event.next_attempt_at
    || new Date(event.next_attempt_at).getTime() <= now
  ));
  pending.sort((left, right) => (
    left.created_at_client.localeCompare(right.created_at_client)
  ));

  let synced = 0;
  let errors = 0;

  for (const event of pending) {
    try {
      await processCollectionEvent(event.client_event_id, processFn, opts);
      synced += 1;
    } catch (_) {
      errors += 1;
    }
    onProgress?.({ synced, errors, current: event.client_event_id });
  }

  return { processed: pending.length, synced, errors };
}

export async function retryErrors() {
  const errorEvents = await dbGetByIndex('by_status', 'error');
  const retryableEvents = errorEvents.filter((event) => event.retryable !== false);
  for (const event of retryableEvents) {
    await dbPut({
      ...event,
      status: 'pending',
      retryable: true,
      retries: 0,
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  if (retryableEvents.length > 0) notifyChange();
  return retryableEvents.length;
}

export async function pruneOldSynced(daysOld = 3) {
  const cutoff = new Date(
    Date.now() - daysOld * 86_400_000,
  ).toISOString();
  const all = await dbGetAll();
  const db = await openDb();
  let pruned = 0;

  for (const event of all) {
    if (event.status !== 'synced' || !event.processed_at) continue;
    if (event.processed_at >= cutoff) continue;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(event.client_event_id);
      tx.oncomplete = resolve;
      tx.onerror = (error) => reject(error.target.error);
    });
    pruned += 1;
  }

  return pruned;
}

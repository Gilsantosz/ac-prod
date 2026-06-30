/**
 * AC.Prod — Fila de eventos de coleta durável (IndexedDB)
 *
 * Garante zero perda de leituras mesmo com falha de rede ou lentidão do Supabase.
 * Cada evento recebe um UUID gerado no cliente (client_event_id) para idempotência.
 */

const DB_NAME = 'acprod_collection_queue';
const DB_VERSION = 1;
const STORE = 'events';

// ─── IndexedDB wrapper ────────────────────────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'client_event_id' });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_created', 'created_at_client', { unique: false });
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

// ─── Geração de ID de cliente ─────────────────────────────────────────────────

function generateClientEventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback para browsers mais antigos
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── Notificação de UI ────────────────────────────────────────────────────────

function notifyChange() {
  try {
    window.dispatchEvent(new CustomEvent('collection-queue-changed'));
  } catch (_) { /* ambiente sem window */ }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Enfileira um evento de coleta.
 * @param {object} payload — dados da leitura (rawValue, cellName, shift, operator, etc.)
 * @returns {string} client_event_id gerado
 */
export async function enqueueCollectionEvent(payload) {
  const now = new Date().toISOString();
  const clientEventId = payload.client_event_id || generateClientEventId();
  const event = {
    client_event_id: clientEventId,
    status: 'pending',
    retries: 0,
    created_at_client: now,
    updated_at: now,
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
    ...payload,
    client_event_id: clientEventId,
  };
  // Idempotência: se já existe, não duplica
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

/**
 * Retorna estatísticas atuais da fila.
 */
export async function getQueueStats() {
  const all = await dbGetAll();
  const now = Date.now();
  const staleThreshold = now - 60000;

  const pending = all.filter((e) => e.status === 'pending');
  const processing = all.filter((e) => e.status === 'processing');

  const hasStalePending = pending.some(e => new Date(e.created_at_client).getTime() < staleThreshold)
    || processing.some(e => new Date(e.created_at_client).getTime() < staleThreshold);

  const hasSlowEnqueue = all.some(e => Number(e.enqueue_duration_ms) > 800);

  return {
    total: all.length,
    pending: pending.length,
    processing: processing.length,
    synced: all.filter((e) => e.status === 'synced').length,
    error: all.filter((e) => e.status === 'error').length,
    hasStalePending,
    hasSlowEnqueue,
  };
}

/**
 * Retorna estatísticas da fila filtradas por célula e máquina.
 */
export async function getQueueStatsByCellMachine(cellName, machineId) {
  const all = await dbGetAll();
  const filtered = all.filter(e =>
    (!cellName || e.cellName === cellName || e.cell_name === cellName) &&
    (!machineId || e.machineId === machineId || e.machine_id === machineId)
  );
  const now = Date.now();
  const staleThreshold = now - 60000;

  const pending = filtered.filter((e) => e.status === 'pending');
  const processing = filtered.filter((e) => e.status === 'processing');

  const hasStalePending = pending.some(e => new Date(e.created_at_client).getTime() < staleThreshold)
    || processing.some(e => new Date(e.created_at_client).getTime() < staleThreshold);

  const hasSlowEnqueue = filtered.some(e => Number(e.enqueue_duration_ms) > 800);

  return {
    total: filtered.length,
    pending: pending.length,
    processing: processing.length,
    synced: filtered.filter((e) => e.status === 'synced').length,
    error: filtered.filter((e) => e.status === 'error').length,
    hasStalePending,
    hasSlowEnqueue,
  };
}

/**
 * Busca eventos com determinado status.
 */
export async function getEventsByStatus(status) {
  return dbGetByIndex('by_status', status);
}

/**
 * Recupera eventos processing antigos jogando-os de volta para pending.
 */
export async function recoverStaleProcessingEvents(maxAgeMs = 120000) {
  const all = await dbGetAll();
  const cutoff = Date.now() - maxAgeMs;
  let count = 0;
  for (const event of all) {
    if (event.status === 'processing') {
      const timestamp = new Date(event.updated_at || event.created_at_client).getTime();
      if (timestamp < cutoff) {
        event.status = 'pending';
        event.retries = 0;
        event.updated_at = new Date().toISOString();
        await dbPut(event);
        count++;
      }
    }
  }
  if (count > 0) {
    console.log(`[Queue] Recovered ${count} stale processing events.`);
    notifyChange();
  }
  return count;
}

/**
 * Retorna o evento pendente mais antigo.
 */
export async function getOldestPendingEvent() {
  const pending = await dbGetByIndex('by_status', 'pending');
  if (!pending || pending.length === 0) return null;
  pending.sort((a, b) => a.created_at_client.localeCompare(b.created_at_client));
  return pending[0];
}

/**
 * Funções de marcação de status
 */
export async function markEventPending(clientEventId) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'pending';
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

export async function markEventProcessing(clientEventId) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'processing';
  event.sync_started_at = new Date().toISOString();
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

export async function markEventSynced(clientEventId, result) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'synced';
  event.result = result;
  event.sync_finished_at = new Date().toISOString();
  if (event.sync_started_at) {
    event.sync_duration_ms = new Date(event.sync_finished_at).getTime() - new Date(event.sync_started_at).getTime();
  }
  event.processed_at = new Date().toISOString();
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

export async function markEventError(clientEventId, error) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  const retries = (event.retries || 0) + 1;
  event.status = retries >= 3 ? 'error' : 'pending';
  event.retries = retries;
  event.last_error = error?.message || String(error);
  event.sync_finished_at = new Date().toISOString();
  if (event.sync_started_at) {
    event.sync_duration_ms = new Date(event.sync_finished_at).getTime() - new Date(event.sync_started_at).getTime();
  }
  event.updated_at = new Date().toISOString();
  await dbPut(event);
  notifyChange();
}

/**
 * Processa um evento especifico da fila e devolve o resultado persistido.
 * Mantem o evento na fila se houver falha para permitir nova tentativa.
 */
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
  } catch (err) {
    await markEventError(clientEventId, err);
    throw err;
  }
}

/**
 * Processa a fila: 1 evento por vez (FIFO), com idempotência garantida por client_event_id.
 * @param {function} processFn — (event) => Promise<result>
 * @param {{ onProgress?: function, maxRetries?: number }} opts
 * @returns {{ processed: number, synced: number, errors: number }}
 */
export async function flushCollectionQueue(processFn, opts = {}) {
  const { onProgress } = opts;
  const pending = await dbGetByIndex('by_status', 'pending');
  // Ordenar por horário de criação (FIFO)
  pending.sort((a, b) => a.created_at_client.localeCompare(b.created_at_client));

  let synced = 0;
  let errors = 0;

  for (const event of pending) {
    try {
      await processCollectionEvent(event.client_event_id, processFn);
      synced++;
    } catch (err) {
      errors++;
    }

    onProgress?.({ synced, errors, current: event.client_event_id });
  }

  return { processed: pending.length, synced, errors };
}

/**
 * Recoloca eventos com erro no estado `pending` para reprocessamento.
 */
export async function retryErrors() {
  const errorEvents = await dbGetByIndex('by_status', 'error');
  for (const event of errorEvents) {
    await dbPut({ ...event, status: 'pending', retries: 0, updated_at: new Date().toISOString() });
  }
  notifyChange();
  return errorEvents.length;
}

/**
 * Limpa eventos sincronizados com mais de N dias.
 */
export async function pruneOldSynced(daysOld = 3) {
  const cutoff = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  const all = await dbGetAll();
  const db = await openDb();
  let pruned = 0;
  for (const e of all) {
    if (e.status === 'synced' && e.processed_at && e.processed_at < cutoff) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(e.client_event_id);
        tx.oncomplete = resolve;
        tx.onerror = (ev) => reject(ev.target.error);
      });
      pruned++;
    }
  }
  return pruned;
}

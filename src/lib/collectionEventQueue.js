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
  const event = {
    client_event_id: generateClientEventId(),
    status: 'pending',
    retries: 0,
    created_at_client: now,
    updated_at: now,
    raw_value: payload.rawValue ?? payload.raw_value ?? '',
    ...payload,
    // Garantir que client_event_id do payload não sobreescreva o gerado
    client_event_id: payload.client_event_id || generateClientEventId(),
  };
  // Idempotência: se já existe, não duplica
  const existing = await dbGet(event.client_event_id);
  if (existing) return existing.client_event_id;

  await dbPut(event);
  notifyChange();
  return event.client_event_id;
}

/**
 * Retorna estatísticas atuais da fila.
 */
export async function getQueueStats() {
  const all = await dbGetAll();
  return {
    total: all.length,
    pending: all.filter((e) => e.status === 'pending').length,
    processing: all.filter((e) => e.status === 'processing').length,
    synced: all.filter((e) => e.status === 'synced').length,
    error: all.filter((e) => e.status === 'error').length,
  };
}

/**
 * Busca eventos com determinado status.
 */
export async function getEventsByStatus(status) {
  return dbGetByIndex('by_status', status);
}

/**
 * Processa a fila: 1 evento por vez (FIFO), com idempotência garantida por client_event_id.
 * @param {function} processFn — (event) => Promise<result>
 * @param {{ onProgress?: function, maxRetries?: number }} opts
 * @returns {{ processed: number, synced: number, errors: number }}
 */
export async function flushCollectionQueue(processFn, opts = {}) {
  const { onProgress, maxRetries = 3 } = opts;
  const pending = await dbGetByIndex('by_status', 'pending');
  // Ordenar por horário de criação (FIFO)
  pending.sort((a, b) => a.created_at_client.localeCompare(b.created_at_client));

  let synced = 0;
  let errors = 0;

  for (const event of pending) {
    // Marcar como processando
    await dbPut({ ...event, status: 'processing', updated_at: new Date().toISOString() });
    notifyChange();

    try {
      const result = await processFn(event);
      await dbPut({
        ...event,
        status: 'synced',
        result,
        updated_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      });
      synced++;
    } catch (err) {
      const retries = (event.retries || 0) + 1;
      await dbPut({
        ...event,
        status: retries >= maxRetries ? 'error' : 'pending',
        retries,
        last_error: err?.message || String(err),
        updated_at: new Date().toISOString(),
      });
      errors++;
    }

    notifyChange();
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

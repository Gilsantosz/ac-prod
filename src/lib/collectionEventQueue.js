/**
 * AC.Prod — Fila de eventos de coleta durável (IndexedDB)
 *
 * Garante zero perda de leituras mesmo com falha de rede ou lentidão do Supabase.
 * Cada evento recebe um UUID gerado no cliente (client_event_id) para idempotência.
 */

const DB_NAME = 'acprod_collection_queue';
const DB_VERSION = 2;
const STORE = 'events';

export const COLLECTION_QUEUE_RETENTION_DAYS = 3;
export const COLLECTION_QUEUE_PRUNE_BATCH_SIZE = 100;
export const COLLECTION_QUEUE_RECOVERY_BATCH_SIZE = 50;
export const COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const COLLECTION_QUEUE_RECOVERY_COOLDOWN_MS = 60 * 1000;

const COLLECTION_QUEUE_MAX_PRUNE_BATCH_SIZE = 250;
const COLLECTION_QUEUE_MAX_RECOVERY_BATCH_SIZE = 100;
const COLLECTION_QUEUE_DB_OPEN_TIMEOUT_MS = 5_000;

const MAINTENANCE_LOCK_NAME = 'acprod-collection-queue-maintenance';
const MAINTENANCE_LAST_RUN_KEY = 'acprod_collection_queue_last_maintenance_at';
const MAINTENANCE_CURSOR_KEY = 'acprod_collection_queue_maintenance_cursor';
const RECOVERY_CURSOR_KEY = 'acprod_collection_queue_recovery_cursor';

let maintenanceInFlight = null;
let lastMaintenanceAt = 0;
let maintenanceChangedSinceLastCompletion = false;
let recoveryInFlight = null;
let lastRecoveryAt = 0;
let recoveryChangedSinceLastCompletion = false;
let cachedDb = null;
let dbOpenPromise = null;
let maintenanceCursor = null;
let recoveryCursor = null;

function normalizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePruneBatchSize(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return COLLECTION_QUEUE_PRUNE_BATCH_SIZE;
  }
  return Math.min(parsed, COLLECTION_QUEUE_MAX_PRUNE_BATCH_SIZE);
}

function normalizeRecoveryBatchSize(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return COLLECTION_QUEUE_RECOVERY_BATCH_SIZE;
  }
  return Math.min(parsed, COLLECTION_QUEUE_MAX_RECOVERY_BATCH_SIZE);
}

function isWithinCooldown(now, lastRun, cooldownMs) {
  return lastRun > 0
    && lastRun <= now
    && now - lastRun < cooldownMs;
}

// ─── IndexedDB wrapper ────────────────────────────────────────────────────────

function createDatabaseOpenError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

function reportDatabaseOpenIssue(error) {
  console.warn('[CollectionQueue] Fila local indisponível:', error);
  try {
    window.dispatchEvent(new CustomEvent('collection-queue-database-error', {
      detail: { code: error.code, message: error.message },
    }));
  } catch {
    // Ambiente sem window, como testes unitários.
  }
}

function releaseCachedDb(db) {
  if (cachedDb === db) cachedDb = null;
  try {
    db.close();
  } catch {
    // A conexão pode já ter sido encerrada pelo navegador.
  }
}

function openDb() {
  if (cachedDb) return Promise.resolve(cachedDb);
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      dbOpenPromise = null;
      const error = createDatabaseOpenError(
        'COLLECTION_QUEUE_DB_OPEN_TIMEOUT',
        'A fila local não abriu em 5 segundos. Recarregue esta página e feche '
          + 'outras abas antigas do AC.Prod antes de tentar a leitura novamente.',
      );
      reportDatabaseOpenIssue(error);
      reject(error);
    }, COLLECTION_QUEUE_DB_OPEN_TIMEOUT_MS);

    const rejectOpen = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      dbOpenPromise = null;
      reject(error);
    };

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
    req.onsuccess = (e) => {
      const db = e.target.result;
      if (settled) {
        releaseCachedDb(db);
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      dbOpenPromise = null;
      cachedDb = db;
      db.onversionchange = () => releaseCachedDb(db);
      db.onclose = () => {
        if (cachedDb === db) cachedDb = null;
      };
      resolve(db);
    };
    req.onerror = (e) => rejectOpen(e.target.error);
    req.onblocked = () => {
      const error = createDatabaseOpenError(
        'COLLECTION_QUEUE_DB_UPGRADE_BLOCKED',
        'Outra aba antiga do AC.Prod está bloqueando a atualização da fila '
          + 'local. Feche ou recarregue as outras abas e tente a leitura novamente.',
      );
      reportDatabaseOpenIssue(error);
      rejectOpen(error);
    };
  });

  return dbOpenPromise;
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

async function dbProcessCursorSlice(checkpoint, batchSize, processRecord) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const objectStore = tx.objectStore(STORE);
    const range = checkpoint === null
      ? undefined
      : IDBKeyRange.lowerBound(checkpoint, true);
    const request = objectStore.openCursor(range);
    let examined = 0;
    let changed = 0;
    let lastPrimaryKey = checkpoint;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || examined >= batchSize) return;

      examined += 1;
      lastPrimaryKey = cursor.primaryKey;
      if (processRecord(cursor.value, cursor.primaryKey, objectStore)) {
        changed += 1;
      }
      if (examined < batchSize) cursor.continue();
    };
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => resolve({
      changed,
      examined,
      // Uma fatia cheia agenda outra; uma fatia extra confirma o fim do cursor.
      hasMore: examined === batchSize,
      nextCheckpoint: examined === batchSize ? lastPrimaryKey : null,
    });
    tx.onerror = (e) => reject(tx.error || e.target.error);
    tx.onabort = (e) => reject(tx.error || e.target.error);
  });
}

async function dbDeleteExpiredSyncedBatch(cutoff, requestedBatchSize, checkpoint) {
  const batchSize = normalizePruneBatchSize(requestedBatchSize);
  const result = await dbProcessCursorSlice(
    checkpoint,
    batchSize,
    (event, primaryKey, objectStore) => {
      if (event.status !== 'synced' || !event.processed_at || event.processed_at >= cutoff) {
        return false;
      }
      objectStore.delete(primaryKey);
      return true;
    },
  );
  return { ...result, pruned: result.changed };
}

async function dbRecoverStaleProcessingBatch(
  cutoff,
  requestedBatchSize,
  checkpoint,
) {
  const batchSize = normalizeRecoveryBatchSize(requestedBatchSize);
  const now = new Date().toISOString();
  const result = await dbProcessCursorSlice(
    checkpoint,
    batchSize,
    (event, _primaryKey, objectStore) => {
      const eventTimestamp = new Date(
        event.updated_at || event.created_at_client,
      ).getTime();
      if (event.status !== 'processing' || !(eventTimestamp < cutoff)) {
        return false;
      }
      objectStore.put({
        ...event,
        status: 'pending',
        retries: 0,
        next_attempt_at: now,
        updated_at: now,
      });
      return true;
    },
  );
  return { ...result, recovered: result.changed };
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
    event_kind: payload.event_kind || (payload.is_replacement_event ? 'replacement_stage' : 'production_stage'),
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
export async function getQueueStatsByCellMachine(cellName, machineId, eventKind = null) {
  const all = await dbGetAll();
  const filtered = all.filter(e =>
    (!cellName || e.cellName === cellName || e.cell_name === cellName) &&
    (!machineId || e.machineId === machineId || e.machine_id === machineId) &&
    (!eventKind || e.event_kind === eventKind)
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

function readSharedCursor(storageKey, memoryCursor) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return memoryCursor;
    return storage.getItem(storageKey) || null;
  } catch {
    return memoryCursor;
  }
}

function rememberSharedCursor(storageKey, checkpoint) {
  try {
    if (checkpoint === null) {
      globalThis.localStorage?.removeItem(storageKey);
    } else {
      globalThis.localStorage?.setItem(storageKey, String(checkpoint));
    }
  } catch {
    // Ambientes privados podem bloquear localStorage; o cursor em memória basta.
  }
}

function readMaintenanceCursor() {
  maintenanceCursor = readSharedCursor(MAINTENANCE_CURSOR_KEY, maintenanceCursor);
  return maintenanceCursor;
}

function rememberMaintenanceCursor(checkpoint) {
  maintenanceCursor = checkpoint;
  rememberSharedCursor(MAINTENANCE_CURSOR_KEY, checkpoint);
}

function readRecoveryCursor() {
  recoveryCursor = readSharedCursor(RECOVERY_CURSOR_KEY, recoveryCursor);
  return recoveryCursor;
}

function rememberRecoveryCursor(checkpoint) {
  recoveryCursor = checkpoint;
  rememberSharedCursor(RECOVERY_CURSOR_KEY, checkpoint);
}

async function recoverStaleProcessingSlice(
  maxAgeMs = 120000,
  batchSize = COLLECTION_QUEUE_RECOVERY_BATCH_SIZE,
) {
  const staleAgeMs = normalizeNonNegativeNumber(maxAgeMs, 120000);
  const cutoff = Date.now() - staleAgeMs;
  const result = await dbRecoverStaleProcessingBatch(
    cutoff,
    batchSize,
    readRecoveryCursor(),
  );
  rememberRecoveryCursor(result.nextCheckpoint);
  return { recovered: result.recovered, hasMore: result.hasMore };
}

/**
 * Recupera uma fatia limitada de eventos processing antigos para pending.
 */
export async function recoverStaleProcessingEvents(
  maxAgeMs = 120000,
  batchSize = COLLECTION_QUEUE_RECOVERY_BATCH_SIZE,
) {
  const result = await recoverStaleProcessingSlice(maxAgeMs, batchSize);
  if (result.recovered > 0) {
    console.log(`[Queue] Recovered ${result.recovered} stale processing events.`);
    notifyChange();
  }
  return result.recovered;
}

/**
 * Evita varrer a fila de processing em cada tick de flush. Chamadas concorrentes
 * compartilham a mesma Promise e uma falha não fecha a janela de recuperação.
 */
export function runStaleProcessingRecovery(options = {}) {
  const {
    maxAgeMs = 120000,
    batchSize = COLLECTION_QUEUE_RECOVERY_BATCH_SIZE,
    cooldownMs = COLLECTION_QUEUE_RECOVERY_COOLDOWN_MS,
    force = false,
  } = options;
  const now = Date.now();
  const normalizedCooldownMs = normalizeNonNegativeNumber(
    cooldownMs,
    COLLECTION_QUEUE_RECOVERY_COOLDOWN_MS,
  );

  if (recoveryInFlight) return recoveryInFlight;
  if (!force && isWithinCooldown(now, lastRecoveryAt, normalizedCooldownMs)) {
    return Promise.resolve(0);
  }

  const task = Promise.resolve().then(() => (
    recoverStaleProcessingSlice(maxAgeMs, batchSize)
  ));
  recoveryInFlight = task
    .then((result) => {
      if (result.recovered > 0) {
        recoveryChangedSinceLastCompletion = true;
        console.log(`[Queue] Recovered ${result.recovered} stale processing events.`);
      }
      if (!result.hasMore) {
        lastRecoveryAt = Date.now();
        if (recoveryChangedSinceLastCompletion) {
          recoveryChangedSinceLastCompletion = false;
          notifyChange();
        }
      }
      return result.recovered;
    })
    .finally(() => {
      recoveryInFlight = null;
    });

  return recoveryInFlight;
}

/**
 * Retorna o evento pendente mais antigo.
 */
export async function getOldestPendingEvent() {
  const pending = await dbGetByIndex('by_status', 'pending');
  if (!pending || pending.length === 0) return null;
  const now = Date.now();
  const due = pending.filter((event) =>
    !event.next_attempt_at || new Date(event.next_attempt_at).getTime() <= now
  );
  due.sort((a, b) => a.created_at_client.localeCompare(b.created_at_client));
  return due[0] || null;
}

/**
 * Funções de marcação de status
 */
export async function markEventPending(clientEventId) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'pending';
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

export async function markEventSynced(clientEventId, result) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  event.status = 'synced';
  event.next_attempt_at = null;
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

export async function markEventError(clientEventId, error, maxRetries = 8) {
  const event = await dbGet(clientEventId);
  if (!event) return;
  const retries = (event.retries || 0) + 1;
  const retryable = error?.retryable !== false;
  event.status = retryable && retries < maxRetries ? 'pending' : 'error';
  event.retries = retries;
  event.last_error = error?.message || String(error);
  event.last_result = error?.result || null;
  const baseDelayMs = Math.min(300_000, 1_000 * (2 ** Math.max(retries - 1, 0)));
  const jitterMs = Math.round(baseDelayMs * Math.random() * 0.25);
  event.next_attempt_at = event.status === 'pending'
    ? new Date(Date.now() + baseDelayMs + jitterMs).toISOString()
    : null;
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
    await markEventError(clientEventId, err, opts.maxRetries || 8);
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
  const now = Date.now();
  const pending = (await dbGetByIndex('by_status', 'pending')).filter((event) =>
    !event.next_attempt_at || new Date(event.next_attempt_at).getTime() <= now
  );
  // Ordenar por horário de criação (FIFO)
  pending.sort((a, b) => a.created_at_client.localeCompare(b.created_at_client));

  let synced = 0;
  let errors = 0;

  for (const event of pending) {
    try {
      await processCollectionEvent(event.client_event_id, processFn, opts);
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
    await dbPut({
      ...event,
      status: 'pending',
      retries: 0,
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  notifyChange();
  return errorEvents.length;
}

/**
 * Limpa uma fatia limitada de eventos sincronizados com mais de N dias.
 */
async function pruneOldSyncedSlice(
  daysOld = COLLECTION_QUEUE_RETENTION_DAYS,
  batchSize = COLLECTION_QUEUE_PRUNE_BATCH_SIZE,
) {
  const retentionDays = normalizeNonNegativeNumber(
    daysOld,
    COLLECTION_QUEUE_RETENTION_DAYS,
  );
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const result = await dbDeleteExpiredSyncedBatch(
    cutoff,
    batchSize,
    readMaintenanceCursor(),
  );
  rememberMaintenanceCursor(result.nextCheckpoint);
  return { pruned: result.pruned, hasMore: result.hasMore };
}

export async function pruneOldSynced(
  daysOld = COLLECTION_QUEUE_RETENTION_DAYS,
  batchSize = COLLECTION_QUEUE_PRUNE_BATCH_SIZE,
) {
  const result = await pruneOldSyncedSlice(daysOld, batchSize);
  if (result.pruned > 0) notifyChange();
  return result.pruned;
}

function readSharedMaintenanceTimestamp() {
  try {
    const stored = Number(globalThis.localStorage?.getItem(MAINTENANCE_LAST_RUN_KEY));
    return Number.isFinite(stored) ? stored : 0;
  } catch {
    return 0;
  }
}

function rememberMaintenanceTimestamp(timestamp) {
  lastMaintenanceAt = timestamp;
  try {
    globalThis.localStorage?.setItem(MAINTENANCE_LAST_RUN_KEY, String(timestamp));
  } catch {
    // Ambientes privados podem bloquear localStorage; o cooldown em memória basta.
  }
}

async function pruneWithOptionalCrossTabLock(retentionDays, batchSize) {
  if (globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request(
      MAINTENANCE_LOCK_NAME,
      { ifAvailable: true },
      (lock) => (lock ? pruneOldSyncedSlice(retentionDays, batchSize) : null),
    );
  }
  return pruneOldSyncedSlice(retentionDays, batchSize);
}

/**
 * Manutenção fria da fila. Não deve ser aguardada pelo caminho de captura.
 * O timestamp em localStorage coordena o cooldown entre abas e Web Locks evita
 * duas limpezas simultâneas quando o navegador oferece esse recurso.
 */
export function runCollectionQueueMaintenance(options = {}) {
  const {
    retentionDays = COLLECTION_QUEUE_RETENTION_DAYS,
    batchSize = COLLECTION_QUEUE_PRUNE_BATCH_SIZE,
    cooldownMs = COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS,
    force = false,
  } = options;
  const now = Date.now();
  const lastRun = Math.max(lastMaintenanceAt, readSharedMaintenanceTimestamp());
  const normalizedCooldownMs = normalizeNonNegativeNumber(
    cooldownMs,
    COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS,
  );

  if (maintenanceInFlight) return maintenanceInFlight;
  if (!force && isWithinCooldown(now, lastRun, normalizedCooldownMs)) {
    return Promise.resolve({ pruned: 0, hasMore: false, skipped: true });
  }

  const task = Promise.resolve().then(() => (
    pruneWithOptionalCrossTabLock(retentionDays, batchSize)
  ));
  maintenanceInFlight = task
    .then((result) => {
      if (result === null) {
        return { pruned: 0, hasMore: false, skipped: true };
      }
      if (result.pruned > 0) maintenanceChangedSinceLastCompletion = true;
      if (!result.hasMore) {
        rememberMaintenanceTimestamp(Date.now());
        if (maintenanceChangedSinceLastCompletion) {
          maintenanceChangedSinceLastCompletion = false;
          notifyChange();
        }
      }
      return { ...result, skipped: false };
    })
    .finally(() => {
      maintenanceInFlight = null;
    });

  return maintenanceInFlight;
}

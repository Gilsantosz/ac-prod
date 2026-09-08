/**
 * AC.Prod — Fila de eventos de coleta durável (IndexedDB)
 *
 * Garante zero perda de leituras mesmo com falha de rede ou lentidão do Supabase.
 * Cada evento recebe um UUID gerado no cliente (client_event_id) para idempotência.
 */

import {
  COLLECTION_STATES,
  assertCollectionTransition,
  collectionStateFromResult,
  isCollectionTerminalState,
  legacyQueueStatusForCollectionState,
  normalizeCollectionState,
} from '@/lib/collectionStateMachine';
import {
  getCollectionDeviceId,
  nextCollectionDeviceSequence,
} from '@/lib/collectionDeviceIdentity';
import { projectScopedStorageKey } from '@/lib/runtimeEnvironment';
import { enrichCollectionResult } from '@/lib/collectionResultMetadata';

const DB_NAME = projectScopedStorageKey('acprod_collection_queue');
const DB_VERSION = 4;
const STORE = 'events';

export const COLLECTION_QUEUE_RETENTION_DAYS = 3;
export const COLLECTION_QUEUE_PRUNE_BATCH_SIZE = 100;
export const COLLECTION_QUEUE_RECOVERY_BATCH_SIZE = 50;
export const COLLECTION_QUEUE_MAINTENANCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const COLLECTION_QUEUE_RECOVERY_COOLDOWN_MS = 60 * 1000;

const COLLECTION_QUEUE_MAX_PRUNE_BATCH_SIZE = 250;
const COLLECTION_QUEUE_MAX_RECOVERY_BATCH_SIZE = 100;
const COLLECTION_QUEUE_DB_OPEN_TIMEOUT_MS = 5_000;

const MAINTENANCE_LOCK_NAME = projectScopedStorageKey('acprod-collection-queue-maintenance');
const MAINTENANCE_LAST_RUN_KEY = projectScopedStorageKey('acprod_collection_queue_last_maintenance_at');
const MAINTENANCE_CURSOR_KEY = projectScopedStorageKey('acprod_collection_queue_maintenance_cursor');
const RECOVERY_CURSOR_KEY = projectScopedStorageKey('acprod_collection_queue_recovery_cursor');

let maintenanceInFlight = null;
let lastMaintenanceAt = 0;
let maintenanceChangedSinceLastCompletion = false;
let recoveryInFlight = null;
let lastRecoveryAt = 0;
let recoveryChangedSinceLastCompletion = false;
let cachedDb = null;
let dbOpenPromise = null;
let queueSnapshotInFlight = null;
let maintenanceCursor = null;
let recoveryCursor = null;
const reconciliationCursors = new Map();

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
      if (!store.indexNames.contains('by_collection_state')) {
        store.createIndex('by_collection_state', 'collection_state', { unique: false });
      }
      if (!store.indexNames.contains('by_source_mode')) {
        store.createIndex('by_source_mode', 'source_mode', { unique: false });
      }
      if (!store.indexNames.contains('by_device_sequence')) {
        store.createIndex('by_device_sequence', 'device_sequence', { unique: false });
      }
      if (!store.indexNames.contains('by_status_id')) {
        store.createIndex('by_status_id', ['status', 'client_event_id'], { unique: false });
      }
      if (!store.indexNames.contains('by_status_source_created')) {
        store.createIndex('by_status_source_created', ['status', 'source_mode', 'created_at_client'], { unique: false });
        const legacyRows = store.openCursor();
        legacyRows.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          if (!cursor.value.source_mode) {
            cursor.update({ ...cursor.value,
              source_mode: cursor.value.queued_offline ? 'offline_replay' : 'live' });
          }
          cursor.continue();
        };
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
    tx.onabort = (e) => reject(tx.error || e.target.error);
  });
}

/** Read, decide and write in ONE transaction: another tab/HTTP/Broadcast cannot
 * overwrite a newer state between a readonly get and a later put. */
async function dbMutate(clientEventId, mutate) {
  return (await dbMutateMany([clientEventId], mutate))[0] ?? null;
}

async function dbMutateMany(clientEventIds, mutate) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const objectStore = tx.objectStore(STORE);
    const result = [];
    for (const [position, clientEventId] of clientEventIds.entries()) {
      const request = objectStore.get(clientEventId);
      request.onsuccess = (event) => {
        try {
          const current = event.target.result;
          const updated = mutate(current) ?? current ?? null;
          result[position] = updated;
          if (updated && updated !== current) objectStore.put(updated);
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
      request.onerror = (event) => reject(event.target.error);
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = (event) => reject(tx.error || event.target.error);
    tx.onabort = (event) => reject(tx.error || event.target.error);
  });
}

async function dbPatchEnqueueDuration(clientEventId, elapsedMs) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const objectStore = tx.objectStore(STORE);
    const request = objectStore.get(clientEventId);
    request.onsuccess = (event) => {
      const current = event.target.result;
      if (!current) return;
      objectStore.put({
        ...current,
        enqueue_duration_ms: elapsedMs,
      });
    };
    request.onerror = (event) => reject(event.target.error);
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(tx.error || event.target.error);
    tx.onabort = (event) => reject(tx.error || event.target.error);
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
      const state = normalizeCollectionState(event.collection_state);
      if (event.status !== 'processing' || !(eventTimestamp < cutoff)
        || state === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
        || state === COLLECTION_STATES.PROCESSING
        || isCollectionTerminalState(state)) {
        return false;
      }
      objectStore.put({
        ...event,
        status: 'pending',
        collection_state: COLLECTION_STATES.RETRYING,
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
  if (queueSnapshotInFlight) return queueSnapshotInFlight;
  queueSnapshotInFlight = readQueueSnapshot().finally(() => {
    queueSnapshotInFlight = null;
  });
  return queueSnapshotInFlight;
}

async function readQueueSnapshot() {
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

const SENSITIVE_EVENT_KEYS = new Set([
  'access_token',
  'authorization',
  'jwt',
  'operator_session_token',
  'operatorsessiontoken',
  'session_token',
  'token',
]);

function isSensitiveEventKey(key) {
  const normalized = String(key).toLowerCase();
  return SENSITIVE_EVENT_KEYS.has(normalized)
    || normalized.includes('token')
    || normalized.includes('jwt')
    || normalized === 'cookie';
}

/**
 * Remove credenciais inclusive de payloads aninhados antes de qualquer escrita.
 * A sessão operacional não sensível é representada por operator_session_id.
 */
export function sanitizeCollectionEventPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeCollectionEventPayload);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveEventKey(key))
      .map(([key, nestedValue]) => [key, sanitizeCollectionEventPayload(nestedValue)]),
  );
}

// ─── Notificação de UI ────────────────────────────────────────────────────────

function notifyChange() {
  try {
    window.dispatchEvent(new CustomEvent('collection-queue-changed'));
  } catch (_) { /* ambiente sem window */ }
}

export function notifyCollectionQueueChange() {
  notifyChange();
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Enfileira um evento de coleta.
 * @param {object} payload — dados da leitura (rawValue, cellName, shift, operator, etc.)
 * @returns {string} client_event_id gerado
 */
export async function enqueueCollectionEvent(payload) {
  const safePayload = sanitizeCollectionEventPayload(payload || {});
  const now = new Date().toISOString();
  const capturedAtClient = safePayload.captured_at_client
    || safePayload.capturedAtClient
    || safePayload.created_at_client
    || safePayload.createdAtClient
    || now;
  const providedClientEventId = safePayload.client_event_id || null;
  const clientEventId = providedClientEventId || generateClientEventId();
  const deviceId = safePayload.device_id
    || safePayload.deviceId
    || getCollectionDeviceId();
  const providedDeviceSequence = Number(safePayload.device_sequence);
  const deviceSequence = Number.isSafeInteger(providedDeviceSequence)
    && providedDeviceSequence > 0
    ? Number(safePayload.device_sequence)
    : await nextCollectionDeviceSequence(deviceId);
  const sourceMode = safePayload.source_mode
    || safePayload.sourceMode
    || (globalThis.navigator?.onLine === false ? 'offline_replay' : 'live');
  const event = {
    client_event_id: clientEventId,
    status: 'pending',
    collection_state: COLLECTION_STATES.PENDING_DATABASE,
    retries: 0,
    created_at_client: capturedAtClient,
    captured_at_client: capturedAtClient,
    updated_at: now,
    event_kind: safePayload.event_kind || (safePayload.is_replacement_event ? 'replacement_stage' : 'production_stage'),
    next_attempt_at: now,
    source_mode: sourceMode === 'offline_replay' ? 'offline_replay' : 'live',
    device_id: deviceId,
    device_sequence: deviceSequence,
    raw_value: safePayload.rawValue ?? safePayload.raw_value ?? '',
    lot_id: safePayload.lotId ?? safePayload.lot_id ?? null,
    lot_code: safePayload.lotCode ?? safePayload.lot_code ?? null,
    load_number: safePayload.loadNumber ?? safePayload.load_number ?? null,
    order_number: safePayload.orderNumber ?? safePayload.order_number ?? null,
    customer_name: safePayload.customerName ?? safePayload.customer_name ?? null,
    environment_name: safePayload.environmentName ?? safePayload.environment_name ?? null,
    machine_id: safePayload.machineId ?? safePayload.machine_id ?? null,
    machine_name: safePayload.machineName ?? safePayload.machine_name ?? null,
    station_name: safePayload.stationName ?? safePayload.station_name ?? null,
    enqueue_duration_ms: 0,
    sync_started_at: null,
    sync_finished_at: null,
    sync_duration_ms: null,
    ...safePayload,
    // Campos de transporte/estado são definidos pelo cliente e jamais pelo
    // payload do chamador. Mantê-los depois do spread evita pular a fila,
    // forjar ACK/finalização ou suprimir retentativas no IndexedDB.
    client_event_id: clientEventId,
    status: 'pending',
    collection_state: COLLECTION_STATES.PENDING_DATABASE,
    retries: 0,
    created_at_client: capturedAtClient,
    captured_at_client: capturedAtClient,
    updated_at: now,
    next_attempt_at: now,
    source_mode: sourceMode === 'offline_replay' ? 'offline_replay' : 'live',
    device_id: deviceId,
    device_sequence: deviceSequence,
    enqueue_duration_ms: 0,
    sync_started_at: null,
    sync_finished_at: null,
    sync_duration_ms: null,
    processed_at: null,
    result: null,
    last_result: null,
    last_error: null,
    decision_authority: null,
    pipeline_version: null,
  };
  const t0 = performance.now();
  // Supplied IDs can be replayed concurrently by another tab. Never overwrite
  // their durable result, device sequence or original captured context.
  if (providedClientEventId) {
    await dbMutate(event.client_event_id, (existing) => existing || event);
  } else {
    await dbPut(event);
  }
  const elapsed = performance.now() - t0;

  // A durabilidade da captura depende de uma única escrita. A telemetria é
  // anexada depois sem bloquear o scanner nem alterar estado/resultado atual.
  void dbPatchEnqueueDuration(event.client_event_id, elapsed).catch((error) => {
    console.warn('[CollectionQueue] Falha ao registrar a duração local:', error);
  });

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
  return summarizeQueueStats(await dbGetAll());
}

function summarizeQueueStats(events, matches = () => true) {
  const cutoff = Date.now() - 60_000;
  const result = { total: 0, pending: 0, processing: 0, synced: 0, error: 0,
    hasStalePending: false, hasSlowEnqueue: false };
  for (const event of events) {
    if (!matches(event)) continue;
    result.total += 1;
    if (['pending', 'processing', 'synced', 'error'].includes(event.status)) result[event.status] += 1;
    const capturedAt = new Date(event.created_at_client).getTime();
    if ((event.status === 'pending' || event.status === 'processing') && capturedAt < cutoff) {
      result.hasStalePending = true;
    }
    // A historical slow disk write must not remain a permanent live SLA alarm.
    if (Number(event.enqueue_duration_ms) > 800 && capturedAt >= cutoff) result.hasSlowEnqueue = true;
  }
  return result;
}

/**
 * Retorna estatísticas da fila filtradas por célula e máquina.
 */
export async function getQueueStatsByCellMachine(cellName, machineId, eventKind = null) {
  return summarizeQueueStats(await dbGetAll(), e =>
    (!cellName || e.cellName === cellName || e.cell_name === cellName) &&
    (!machineId || e.machineId === machineId || e.machine_id === machineId) &&
    (!eventKind || e.event_kind === eventKind)
  );
}

/**
 * Busca eventos com determinado status.
 */
export async function getEventsByStatus(status) {
  return dbGetByIndex('by_status', status);
}

export async function getCollectionEvent(clientEventId) {
  return dbGet(clientEventId);
}

/**
 * Fixa a fronteira transacional antes da primeira tentativa de rede. A versão
 * nunca muda automaticamente: ACK incerto exige reconciliação no mesmo
 * pipeline, impedindo dupla escrita produtiva durante rollout/rollback.
 */
export async function pinCollectionPipelineVersion(events = [], version) {
  const normalizedVersion = Number(version);
  if (![2, 3].includes(normalizedVersion)) {
    throw new Error(`Versão de pipeline inválida: ${version}.`);
  }

  for (const candidate of events) {
    const clientEventId = candidate?.client_event_id;
    if (!clientEventId) continue;
    if (typeof globalThis.indexedDB === 'undefined') {
      const currentVersion = Number(candidate.pipeline_version);
      if ([2, 3].includes(currentVersion) && currentVersion !== normalizedVersion) {
        const error = new Error(
          `A leitura ${clientEventId} já pertence ao pipeline V${currentVersion}.`,
        );
        error.code = 'COLLECTION_PIPELINE_ASSIGNMENT_CONFLICT';
        error.retryable = false;
        throw error;
      }
      candidate.pipeline_version = normalizedVersion;
      continue;
    }
    await dbMutate(clientEventId, (event) => {
      const currentVersion = Number(event?.pipeline_version || candidate.pipeline_version);
      if ([2, 3].includes(currentVersion) && currentVersion !== normalizedVersion) {
        const error = new Error(
          `A leitura ${clientEventId} já pertence ao pipeline V${currentVersion}.`,
        );
        error.code = 'COLLECTION_PIPELINE_ASSIGNMENT_CONFLICT';
        error.retryable = false;
        throw error;
      }
      if (!event || currentVersion === normalizedVersion) return event;
      return {
        ...event,
        pipeline_version: normalizedVersion,
        pipeline_assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });
    candidate.pipeline_version = normalizedVersion;
  }
  notifyChange();
  return normalizedVersion;
}

/**
 * Exceção estreita para rollback: desfaz a primeira atribuição somente quando o
 * próprio RPC V3 respondeu, de forma definitiva, que o ingresso estava
 * desligado antes de qualquer persistência. Eventos já atribuídos em uma
 * tentativa anterior continuam imutáveis e exigem reconciliação no V3.
 */
export async function reassignFirstCollectionPipelineAttempt(
  events = [],
  fromVersion = 3,
  toVersion = 2,
) {
  if (![2, 3].includes(Number(fromVersion))
    || ![2, 3].includes(Number(toVersion))
    || Number(fromVersion) === Number(toVersion)) {
    throw new Error('Reatribuição de pipeline inválida.');
  }

  for (const candidate of events) {
    const clientEventId = candidate?.client_event_id;
    if (!clientEventId) continue;
    if (typeof globalThis.indexedDB === 'undefined') {
      if (Number(candidate.pipeline_version) !== Number(fromVersion)) {
        throw new Error(`A leitura ${clientEventId} não pertence ao pipeline esperado.`);
      }
      candidate.pipeline_version = Number(toVersion);
      continue;
    }

    await dbMutate(clientEventId, (event) => {
      const currentVersion = Number(event?.pipeline_version || candidate.pipeline_version);
      const currentState = normalizeCollectionState(
        event?.collection_state || candidate.collection_state,
        COLLECTION_STATES.PENDING_DATABASE,
      );
      if (currentVersion !== Number(fromVersion)
        || isCollectionTerminalState(currentState)
        || currentState === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
        || currentState === COLLECTION_STATES.PROCESSING) {
        const error = new Error(
          `A leitura ${clientEventId} já cruzou a fronteira do pipeline V${currentVersion || '?'}.`,
        );
        error.code = 'COLLECTION_PIPELINE_REASSIGNMENT_UNSAFE';
        error.retryable = false;
        throw error;
      }
      if (!event) return event;
      return {
        ...event,
        pipeline_version: Number(toVersion),
        pipeline_reassigned_at: new Date().toISOString(),
        pipeline_reassignment_reason: 'V3_INGRESS_DISABLED_BEFORE_PERSISTENCE',
        updated_at: new Date().toISOString(),
      };
    });
    candidate.pipeline_version = Number(toVersion);
  }
  notifyChange();
  return Number(toVersion);
}

export async function getUnresolvedCollectionEvents(options = {}) {
  const {
    eventKind = 'production_stage',
    limit = 100,
    olderThanMs = 0,
  } = options;
  const cutoff = Date.now() - Math.max(0, Number(olderThanMs) || 0);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  const checkpoint = reconciliationCursors.get(eventKind) || { statusIndex: 0, id: '' };
  const statuses = ['processing', 'pending', 'error'];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('by_status_id');
    const result = [];
    let examined = 0;
    let nextCheckpoint = null;

    const readStatus = (statusIndex, afterId = '') => {
      if (statusIndex >= statuses.length) return;
      const status = statuses[statusIndex];
      const range = IDBKeyRange.bound([status, afterId], [status, []], true, true);
      const request = index.openCursor(range);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          readStatus(statusIndex + 1);
          return;
        }
        const item = cursor.value;
        examined += 1;
        const state = normalizeCollectionState(item.collection_state);
        const attempted = item.sync_started_at || item.database_acknowledged_at;
        const updatedAt = new Date(
          item.database_acknowledged_at || item.updated_at || item.created_at_client,
        ).getTime();
        if (item.event_kind === eventKind && [2, 3].includes(Number(item.pipeline_version))
          && attempted && (!isCollectionTerminalState(state) || isLocalTransportFailure(item))
          && updatedAt <= cutoff) {
          result.push(item);
        }
        // Bound both records materialized and work per turn. Rotate even when
        // missing receipts / not-yet-due items occupy the head of the queue.
        if (result.length >= safeLimit || examined >= 500) {
          nextCheckpoint = { statusIndex, id: item.client_event_id };
          return;
        }
        cursor.continue();
      };
      request.onerror = (event) => reject(event.target.error);
    };
    readStatus(checkpoint.statusIndex, checkpoint.id);
    tx.oncomplete = () => {
      if (nextCheckpoint) reconciliationCursors.set(eventKind, nextCheckpoint);
      else reconciliationCursors.delete(eventKind);
      Object.defineProperty(result, 'hasMore', { value: nextCheckpoint !== null });
      resolve(result);
    };
    tx.onerror = (event) => reject(tx.error || event.target.error);
    tx.onabort = (event) => reject(tx.error || event.target.error);
  });
}

/** Only materialize a bounded number of due unsent events, not the retained
 * receipt history. The caller can request one extra item to detect backlog. */
export async function getPendingCollectionEvents(options = {}) {
  const { eventKind = null, limit = 126, now = Date.now() } = options;
  const safeLimit = Math.max(1, Math.min(501, Number(limit) || 126));
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const events = [];
    // Read each source independently so a large replay backlog cannot hide
    // fresh scans from the live:replay scheduler. Memory remains bounded.
    for (const sourceMode of ['live', 'offline_replay']) {
      const request = tx.objectStore(STORE).index('by_status_source_created').openCursor(
        IDBKeyRange.bound(['pending', sourceMode, ''], ['pending', sourceMode, []], false, true),
      );
      let sourceCount = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const item = cursor.value;
        if ((!eventKind || item.event_kind === eventKind)
          && (!item.next_attempt_at || new Date(item.next_attempt_at).getTime() <= now)) {
          events.push(item);
          sourceCount += 1;
        }
        if (sourceCount < safeLimit) cursor.continue();
      };
      request.onerror = (event) => reject(event.target.error);
    }
    tx.oncomplete = () => resolve(events.sort((a, b) => (
      a.created_at_client.localeCompare(b.created_at_client)
    )));
    tx.onerror = (event) => reject(tx.error || event.target.error);
    tx.onabort = (event) => reject(tx.error || event.target.error);
  });
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
  return (await getPendingCollectionEvents({ limit: 1 }))[0] || null;
}

/**
 * Funções de marcação de status
 */
export async function markEventPending(clientEventId) {
  const event = await dbMutate(clientEventId, (current) => {
    if (!current || hasServerDecision(current)) return current;
    const now = new Date().toISOString();
    return {
      ...current,
      status: 'pending',
      collection_state: current.collection_state === COLLECTION_STATES.RETRYING
        ? COLLECTION_STATES.RETRYING : COLLECTION_STATES.PENDING_DATABASE,
      next_attempt_at: now,
      updated_at: now,
    };
  });
  notifyChange();
  return event;
}

function hasServerDecision(event) {
  const state = normalizeCollectionState(event.collection_state);
  return isCollectionTerminalState(state)
    || state === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
    || state === COLLECTION_STATES.PROCESSING;
}

function isLocalTransportFailure(event) {
  return normalizeCollectionState(event.collection_state) === COLLECTION_STATES.DEAD_LETTERED
    && event.decision_authority !== 'server'
    && !event.processed_at;
}

export async function claimCollectionEventsForTransport(events = []) {
  if (!events.length) return [];
  const claimedIds = new Set();
  const now = new Date().toISOString();
  const updated = await dbMutateMany(events.map((event) => event.client_event_id), (current) => {
    if (!current || current.status !== 'pending' || hasServerDecision(current)
      || (current.next_attempt_at && current.next_attempt_at > now)) return current;
    claimedIds.add(current.client_event_id);
    return {
      ...current,
      status: 'processing',
      collection_state: COLLECTION_STATES.PENDING_DATABASE,
      next_attempt_at: null,
      sync_started_at: now,
      updated_at: now,
    };
  });
  return updated.filter((event) => event && claimedIds.has(event.client_event_id));
}

export async function markEventProcessing(clientEventId, options = {}) {
  const event = await dbMutate(clientEventId, (current) => {
    if (!current || hasServerDecision(current)) return current;
    const now = new Date().toISOString();
    return {
      ...current,
      status: 'processing',
      // Local transport is not server PROCESSING until a receipt exists.
      collection_state: COLLECTION_STATES.PENDING_DATABASE,
      next_attempt_at: null,
      sync_started_at: now,
      updated_at: now,
    };
  });
  if (options.notify !== false) notifyChange();
  return event;
}

export async function markEventSynced(clientEventId, result, options = {}) {
  const canonicalResult = result?.result ?? result?.resultado ?? result;
  let finalState = collectionStateFromResult(canonicalResult);
  if (!finalState && canonicalResult?.success === true) {
    finalState = COLLECTION_STATES.APPROVED;
  }
  if (!finalState || !isCollectionTerminalState(finalState)) {
    finalState = COLLECTION_STATES.REJECTED;
  }
  return markEventFinalized(clientEventId, {
    collection_state: finalState,
    result: canonicalResult,
  }, options);
}

export async function markEventError(
  clientEventId,
  error,
  maxRetries = 8,
  options = {},
) {
  const event = await dbMutate(clientEventId, (current) => {
  // The check must occur inside the transaction, including terminal decisions.
    if (!current || hasServerDecision(current)) return current;
    const event = { ...current };
    const retries = (event.retries || 0) + 1;
    const retryable = error?.retryable !== false;
    event.status = retryable && retries < maxRetries ? 'pending' : 'error';
    event.collection_state = event.status === 'pending'
      ? COLLECTION_STATES.RETRYING
      : COLLECTION_STATES.DEAD_LETTERED;
    event.decision_authority = 'transport';
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
    return event;
  });
  if (options.notify !== false) notifyChange();
  return event;
}

async function transitionCollectionEvent(clientEventId, nextState, patch = {}, options = {}) {
  const updated = await dbMutate(clientEventId, (event) => {
    if (!event) return event;
    const currentState = isLocalTransportFailure(event) ? COLLECTION_STATES.RETRYING : normalizeCollectionState(
      event.collection_state,
      event.status === 'processing'
        ? COLLECTION_STATES.PENDING_DATABASE
        : COLLECTION_STATES.CAPTURED_LOCAL,
    );
    // Uma decisão terminal só pode ser substituída por uma correção autoritativa
    // explicitamente marcada pelo servidor/projetor. Entregas normais continuam
    // monotônicas e idempotentes.
    const normalizedCandidate = normalizeCollectionState(nextState);
    if (isCollectionTerminalState(currentState) && options.force !== true) {
      if (normalizedCandidate !== currentState || !patch.result) return event;
      // Broadcast pode chegar primeiro com só a decisão. A resposta HTTP
      // completa os detalhes na mesma transação, sem finalizar outra vez.
      const result = enrichCollectionResult(event.result, sanitizeCollectionEventPayload(patch.result));
      return result === event.result ? event : {
        ...event, result, updated_at: new Date().toISOString(),
      };
    }
    const stateRank = {
      [COLLECTION_STATES.CAPTURED_LOCAL]: 0,
      [COLLECTION_STATES.PENDING_DATABASE]: 1,
      [COLLECTION_STATES.RETRYING]: 1,
      [COLLECTION_STATES.DATABASE_ACKNOWLEDGED]: 2,
      [COLLECTION_STATES.PROCESSING]: 3,
    };
    if (options.force !== true
    && stateRank[normalizedCandidate] < stateRank[currentState]) {
      return event;
    }
    const normalizedNext = options.force === true
      ? normalizedCandidate
      : assertCollectionTransition(currentState, nextState);
    const now = new Date().toISOString();
    return {
      ...event,
      ...sanitizeCollectionEventPayload(patch),
      collection_state: normalizedNext,
      status: legacyQueueStatusForCollectionState(normalizedNext),
      updated_at: now,
    };
  });
  if (options.notify !== false) notifyChange();
  return updated;
}

export async function markEventDatabaseAcknowledged(
  clientEventId,
  acknowledgement = {},
  options = {},
) {
  return transitionCollectionEvent(
    clientEventId,
    COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    {
      database_acknowledgement: acknowledgement,
      database_acknowledged_at: acknowledgement.received_at_db
        || acknowledgement.receivedAtDb
        || new Date().toISOString(),
      batch_id: acknowledgement.batch_id || acknowledgement.batchId || null,
      next_attempt_at: null,
      decision_authority: 'server',
    },
    options,
  );
}

export async function markEventServerProcessing(
  clientEventId,
  serverPayload = {},
  options = {},
) {
  return transitionCollectionEvent(
    clientEventId,
    COLLECTION_STATES.PROCESSING,
    {
      server_processing: serverPayload,
      server_processing_at: serverPayload.processing_started_at
        || serverPayload.occurred_at
        || new Date().toISOString(),
    },
    options,
  );
}

export async function markEventFinalized(
  clientEventId,
  finalPayload = {},
  options = {},
) {
  const result = finalPayload.result ?? finalPayload.resultado ?? finalPayload;
  const state = collectionStateFromResult(finalPayload)
    || collectionStateFromResult(result)
    || (result?.success === true ? COLLECTION_STATES.APPROVED : COLLECTION_STATES.REJECTED);
  if (!isCollectionTerminalState(state)) {
    throw new Error(`Resultado final sem estado terminal: ${state || 'UNKNOWN'}.`);
  }
  return transitionCollectionEvent(
    clientEventId,
    state,
    {
      result,
      decision_authority: 'server',
      next_attempt_at: null,
      sync_finished_at: new Date().toISOString(),
      processed_at: finalPayload.processed_at
        || finalPayload.processado_em
        || new Date().toISOString(),
    },
    options,
  );
}

export async function markEventDeadLettered(
  clientEventId,
  payload = {},
  options = {},
) {
  return transitionCollectionEvent(
    clientEventId,
    COLLECTION_STATES.DEAD_LETTERED,
    {
      last_error: payload.error || payload.message || 'Evento enviado para dead letter.',
      last_result: payload,
      decision_authority: 'server',
      next_attempt_at: null,
      sync_finished_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    },
    options,
  );
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
  let retried = 0;
  for (let offset = 0; offset < errorEvents.length; offset += 100) {
    await dbMutateMany(errorEvents.slice(offset, offset + 100).map((event) => event.client_event_id), (current) => {
      // An authoritative correction/ACK may arrive during manual replay.
      if (!current || current.status !== 'error') return current;
      retried += 1;
      return {
        ...current,
        status: 'pending',
        collection_state: COLLECTION_STATES.RETRYING,
        retries: 0,
        decision_authority: null,
        next_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });
  }
  notifyChange();
  return retried;
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

import { supabase } from '@/lib/supabaseClient';
import { getOperatorSession } from '@/lib/operatorSessionService';
import {
  getCollectionAppVersion,
  getCollectionDeviceId,
} from '@/lib/collectionDeviceIdentity';
import {
  pinCollectionPipelineVersion,
  reassignFirstCollectionPipelineAttempt,
  sanitizeCollectionEventPayload,
} from '@/lib/collectionEventQueue';
import {
  COLLECTION_STATES,
  collectionStateFromResult,
  isCollectionTerminalState,
} from '@/lib/collectionStateMachine';

export const COLLECTION_BATCH_SIZE = 25;
export const COLLECTION_BATCH_MAX_SIZE = 25;
export const COLLECTION_TRANSPORT_TIMEOUT_MS = 10_000;
export const COLLECTION_FLAGS_TIMEOUT_MS = 5_000;
// Esta é uma fatia ativa de reconciliação, não o prazo do servidor. Depois dela
// somente os IDs ainda abertos voltam ao backoff local, liberando o próximo
// micro-lote sem duplicar os itens já finalizados no PostgreSQL.
export const COLLECTION_FINALIZATION_TIMEOUT_MS = 15_000;
export const COLLECTION_FINALIZATION_POLL_INITIAL_MS = 120;
export const COLLECTION_FINALIZATION_POLL_MAX_MS = 5_000;

const COLLECTION_FINALIZATION_POLL_GROWTH = 1.8;
const COLLECTION_FINALIZATION_POLL_JITTER_FLOOR = 0.85;
export const COLLECTION_PIPELINE_FLAGS_CACHE_MS = 30_000;

const V3_INGRESS_FLAG = 'collection_pipeline_v3_ingress';
let flagsCache = null;
let flagsCacheExpiresAt = 0;
let flagsRequestInFlight = null;
let flagsFailure = null;
let flagsFailureExpiresAt = 0;

const FINAL_STATUSES = new Set(['sincronizada', 'erro']);
const INGRESS_SELECT = [
  'id',
  'client_event_id',
  'tag_lida',
  'timestamp_leitura',
  'status_sincronizacao',
  'resultado',
  'erro',
  'retryable',
  'batch_id',
  'batch_sequence',
  'server_received_at',
  'processado_em',
  'attempt_count',
  'next_attempt_at',
  'last_error_code',
  'queue_delay_ms',
  'processing_duration_ms',
].join(',');

function randomUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }
  throw new Error('Gerador criptográfico de UUID indisponível.');
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function deterministicJitterUnit(seed) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffff_ffff;
}

export function getCollectionFinalizationPollDelayMs(
  attempt,
  clientEventIds = [],
) {
  const numericAttempt = Number(attempt);
  const safeAttempt = Number.isFinite(numericAttempt) && numericAttempt > 0
    ? Math.floor(numericAttempt)
    : 0;

  if (safeAttempt === 0) return COLLECTION_FINALIZATION_POLL_INITIAL_MS;

  const seed = clientEventIds.map((value) => String(value ?? '')).join('|');
  const jitterFactor = COLLECTION_FINALIZATION_POLL_JITTER_FLOOR
    + deterministicJitterUnit(seed)
      * (1 - COLLECTION_FINALIZATION_POLL_JITTER_FLOOR);
  const exponentialDelay = Math.min(
    COLLECTION_FINALIZATION_POLL_MAX_MS,
    Math.round(
      COLLECTION_FINALIZATION_POLL_INITIAL_MS
        * (COLLECTION_FINALIZATION_POLL_GROWTH ** safeAttempt),
    ),
  );

  return Math.max(
    COLLECTION_FINALIZATION_POLL_INITIAL_MS,
    Math.round(exponentialDelay * jitterFactor),
  );
}

function wrapSupabaseError(error, fallbackMessage) {
  const wrapped = new Error(error?.message || fallbackMessage);
  wrapped.code = error?.code;
  wrapped.details = error?.details;
  wrapped.hint = error?.hint;
  wrapped.retryable = error?.code !== '42501' && error?.code !== 'PGRST301';
  return wrapped;
}

/**
 * A conexão/autenticação do SDK também pode ficar pendurada. O AbortSignal
 * cancela fetch e a corrida limita a espera mesmo antes de fetch começar.
 * Timeout nunca comprova rollback: o retry preserva pipeline/client_event_id.
 */
async function awaitCollectionTransport(query, timeoutMs = COLLECTION_TRANSPORT_TIMEOUT_MS) {
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || COLLECTION_TRANSPORT_TIMEOUT_MS);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const request = controller && typeof query?.abortSignal === 'function'
    ? query.abortSignal(controller.signal)
    : query;
  let timeoutId;
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('Confirmação do banco demorou além do limite; leitura preservada para nova tentativa.');
      error.code = 'COLLECTION_TRANSPORT_TIMEOUT';
      error.retryable = true;
      error.acknowledgementUnknown = true;
      reject(error);
      controller?.abort();
    }, safeTimeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(request), deadline]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function eventRawValue(event = {}) {
  return String(
    event.raw_value
      ?? event.rawValue
      ?? event.tag_lida
      ?? event.tagValue
      ?? '',
  ).trim();
}

function buildIngressRows(events, batchId, fallbackSessionToken = null) {
  return events.map((event, index) => {
    const clientEventId = event.client_event_id || randomUuid();
    const timestamp = event.created_at_client
      || event.createdAtClient
      || event.timestamp_leitura
      || new Date().toISOString();
    const readerType = event.reader_type
      || event.readerType
      || 'keyboard_barcode';
    const deviceId = event.device_id || event.deviceId || null;
    const rawValue = eventRawValue(event);
    // Compatibilidade V2: a credencial atual é lida somente nesta fronteira de
    // transporte. Credenciais antigas eventualmente presentes no evento nunca
    // são reutilizadas nem voltam para a fila local.
    const operatorSessionToken = fallbackSessionToken || null;
    const safeEvent = sanitizeCollectionEventPayload(event);

    return {
      client_event_id: clientEventId,
      tag_lida: rawValue,
      timestamp_leitura: timestamp,
      status_sincronizacao: 'recebida',
      event_kind: 'production_stage',
      reader_type: readerType,
      device_id: deviceId,
      batch_id: batchId,
      batch_sequence: index,
      payload: {
        ...safeEvent,
        client_event_id: clientEventId,
        rawValue,
        raw_value: rawValue,
        readerType,
        reader_type: readerType,
        deviceId,
        device_id: deviceId,
        createdAtClient: timestamp,
        created_at_client: timestamp,
        operatorSessionToken,
        operator_session_token: operatorSessionToken,
        microBatch: true,
        micro_batch: true,
        batchId,
        batch_id: batchId,
        batchSequence: index,
        batch_sequence: index,
      },
    };
  });
}

function normalizeFlagsPayload(data) {
  if (!data) return {};
  if (!Array.isArray(data) && typeof data === 'object') return data;
  if (!Array.isArray(data)) return {};
  return Object.fromEntries(data
    .filter((row) => row?.flag_name || row?.name)
    .map((row) => [row.flag_name || row.name, {
      enabled: row.enabled === true,
      rollout_scope: row.rollout_scope || {},
      updated_at: row.updated_at || null,
    }]));
}

export function clearCollectionPipelineFlagsCache() {
  flagsCache = null;
  flagsCacheExpiresAt = 0;
  flagsRequestInFlight = null;
  flagsFailure = null;
  flagsFailureExpiresAt = 0;
}

export async function getCollectionPipelineFlagsV3(options = {}) {
  const now = Date.now();
  if (!options.force && flagsCache && now < flagsCacheExpiresAt) {
    return flagsCache;
  }
  if (!options.force && flagsFailure && now < flagsFailureExpiresAt) throw flagsFailure;
  // force ignora o cache, não cria uma segunda consulta paralela da mesma flag.
  if (flagsRequestInFlight) return flagsRequestInFlight;

  if (typeof supabase.rpc !== 'function') return {};

  flagsRequestInFlight = Promise.resolve()
    .then(async () => {
      const { data, error } = await awaitCollectionTransport(
        supabase.rpc('get_collection_pipeline_flags_v3'),
        COLLECTION_FLAGS_TIMEOUT_MS,
      );
      if (error) throw wrapSupabaseError(
        error,
        'Falha ao consultar as flags do pipeline de coleta V3.',
      );
      const normalized = normalizeFlagsPayload(data);
      if (typeof normalized[V3_INGRESS_FLAG]?.enabled !== 'boolean') {
        const invalid = new Error('A configuração de ingresso da coleta não foi retornada pelo banco.');
        invalid.code = 'COLLECTION_PIPELINE_FLAGS_INVALID';
        invalid.retryable = true;
        throw invalid;
      }
      flagsCache = normalized;
      flagsCacheExpiresAt = Date.now() + COLLECTION_PIPELINE_FLAGS_CACHE_MS;
      flagsFailure = null;
      flagsFailureExpiresAt = 0;
      return normalized;
    })
    .catch((error) => {
      flagsFailure = error;
      flagsFailureExpiresAt = Date.now() + COLLECTION_FLAGS_TIMEOUT_MS;
      throw error;
    })
    .finally(() => {
      flagsRequestInFlight = null;
    });

  return flagsRequestInFlight;
}

function matchesRolloutValues(configured, candidates) {
  if (!Array.isArray(configured) || configured.length === 0) return null;
  const allowed = new Set(configured.map((value) => String(value)));
  return candidates.filter(Boolean).some((value) => allowed.has(String(value)));
}

export function isCollectionPipelineFlagEnabled(flags = {}, flagName, context = {}) {
  const flag = flags?.[flagName];
  if (flag?.enabled !== true) return false;
  const scope = flag.rollout_scope || {};
  if (scope.all === true || Object.keys(scope).length === 0) return true;

  const matches = [
    matchesRolloutValues(scope.device_ids, [context.deviceId, context.device_id]),
    matchesRolloutValues(scope.cell_ids, [context.cellId, context.cell_id]),
    matchesRolloutValues(scope.machine_ids, [context.machineId, context.machine_id]),
  ].filter((value) => value !== null);
  // Escopos desconhecidos continuam sendo avaliados no servidor; os filtros
  // reconhecidos evitam ativar o cliente fora do piloto.
  return matches.length === 0 || matches.some(Boolean);
}

export function isCollectionPipelineV3Enabled(flags = {}, context = {}) {
  return isCollectionPipelineFlagEnabled(flags, V3_INGRESS_FLAG, context);
}

function capturedAtClient(event) {
  return event.captured_at_client
    || event.capturedAtClient
    || event.created_at_client
    || event.createdAtClient
    || new Date().toISOString();
}

function buildV3Envelope(events, operatorSession) {
  const sourceMode = events.some((event) => event.source_mode === 'offline_replay')
    ? 'offline_replay'
    : 'live';
  return {
    operator_session_id: events[0]?.operator_session_id
      || events[0]?.operatorSessionId
      || operatorSession?.session_id
      || null,
    source_mode: sourceMode,
    app_version: getCollectionAppVersion(),
    events: events.map((event) => ({
      client_event_id: event.client_event_id,
      raw_value: eventRawValue(event),
      tag_lida: eventRawValue(event),
      reader_type: event.reader_type || event.readerType || 'keyboard_barcode',
      captured_at_client: capturedAtClient(event),
      device_sequence: Number(event.device_sequence ?? event.deviceSequence),
      quantity: Math.max(1, Math.floor(Number(event.quantity) || 1)),
    })),
  };
}

function isDatabaseTimestamp(value) {
  return typeof value === 'string' && value.length > 0
    && Number.isFinite(Date.parse(value));
}

function uniqueResultsById(results = []) {
  const byId = new Map();
  const duplicateIds = new Set();
  for (const result of results) {
    const id = result?.client_event_id;
    if (!id) continue;
    if (byId.has(id)) duplicateIds.add(id);
    byId.set(id, result);
  }
  duplicateIds.forEach((id) => byId.delete(id));
  return byId;
}

function normalizeV3Response(data, events, batchId, deviceId) {
  const response = Array.isArray(data)
    ? { results: data }
    : (data || {});
  const responseResults = Array.isArray(response.results)
    ? response.results
    : [];
  // Um retorno parcial, fora de ordem ou duplicado nunca pode confirmar outra
  // leitura por posição. Ausência de recibo não é uma decisão do servidor.
  const resultsById = uniqueResultsById(responseResults);
  if ((response.batch_id && response.batch_id !== batchId)
    || (response.device_id && response.device_id !== deviceId)) return [];

  return events.flatMap((event) => {
    const result = resultsById.get(event.client_event_id);
    if (!result) return [];
    const receivedAtDb = result.received_at_db || response.received_at_db || null;
    const resultState = collectionStateFromResult(result);
    const terminal = isCollectionTerminalState(resultState);
    const rejectedAtIngress = result.persisted === false;
    if (rejectedAtIngress) {
      return {
        ...result,
        client_event_id: event.client_event_id,
        batch_id: response.batch_id || batchId,
        device_id: response.device_id || deviceId,
        received_at_db: receivedAtDb,
        pipeline_version: 3,
        // A recusa ocorreu antes de existir mensagem/fato no servidor. Ela é
        // uma decisão terminal local, não uma DLQ (que pressupõe preservação
        // durável no pipeline e esgotamento/falha do worker).
        status_sincronizacao: 'sincronizada',
        collection_state: COLLECTION_STATES.REJECTED,
        accepted: false,
        retryable: false,
        transport_phase: 'finalized',
        error: result.error_code || 'COLLECTION_INGRESS_REJECTED',
        result: {
          success: false,
          status: 'error',
          reason_code: result.error_code || 'COLLECTION_INGRESS_REJECTED',
          message: 'O banco rejeitou o evento antes do enfileiramento.',
          client_event_id: event.client_event_id,
        },
        database_acknowledgement: result,
      };
    }
    if (result.persisted !== true || result.error_code
      || !isDatabaseTimestamp(receivedAtDb)) return [];
    return {
      ...result,
      client_event_id: event.client_event_id,
      batch_id: response.batch_id || batchId,
      device_id: response.device_id || deviceId,
      received_at_db: receivedAtDb,
      pipeline_version: 3,
      status_sincronizacao: terminal ? 'sincronizada' : 'recebida',
      collection_state: terminal
        ? resultState
        : COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      accepted: true,
      retryable: false,
      transport_phase: terminal ? 'finalized' : 'database_acknowledged',
      result: terminal ? (result.result ?? result.resultado ?? result) : null,
      database_acknowledgement: result,
    };
  });
}

async function publishAcknowledgements(envelopes, events, options = {}) {
  const acknowledged = envelopes.filter((item) => (
    item.transport_phase === 'database_acknowledged'
  ));
  if (acknowledged.length) await options.onAcknowledged?.(acknowledged);
  const finalized = envelopes.filter((item) => (
    item.transport_phase === 'finalized' || item.transport_phase === 'dead_lettered'
  ));
  if (finalized.length) await options.onFinalized?.(finalized);

  const confirmedIds = new Set(envelopes.map((item) => item.client_event_id));
  const missingIds = events.map((event) => event.client_event_id)
    .filter((id) => !confirmedIds.has(id));
  if (missingIds.length) {
    const error = new Error(`O banco não confirmou ${missingIds.length} leitura(s) do micro-lote; os dados locais foram preservados.`);
    error.code = 'COLLECTION_ACK_INCOMPLETE';
    error.retryable = true;
    error.acknowledgementUnknown = true;
    error.pendingClientEventIds = missingIds;
    error.acknowledgedEnvelopes = acknowledged;
    error.finalizedEnvelopes = finalized;
    throw error;
  }
  return envelopes;
}

async function ingestProductionCollectionBatchV3(events, options = {}) {
  const operatorSession = getOperatorSession();
  const batchId = options.batchId || randomUuid();
  const deviceId = events[0]?.device_id
    || events[0]?.deviceId
    || getCollectionDeviceId();
  if (events.some((event) => (
    (event.device_id || event.deviceId || deviceId) !== deviceId
  ))) {
    const error = new Error('Um micro-lote V3 não pode misturar dispositivos.');
    error.retryable = false;
    throw error;
  }

  const envelope = buildV3Envelope(events, operatorSession);
  if (!envelope.operator_session_id) {
    const error = new Error('Sessão operacional indisponível para a coleta V3.');
    error.code = 'OPERATOR_SESSION_REQUIRED';
    error.retryable = false;
    throw error;
  }
  if (envelope.events.some((event) => !Number.isSafeInteger(event.device_sequence))) {
    const error = new Error('Sequência de dispositivo inválida no micro-lote V3.');
    error.retryable = false;
    throw error;
  }

  const scope = options.pipelineFlags?.[V3_INGRESS_FLAG]?.rollout_scope || {};
  const immediate = scope.immediate_rpc === 'ingest_collection_batch_immediate_v3';
  const maxEvents = immediate
    ? Math.max(1, Math.min(5, Math.floor(Number(scope.immediate_max_events) || 5)))
    : COLLECTION_BATCH_MAX_SIZE;
  if (events.length > maxEvents) {
    const settled = [];
    for (let offset = 0; offset < events.length; offset += maxEvents) {
      try {
        settled.push(...await ingestProductionCollectionBatchV3(
          events.slice(offset, offset + maxEvents),
          { ...options, batchId: undefined },
        ));
      } catch (error) {
        // Uma falha posterior não apaga decisões que o banco já confirmou.
        error.finalizedEnvelopes = [
          ...settled.filter((item) => isCollectionTerminalState(item.collection_state)),
          ...(error.finalizedEnvelopes || []),
        ];
        error.acknowledgedEnvelopes = [
          ...settled.filter((item) => !isCollectionTerminalState(item.collection_state)),
          ...(error.acknowledgedEnvelopes || []),
        ];
        throw error;
      }
    }
    return settled;
  }

  const { data, error } = await awaitCollectionTransport(
    supabase.rpc(immediate ? 'ingest_collection_batch_immediate_v3' : 'ingest_collection_batch_v3', {
      p_batch_id: batchId,
      p_device_id: deviceId,
      p_events: envelope,
    }),
    options.requestTimeoutMs,
  );
  if (error) {
    throw wrapSupabaseError(
      error,
      'Falha ao confirmar o micro-lote de leituras no banco.',
    );
  }

  const acknowledgements = normalizeV3Response(data, events, batchId, deviceId);
  return publishAcknowledgements(acknowledgements, events, options);
}

function fallbackResult(row) {
  return {
    success: false,
    status: 'error',
    reason_code: row?.last_error_code || 'COLLECTION_INGRESS_EMPTY_RESULT',
    message: row?.erro || 'O servidor não retornou o resultado final da coleta.',
    client_event_id: row?.client_event_id,
    retryable: row?.retryable === true,
  };
}

function normalizeIngressResult(row) {
  const status = row?.status_sincronizacao || 'erro';
  const isFinal = FINAL_STATUSES.has(status);

  return {
    client_event_id: row?.client_event_id,
    pipeline_version: 2,
    status_sincronizacao: status,
    collection_state: isFinal
      ? collectionStateFromResult(row?.resultado || fallbackResult(row))
      : COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    accepted: !isFinal,
    retryable: row?.retryable === true,
    error: row?.erro || null,
    result: isFinal ? (row?.resultado || fallbackResult(row)) : null,
    transport_phase: isFinal ? 'finalized' : 'database_acknowledged',
    received_at_db: row?.server_received_at || null,
    database_acknowledgement: row,
    ingress: row,
  };
}

async function selectExistingRows(clientEventIds, timeoutMs) {
  if (!clientEventIds.length) return [];

  const { data, error } = await awaitCollectionTransport(
    supabase
      .from('coletas_producao')
      .select(INGRESS_SELECT)
      .in('client_event_id', clientEventIds),
    timeoutMs,
  );

  if (error) {
    throw wrapSupabaseError(
      error,
      'Falha ao consultar o estado final das leituras no Supabase.',
    );
  }

  return data || [];
}

async function insertRows(rows, allowDuplicateRecovery = true, timeoutMs) {
  const { data, error } = await awaitCollectionTransport(
    supabase
      .from('coletas_producao')
      .insert(rows)
      .select(INGRESS_SELECT),
    timeoutMs,
  );

  if (!error) return data || [];

  if (allowDuplicateRecovery && error.code === '23505') {
    const ids = rows.map((row) => row.client_event_id);
    const existing = await selectExistingRows(ids, timeoutMs);
    const existingIds = new Set(existing.map((row) => row.client_event_id));
    const missingRows = rows.filter((row) => !existingIds.has(row.client_event_id));

    if (!missingRows.length) return existing;

    const insertedMissing = await insertRows(missingRows, false, timeoutMs);
    return [...existing, ...insertedMissing];
  }

  throw wrapSupabaseError(
    error,
    'Falha ao persistir o micro-lote de leituras no Supabase.',
  );
}

async function waitForFinalRows(
  inputRows,
  initialRows,
  timeoutMs = COLLECTION_FINALIZATION_TIMEOUT_MS,
  onFinalized = null,
) {
  const orderedIds = inputRows.map((row) => row.client_event_id);
  const rowsById = new Map(
    (initialRows || []).map((row) => [row.client_event_id, row]),
  );
  const reportedFinalIds = new Set();
  const deadline = Date.now() + timeoutMs;
  let pollAttempt = 0;

  const publishNewFinalRows = async () => {
    if (typeof onFinalized !== 'function') return;

    const newFinalRows = orderedIds
      .map((id) => rowsById.get(id))
      .filter((row) => (
        row
        && FINAL_STATUSES.has(row.status_sincronizacao)
        && !reportedFinalIds.has(row.client_event_id)
      ));

    if (!newFinalRows.length) return;
    await onFinalized(newFinalRows.map((row) => normalizeIngressResult(row)));
    newFinalRows.forEach((row) => reportedFinalIds.add(row.client_event_id));
  };

  await publishNewFinalRows();

  while (orderedIds.some((id) => (
    !FINAL_STATUSES.has(rowsById.get(id)?.status_sincronizacao)
  ))) {
    if (Date.now() >= deadline) {
      const pendingIds = orderedIds.filter((id) => (
        !FINAL_STATUSES.has(rowsById.get(id)?.status_sincronizacao)
      ));
      const error = new Error(
        `O servidor aceitou o lote, mas ${pendingIds.length} leitura(s) `
        + 'ainda não terminaram o processamento.',
      );
      error.code = 'COLLECTION_FINALIZATION_TIMEOUT';
      error.retryable = true;
      error.pendingClientEventIds = pendingIds;
      error.finalizedEnvelopes = orderedIds
        .map((id) => rowsById.get(id))
        .filter((row) => FINAL_STATUSES.has(row?.status_sincronizacao))
        .map((row) => normalizeIngressResult(row));
      throw error;
    }

    const pollDelayMs = getCollectionFinalizationPollDelayMs(
      pollAttempt,
      orderedIds,
    );
    const remainingMs = Math.max(0, deadline - Date.now());
    await sleep(Math.min(pollDelayMs, remainingMs));
    const unresolvedIds = orderedIds.filter((id) => (
      !FINAL_STATUSES.has(rowsById.get(id)?.status_sincronizacao)
    ));
    const refreshed = await selectExistingRows(unresolvedIds, Math.max(1, deadline - Date.now()));
    for (const row of refreshed) {
      rowsById.set(row.client_event_id, row);
    }
    await publishNewFinalRows();
    pollAttempt += 1;
  }

  return orderedIds.map((id) => rowsById.get(id));
}

/**
 * Persiste de 1 a 25 leituras e libera o próximo lote no ACK durável do banco,
 * tanto no V2 quanto no V3. A decisão é resolvida por Broadcast/reconciliação.
 *
 * A captura física não aguarda esta Promise: ela já foi confirmada pela fila
 * IndexedDB. Somente ferramentas que explicitamente pedem waitForFinalization
 * usam o polling legado V2; a drenagem nunca espera o worker por leitura.
 */
export async function processProductionCollectionBatch(events = [], options = {}) {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (events.length > COLLECTION_BATCH_MAX_SIZE) {
    const error = new Error(
      `Micro-lote acima do limite de ${COLLECTION_BATCH_MAX_SIZE} leituras.`,
    );
    error.retryable = false;
    throw error;
  }

  const inputIds = new Set();
  for (const event of events) {
    if (!event?.client_event_id || inputIds.has(event.client_event_id)) {
      const error = new Error('Cada leitura deve possuir um client_event_id único e durável antes do envio.');
      error.code = 'INVALID_CLIENT_EVENT_ID';
      error.retryable = false;
      throw error;
    }
    inputIds.add(event.client_event_id);
    if ((event.event_kind || 'production_stage') !== 'production_stage') {
      const error = new Error(
        `Evento ${event.client_event_id || 'sem id'} não pertence à coleta produtiva.`,
      );
      error.retryable = false;
      throw error;
    }
    if (!eventRawValue(event)) {
      const error = new Error('Leitura vazia não pode entrar no micro-lote.');
      error.retryable = false;
      throw error;
    }
  }

  if (options.forceV2 === true && options.forceV3 === true) {
    const error = new Error('Não é permitido forçar V2 e V3 simultaneamente.');
    error.retryable = false;
    throw error;
  }

  const assignedVersion = (event) => [2, 3].includes(Number(event.pipeline_version))
    ? Number(event.pipeline_version)
    : null;
  const pinnedVersions = new Set(events.map(assignedVersion));
  if (pinnedVersions.size > 1) {
    // Preserve a ordem e as fronteiras já atribuídas, mas envie os trechos
    // contíguos em lote. Uma fila mista não deve virar N requests individuais.
    const groups = [];
    for (const event of events) {
      const previous = groups[groups.length - 1];
      if (previous && assignedVersion(previous[0]) === assignedVersion(event)) {
        previous.push(event);
      } else {
        groups.push([event]);
      }
    }
    const ordered = [];
    for (const group of groups) {
      ordered.push(...await processProductionCollectionBatch(group, options));
    }
    return ordered;
  }

  const pinnedVersion = [...pinnedVersions][0] || null;
  const forcedVersion = options.forceV3 === true
    ? 3
    : options.forceV2 === true
      ? 2
      : null;
  const firstUnforcedAssignment = pinnedVersion === null && forcedVersion === null;
  if (pinnedVersion && forcedVersion && pinnedVersion !== forcedVersion) {
    const error = new Error(
      `O micro-lote já pertence ao pipeline V${pinnedVersion}.`,
    );
    error.code = 'COLLECTION_PIPELINE_ASSIGNMENT_CONFLICT';
    error.retryable = false;
    throw error;
  }

  let targetVersion = pinnedVersion || forcedVersion;
  let flags = options.pipelineFlags;
  if (!targetVersion) {
    if (!flags) {
      try {
        flags = await getCollectionPipelineFlagsV3();
      } catch (error) {
        // Falha de rede/configuração não é evidência de que o V3 está
        // desativado. Não fixe uma captura nova no pipeline errado para sempre.
        const unavailable = new Error('Configuração da coleta indisponível; leitura preservada até a conexão retornar.');
        unavailable.code = 'COLLECTION_PIPELINE_FLAGS_UNAVAILABLE';
        unavailable.retryable = true;
        unavailable.cause = error;
        throw unavailable;
      }
    }
    targetVersion = isCollectionPipelineV3Enabled(flags, {
      deviceId: events[0]?.device_id || events[0]?.deviceId,
      cellId: events[0]?.cell_id || events[0]?.cellId,
      machineId: events[0]?.machine_id || events[0]?.machineId,
    }) ? 3 : 2;
  }

  if (typeof globalThis.indexedDB === 'undefined') {
    events.forEach((event) => { event.pipeline_version = targetVersion; });
  } else {
    await pinCollectionPipelineVersion(events, targetVersion);
  }

  if (targetVersion === 3) {
    try {
      // A versão durável do evento continua V3. A capacidade publicada pelo
      // banco escolhe a confirmação na própria requisição, inclusive no replay.
      flags ||= await getCollectionPipelineFlagsV3();
      return await ingestProductionCollectionBatchV3(events, { ...options, pipelineFlags: flags });
    } catch (error) {
      const ingressDefinitelyDisabled = error?.code === '55000'
        && String(error?.message || '').includes(
          'COLLECTION_PIPELINE_V3_INGRESS_DISABLED',
        );
      const hasConfirmedChunk = error?.finalizedEnvelopes?.length > 0
        || error?.acknowledgedEnvelopes?.length > 0;
      if (!firstUnforcedAssignment || !ingressDefinitelyDisabled || hasConfirmedChunk) throw error;

      // O flag é verificado antes de qualquer INSERT no RPC. Como esta era a
      // primeira tentativa de rede, o erro 55000 comprova ausência de recibo V3
      // e permite que a nova captura siga o V2 sem dupla escrita.
      clearCollectionPipelineFlagsCache();
      await reassignFirstCollectionPipelineAttempt(events, 3, 2);
      targetVersion = 2;
    }
  }

  const operatorSession = getOperatorSession();
  const batchId = randomUuid();
  const rows = buildIngressRows(events, batchId, operatorSession?.token || null);
  const acceptedRows = await insertRows(rows, true, options.requestTimeoutMs);
  const acceptedById = uniqueResultsById(acceptedRows);
  const confirmedRows = rows.map((row) => acceptedById.get(row.client_event_id))
    .filter((row) => row?.id && isDatabaseTimestamp(row.server_received_at)
      && ['recebida', 'processando', 'sincronizada', 'erro'].includes(row.status_sincronizacao));
  if (options.waitForFinalization === true) {
    const finalizedRows = await waitForFinalRows(
      rows,
      confirmedRows,
      COLLECTION_FINALIZATION_TIMEOUT_MS,
      options.onFinalized,
    );
    return finalizedRows.map((row) => normalizeIngressResult(row));
  }
  return publishAcknowledgements(
    confirmedRows.map((row) => normalizeIngressResult(row)),
    events,
    options,
  );
}

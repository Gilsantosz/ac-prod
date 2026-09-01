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
}

export async function getCollectionPipelineFlagsV3(options = {}) {
  const now = Date.now();
  if (!options.force && flagsCache && now < flagsCacheExpiresAt) {
    return flagsCache;
  }
  if (!options.force && flagsRequestInFlight) return flagsRequestInFlight;

  if (typeof supabase.rpc !== 'function') return {};

  flagsRequestInFlight = Promise.resolve()
    .then(async () => {
      const { data, error } = await supabase.rpc('get_collection_pipeline_flags_v3');
      if (error) throw wrapSupabaseError(
        error,
        'Falha ao consultar as flags do pipeline de coleta V3.',
      );
      const normalized = normalizeFlagsPayload(data);
      flagsCache = normalized;
      flagsCacheExpiresAt = Date.now() + COLLECTION_PIPELINE_FLAGS_CACHE_MS;
      return normalized;
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

function normalizeV3Response(data, events, batchId, deviceId) {
  const response = Array.isArray(data)
    ? { results: data }
    : (data || {});
  const responseResults = Array.isArray(response.results)
    ? response.results
    : [];
  const resultsById = new Map(responseResults
    .filter((result) => result?.client_event_id)
    .map((result) => [result.client_event_id, result]));
  const receivedAtDb = response.received_at_db || new Date().toISOString();

  return events.map((event, index) => {
    const result = resultsById.get(event.client_event_id)
      || responseResults[index]
      || {};
    const resultState = collectionStateFromResult(result);
    const terminal = isCollectionTerminalState(resultState);
    const rejectedAtIngress = result.persisted === false || Boolean(result.error_code);
    if (rejectedAtIngress) {
      return {
        ...result,
        client_event_id: event.client_event_id,
        batch_id: response.batch_id || batchId,
        device_id: response.device_id || deviceId,
        received_at_db: result.received_at_db || receivedAtDb,
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
    return {
      ...result,
      client_event_id: event.client_event_id,
      batch_id: response.batch_id || batchId,
      device_id: response.device_id || deviceId,
      received_at_db: result.received_at_db || receivedAtDb,
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

  const { data, error } = await supabase.rpc('ingest_collection_batch_v3', {
    p_batch_id: batchId,
    p_device_id: deviceId,
    p_events: envelope,
  });
  if (error) {
    throw wrapSupabaseError(
      error,
      'Falha ao confirmar o micro-lote de leituras no banco.',
    );
  }

  const acknowledgements = normalizeV3Response(data, events, batchId, deviceId);
  const databaseAcknowledgements = acknowledgements.filter((item) => (
    item.transport_phase === 'database_acknowledged'
  ));
  if (databaseAcknowledgements.length) {
    await options.onAcknowledged?.(databaseAcknowledgements);
  }
  const finalized = acknowledgements.filter((item) => (
    item.transport_phase === 'finalized'
      || item.transport_phase === 'dead_lettered'
  ));
  if (finalized.length) await options.onFinalized?.(finalized);
  return acknowledgements;
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
    status_sincronizacao: status,
    accepted: !isFinal,
    retryable: row?.retryable === true,
    error: row?.erro || null,
    result: isFinal ? (row?.resultado || fallbackResult(row)) : null,
    ingress: row,
  };
}

async function selectExistingRows(clientEventIds) {
  if (!clientEventIds.length) return [];

  const { data, error } = await supabase
    .from('coletas_producao')
    .select(INGRESS_SELECT)
    .in('client_event_id', clientEventIds);

  if (error) {
    throw wrapSupabaseError(
      error,
      'Falha ao consultar o estado final das leituras no Supabase.',
    );
  }

  return data || [];
}

async function insertRows(rows, allowDuplicateRecovery = true) {
  const { data, error } = await supabase
    .from('coletas_producao')
    .insert(rows)
    .select(INGRESS_SELECT);

  if (!error) return data || [];

  if (allowDuplicateRecovery && error.code === '23505') {
    const ids = rows.map((row) => row.client_event_id);
    const existing = await selectExistingRows(ids);
    const existingIds = new Set(existing.map((row) => row.client_event_id));
    const missingRows = rows.filter((row) => !existingIds.has(row.client_event_id));

    if (!missingRows.length) return existing;

    const insertedMissing = await insertRows(missingRows, false);
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
    const refreshed = await selectExistingRows(unresolvedIds);
    for (const row of refreshed) {
      rowsById.set(row.client_event_id, row);
    }
    await publishNewFinalRows();
    pollAttempt += 1;
  }

  return orderedIds.map((id) => rowsById.get(id));
}

/**
 * Persiste de 1 a 25 leituras. Com a flag V3 ativa, retorna no ACK do banco e
 * deixa a decisão final para Broadcast/reconciliação. Com a flag desligada,
 * mantém o fluxo V2 e seu polling legado.
 *
 * A captura física não aguarda esta Promise: ela já foi confirmada pela fila
 * IndexedDB. O polling ocorre somente no sincronizador em background, mantendo
 * o scanner livre para o próximo código.
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

  for (const event of events) {
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

  const pinnedVersions = new Set(events
    .map((event) => Number(event.pipeline_version))
    .filter((version) => version === 2 || version === 3));
  if (pinnedVersions.size > 1) {
    // Estado raro de transição/rollback: preserve a ordem e nunca combine
    // fronteiras diferentes no mesmo request.
    const ordered = [];
    for (const event of events) {
      ordered.push(...await processProductionCollectionBatch([event], options));
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
        console.warn('[CollectionBatch] Flags V3 indisponíveis; mantendo transporte V2:', error);
        flags = {};
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
      return await ingestProductionCollectionBatchV3(events, options);
    } catch (error) {
      const ingressDefinitelyDisabled = error?.code === '55000'
        && String(error?.message || '').includes(
          'COLLECTION_PIPELINE_V3_INGRESS_DISABLED',
        );
      if (!firstUnforcedAssignment || !ingressDefinitelyDisabled) throw error;

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
  const acceptedRows = await insertRows(rows);
  const finalizedRows = await waitForFinalRows(
    rows,
    acceptedRows,
    COLLECTION_FINALIZATION_TIMEOUT_MS,
    options.onFinalized,
  );

  return finalizedRows.map((row) => normalizeIngressResult(row));
}

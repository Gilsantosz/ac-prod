import { supabase } from '@/lib/supabaseClient';
import { getOperatorSession } from '@/lib/operatorSessionService';

export const COLLECTION_BATCH_SIZE = 50;
export const COLLECTION_BATCH_MAX_SIZE = 100;
export const COLLECTION_FINALIZATION_TIMEOUT_MS = 25_000;

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
    const operatorSessionToken = event.operatorSessionToken
      || event.operator_session_token
      || event.session_token
      || fallbackSessionToken
      || null;

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
        ...event,
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
) {
  const orderedIds = inputRows.map((row) => row.client_event_id);
  const rowsById = new Map(
    (initialRows || []).map((row) => [row.client_event_id, row]),
  );
  const deadline = Date.now() + timeoutMs;
  let pollDelayMs = 120;

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
      throw error;
    }

    await sleep(pollDelayMs);
    const refreshed = await selectExistingRows(orderedIds);
    for (const row of refreshed) {
      rowsById.set(row.client_event_id, row);
    }
    pollDelayMs = Math.min(1_000, Math.round(pollDelayMs * 1.6));
  }

  return orderedIds.map((id) => rowsById.get(id));
}

/**
 * Persiste de 1 a 100 leituras em um único POST e aguarda a decisão final
 * produzida pelo worker assíncrono.
 *
 * A captura física não aguarda esta Promise: ela já foi confirmada pela fila
 * IndexedDB. O polling ocorre somente no sincronizador em background, mantendo
 * o scanner livre para o próximo código.
 */
export async function processProductionCollectionBatch(events = []) {
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

  const operatorSession = getOperatorSession();
  const batchId = randomUuid();
  const rows = buildIngressRows(events, batchId, operatorSession?.token || null);
  const acceptedRows = await insertRows(rows);
  const finalizedRows = await waitForFinalRows(rows, acceptedRows);

  return finalizedRows.map((row) => normalizeIngressResult(row));
}

import { supabase } from '@/lib/supabaseClient';
import { getOperatorSession } from '@/lib/operatorSessionService';

export const COLLECTION_BATCH_SIZE = 50;
export const COLLECTION_BATCH_MAX_SIZE = 100;

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

function normalizeIngressResult(row) {
  const result = row?.resultado || {
    success: false,
    status: 'error',
    reason_code: 'COLLECTION_INGRESS_EMPTY_RESULT',
    message: row?.erro || 'O servidor não retornou o resultado da coleta.',
    client_event_id: row?.client_event_id,
  };

  return {
    client_event_id: row?.client_event_id,
    status_sincronizacao: row?.status_sincronizacao || 'erro',
    retryable: row?.retryable === true,
    error: row?.erro || null,
    result,
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
      'Falha ao consultar leituras já recebidas pelo Supabase.',
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
    'Falha ao enviar o micro-lote de leituras para o Supabase.',
  );
}

/**
 * Envia de 1 a 100 leituras em um único POST do PostgREST.
 *
 * O banco processa cada linha com a mesma RPC transacional já usada pela coleta
 * unitária. Falha de rede/transiente rejeita a Promise para que a fila local
 * recoloque o lote inteiro e tente novamente com o mesmo client_event_id.
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
  const insertedRows = await insertRows(rows);
  const byClientEventId = new Map(
    insertedRows.map((row) => [row.client_event_id, row]),
  );

  return rows.map((row) => normalizeIngressResult(
    byClientEventId.get(row.client_event_id) || {
      client_event_id: row.client_event_id,
      status_sincronizacao: 'erro',
      retryable: true,
      erro: 'O Supabase não confirmou esta leitura no retorno do micro-lote.',
      resultado: {
        success: false,
        status: 'error',
        reason_code: 'COLLECTION_INGRESS_MISSING_CONFIRMATION',
        message: 'O Supabase não confirmou esta leitura no retorno do micro-lote.',
        client_event_id: row.client_event_id,
      },
    },
  ));
}

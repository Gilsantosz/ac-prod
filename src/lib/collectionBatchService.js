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
  'attempt_count',
  'server_received_at',
  'processado_em',
  'processing_duration_ms',
  'queue_delay_ms',
  'created_at',
  'updated_at',
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
  wrapped.status = error?.status;
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
  const result = row?.resultado || null;
  return {
    client_event_id: row?.client_event_id,
    status_sincronizacao: row?.status_sincronizacao || 'recebida',
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

async function recoverCommittedRows(rows) {
  try {
    return await selectExistingRows(rows.map((row) => row.client_event_id));
  } catch {
    return [];
  }
}

async function insertRows(rows, allowRecovery = true) {
  const { data, error } = await supabase
    .from('coletas_producao')
    .insert(rows)
    .select(INGRESS_SELECT);

  if (!error) return data || [];

  if (allowRecovery) {
    const existing = await recoverCommittedRows(rows);
    const existingIds = new Set(existing.map((row) => row.client_event_id));
    const missingRows = rows.filter((row) => !existingIds.has(row.client_event_id));

    if (!missingRows.length) return existing;

    if (error.code === '23505' || existing.length > 0) {
      const insertedMissing = await insertRows(missingRows, false);
      return [...existing, ...insertedMissing];
    }
  }

  throw wrapSupabaseError(
    error,
    'Falha ao enviar o micro-lote de leituras para o Supabase.',
  );
}

/**
 * Confirma o transporte de 1 a 100 leituras em um único POST.
 *
 * Desde o release v8.7, o INSERT apenas grava o inbox e retorna rapidamente.
 * A decisão produtiva é concluída pelo worker assíncrono e reconciliada depois
 * pelo client_event_id; portanto, "recebida" não significa "aprovada".
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

  return rows.map((row) => {
    const confirmed = byClientEventId.get(row.client_event_id);
    if (confirmed) return normalizeIngressResult(confirmed);

    return {
      client_event_id: row.client_event_id,
      status_sincronizacao: 'erro',
      retryable: true,
      error: 'O Supabase não confirmou esta leitura no retorno do micro-lote.',
      result: null,
      ingress: null,
    };
  });
}

export { INGRESS_SELECT };

import { createClient } from '@supabase/supabase-js';

const SELECT_COLUMNS = [
  'id',
  'client_event_id',
  'status_sincronizacao',
  'resultado',
  'erro',
  'retryable',
  'batch_id',
  'batch_sequence',
  'processing_duration_ms',
].join(',');

function wrapError(error, fallback) {
  const wrapped = new Error(error?.message || fallback);
  wrapped.code = error?.code;
  wrapped.details = error?.details;
  wrapped.hint = error?.hint;
  return wrapped;
}

export class SupabaseBatchSink {
  constructor(config) {
    this.config = config;
    this.supabase = createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );
  }

  async authenticate() {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: this.config.edgeEmail,
      password: this.config.edgePassword,
    });

    if (error || !data?.session) {
      throw wrapError(error, 'Falha ao autenticar o coletor Edge.');
    }
  }

  #buildRows(events) {
    const batchId = crypto.randomUUID();
    return events.map((event, index) => ({
      client_event_id: event.client_event_id,
      tag_lida: event.tag_lida,
      timestamp_leitura: event.timestamp_leitura,
      status_sincronizacao: 'recebida',
      event_kind: 'production_stage',
      reader_type: event.reader_type,
      device_id: event.device_id,
      batch_id: batchId,
      batch_sequence: index,
      payload: {
        ...event.payload,
        client_event_id: event.client_event_id,
        rawValue: event.tag_lida,
        raw_value: event.tag_lida,
        readerType: event.reader_type,
        reader_type: event.reader_type,
        createdAtClient: event.timestamp_leitura,
        created_at_client: event.timestamp_leitura,
        deviceId: event.device_id,
        device_id: event.device_id,
        operatorSessionToken: this.config.operatorSessionToken,
        cellName: this.config.cellName,
        shift: this.config.shift,
        operator: this.config.operatorName,
        operatorId: this.config.operatorId,
        machineId: this.config.machineId,
        machineName: this.config.machineName,
        microBatch: true,
        micro_batch: true,
        batchId,
        batch_id: batchId,
        batchSequence: index,
        batch_sequence: index,
      },
    }));
  }

  async #selectExisting(clientEventIds) {
    const { data, error } = await this.supabase
      .from('coletas_producao')
      .select(SELECT_COLUMNS)
      .in('client_event_id', clientEventIds);

    if (error) {
      throw wrapError(
        error,
        'Falha ao consultar confirmações do micro-lote.',
      );
    }
    return data || [];
  }

  async #insertRows(rows, allowDuplicateRecovery = true) {
    const { data, error } = await this.supabase
      .from('coletas_producao')
      .insert(rows)
      .select(SELECT_COLUMNS);

    if (!error) return data || [];

    if (allowDuplicateRecovery && error.code === '23505') {
      const existing = await this.#selectExisting(
        rows.map((row) => row.client_event_id),
      );
      const existingIds = new Set(
        existing.map((row) => row.client_event_id),
      );
      const missing = rows.filter(
        (row) => !existingIds.has(row.client_event_id),
      );
      if (!missing.length) return existing;
      const insertedMissing = await this.#insertRows(missing, false);
      return [...existing, ...insertedMissing];
    }

    throw wrapError(error, 'Falha no Bulk Insert do micro-lote.');
  }

  async insertBatch(events) {
    if (!events.length) return [];

    const rows = this.#buildRows(events);
    const confirmed = await this.#insertRows(rows);
    const confirmedIds = new Set(
      confirmed.map((row) => row.client_event_id),
    );
    const missing = rows.filter(
      (row) => !confirmedIds.has(row.client_event_id),
    );

    if (missing.length) {
      const error = new Error(
        `Supabase não confirmou ${missing.length} leitura(s) do micro-lote.`,
      );
      error.code = 'MISSING_BATCH_CONFIRMATION';
      throw error;
    }

    return confirmed;
  }
}

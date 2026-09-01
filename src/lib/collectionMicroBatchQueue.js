import {
  getEventsByStatus,
  markEventError,
  markEventProcessing,
  markEventSynced,
  notifyCollectionQueueChange,
} from '@/lib/collectionEventQueue';

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

function clampBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)));
}

function envelopeError(envelope, fallbackMessage) {
  const error = new Error(
    envelope?.error
      || envelope?.result?.message
      || fallbackMessage,
  );
  error.retryable = envelope?.retryable === true;
  error.result = envelope?.result || null;
  return error;
}

async function persistFinalEnvelope(event, envelope, maxRetries) {
  const result = envelope.result ?? envelope.resultado ?? envelope;

  if (envelope.status_sincronizacao === 'erro') {
    const error = envelopeError(
      envelope,
      'A leitura foi recebida, mas não pôde ser processada.',
    );
    await markEventError(event.client_event_id, error, maxRetries, {
      notify: false,
    });
    return { result, error, synced: false };
  }

  await markEventSynced(event.client_event_id, result, { notify: false });
  return { result, error: null, synced: true };
}

/**
 * Escoa a fila IndexedDB em micro-lotes, preservando FIFO e client_event_id.
 *
 * Falha de transporte: todo o lote volta para pending com backoff.
 * Falha funcional individual: somente o evento correspondente vai para error.
 * Resultado processado (aprovado, bloqueado ou inválido): marca synced, pois o
 * transporte foi concluído e a decisão canônica já está no PostgreSQL.
 */
export async function flushCollectionMicroBatchQueue(processBatchFn, opts = {}) {
  if (typeof processBatchFn !== 'function') {
    throw new TypeError('processBatchFn deve ser uma função.');
  }

  const {
    batchSize = DEFAULT_BATCH_SIZE,
    maxRetries = 8,
    onProgress,
    onResult,
  } = opts;
  const safeBatchSize = clampBatchSize(batchSize);
  const now = Date.now();
  const pending = (await getEventsByStatus('pending'))
    .filter((event) => (
      !event.next_attempt_at
      || new Date(event.next_attempt_at).getTime() <= now
    ))
    .sort((left, right) => (
      left.created_at_client.localeCompare(right.created_at_client)
    ));

  let processed = 0;
  let synced = 0;
  let errors = 0;

  for (let offset = 0; offset < pending.length; offset += safeBatchSize) {
    const batch = pending.slice(offset, offset + safeBatchSize);
    const eventsById = new Map(
      batch.map((event) => [event.client_event_id, event]),
    );
    const persistedFinalIds = new Set();
    const persistedFinalEnvelopes = new Map();

    for (const event of batch) {
      await markEventProcessing(event.client_event_id, { notify: false });
    }
    notifyCollectionQueueChange();

    const persistProgress = async (finalizedEnvelopes = []) => {
      let changed = false;
      for (const envelope of finalizedEnvelopes) {
        const event = eventsById.get(envelope?.client_event_id);
        if (!event || persistedFinalIds.has(event.client_event_id)) continue;
        await persistFinalEnvelope(event, envelope, maxRetries);
        persistedFinalIds.add(event.client_event_id);
        persistedFinalEnvelopes.set(event.client_event_id, envelope);
        changed = true;
      }
      if (changed) notifyCollectionQueueChange();
    };

    let envelopes;
    try {
      envelopes = await processBatchFn(batch, {
        onFinalized: persistProgress,
      });
      if (!Array.isArray(envelopes)) {
        const invalidResponse = new Error(
          'O processador do micro-lote retornou um formato inválido.',
        );
        invalidResponse.retryable = true;
        throw invalidResponse;
      }
    } catch (transportError) {
      transportError.retryable = transportError?.retryable !== false;
      const finalizedById = new Map(persistedFinalEnvelopes);
      for (const envelope of transportError?.finalizedEnvelopes || []) {
        finalizedById.set(envelope.client_event_id, envelope);
      }

      for (let index = 0; index < batch.length; index += 1) {
        const event = batch[index];
        const finalizedEnvelope = finalizedById.get(event.client_event_id);

        if (finalizedEnvelope) {
          const settled = persistedFinalIds.has(event.client_event_id)
            ? {
              result: finalizedEnvelope.result
                ?? finalizedEnvelope.resultado
                ?? finalizedEnvelope,
              error: finalizedEnvelope.status_sincronizacao === 'erro'
                ? envelopeError(
                  finalizedEnvelope,
                  'A leitura foi recebida, mas não pôde ser processada.',
                )
                : null,
              synced: finalizedEnvelope.status_sincronizacao !== 'erro',
            }
            : await persistFinalEnvelope(event, finalizedEnvelope, maxRetries);

          processed += 1;
          if (settled.synced) synced += 1;
          else errors += 1;
          onResult?.({
            event,
            result: settled.result,
            error: settled.error,
            batchIndex: index,
            batchCount: batch.length,
          });
          onProgress?.({
            processed,
            synced,
            errors,
            current: event.client_event_id,
          });
          continue;
        }

        await markEventError(
          event.client_event_id,
          transportError,
          maxRetries,
          { notify: false },
        );
        processed += 1;
        errors += 1;
        onResult?.({
          event,
          result: transportError?.result || null,
          error: transportError,
          batchIndex: index,
          batchCount: batch.length,
        });
        onProgress?.({
          processed,
          synced,
          errors,
          current: event.client_event_id,
        });
      }
      notifyCollectionQueueChange();
      continue;
    }

    const byClientEventId = new Map(
      envelopes.map((envelope) => [envelope.client_event_id, envelope]),
    );

    for (let index = 0; index < batch.length; index += 1) {
      const event = batch[index];
      const envelope = byClientEventId.get(event.client_event_id);

      if (!envelope) {
        const missing = new Error(
          'O Supabase não confirmou esta leitura no retorno do micro-lote.',
        );
        missing.retryable = true;
        await markEventError(event.client_event_id, missing, maxRetries, {
          notify: false,
        });
        processed += 1;
        errors += 1;
        onResult?.({
          event,
          result: null,
          error: missing,
          batchIndex: index,
          batchCount: batch.length,
        });
        onProgress?.({
          processed,
          synced,
          errors,
          current: event.client_event_id,
        });
        continue;
      }

      const settled = persistedFinalIds.has(event.client_event_id)
        ? {
          result: envelope.result ?? envelope.resultado ?? envelope,
          error: envelope.status_sincronizacao === 'erro'
            ? envelopeError(
              envelope,
              'A leitura foi recebida, mas não pôde ser processada.',
            )
            : null,
          synced: envelope.status_sincronizacao !== 'erro',
        }
        : await persistFinalEnvelope(event, envelope, maxRetries);

      if (!settled.synced) {
        processed += 1;
        errors += 1;
        onResult?.({
          event,
          result: settled.result,
          error: settled.error,
          batchIndex: index,
          batchCount: batch.length,
        });
      } else {
        processed += 1;
        synced += 1;
        onResult?.({
          event,
          result: settled.result,
          error: null,
          batchIndex: index,
          batchCount: batch.length,
        });
      }

      onProgress?.({
        processed,
        synced,
        errors,
        current: event.client_event_id,
      });
    }
    notifyCollectionQueueChange();
  }

  return {
    processed,
    synced,
    errors,
    batches: Math.ceil(pending.length / safeBatchSize),
  };
}

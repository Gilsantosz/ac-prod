import {
  getEventsByStatus,
  markEventDatabaseAcknowledged,
  markEventError,
  markEventFinalized,
  markEventProcessing,
  notifyCollectionQueueChange,
} from '@/lib/collectionEventQueue';
import {
  COLLECTION_STATES,
  collectionStateFromResult,
  isCollectionTerminalState,
} from '@/lib/collectionStateMachine';

export const COLLECTION_MICRO_BATCH_DEFAULT_SIZE = 25;
export const COLLECTION_MICRO_BATCH_MAX_SIZE = 25;
export const COLLECTION_MICRO_BATCH_MAX_BATCHES_PER_FLUSH = 5;
export const COLLECTION_LIVE_TO_REPLAY_RATIO = 4;

const DEFAULT_BATCH_SIZE = COLLECTION_MICRO_BATCH_DEFAULT_SIZE;
const MAX_BATCH_SIZE = COLLECTION_MICRO_BATCH_MAX_SIZE;

function clampBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)));
}

function eventSourceMode(event) {
  return event.source_mode === 'offline_replay' || event.queued_offline === true
    ? 'offline_replay'
    : 'live';
}

/** Seleciona uma fatia limitada com prioridade live:replay de 4:1. */
export function planCollectionMicroBatches(events, batchSize = 25, options = {}) {
  const safeBatchSize = clampBatchSize(batchSize);
  const maxBatches = Math.max(1, Math.min(
    COLLECTION_MICRO_BATCH_MAX_BATCHES_PER_FLUSH,
    Number(options.maxBatches) || COLLECTION_MICRO_BATCH_MAX_BATCHES_PER_FLUSH,
  ));
  const live = events.filter((event) => eventSourceMode(event) === 'live');
  const replay = events.filter((event) => eventSourceMode(event) === 'offline_replay');
  const batches = [];

  for (let slot = 0; slot < maxBatches; slot += 1) {
    const replaySlot = slot % (COLLECTION_LIVE_TO_REPLAY_RATIO + 1)
      === COLLECTION_LIVE_TO_REPLAY_RATIO;
    const preferred = replaySlot ? replay : live;
    const fallback = replaySlot ? live : replay;
    const source = preferred.length ? preferred : fallback;
    if (!source.length) break;
    batches.push(source.splice(0, safeBatchSize));
  }

  return batches;
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
    return { result, error, synced: false, acknowledged: false };
  }

  const state = collectionStateFromResult(envelope)
    || collectionStateFromResult(result);
  if (!isCollectionTerminalState(state)) {
    await markEventDatabaseAcknowledged(
      event.client_event_id,
      envelope,
      { notify: false },
    );
    return {
      result: envelope,
      error: null,
      synced: false,
      acknowledged: true,
    };
  }

  await markEventFinalized(event.client_event_id, envelope, { notify: false });
  return { result, error: null, synced: true, acknowledged: false };
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
    maxBatches = COLLECTION_MICRO_BATCH_MAX_BATCHES_PER_FLUSH,
    eventKind = null,
    onProgress,
    onResult,
  } = opts;
  const safeBatchSize = clampBatchSize(batchSize);
  const now = Date.now();
  const pending = (await getEventsByStatus('pending'))
    .filter((event) => (
      (!eventKind || event.event_kind === eventKind)
      && (!event.next_attempt_at
        || new Date(event.next_attempt_at).getTime() <= now)
    ))
    .sort((left, right) => (
      left.created_at_client.localeCompare(right.created_at_client)
    ));

  const batches = planCollectionMicroBatches(pending, safeBatchSize, {
    maxBatches,
  });
  let processed = 0;
  let acknowledged = 0;
  let synced = 0;
  let errors = 0;

  for (const batch of batches) {
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
        const settled = await persistFinalEnvelope(event, envelope, maxRetries);
        persistedFinalIds.add(event.client_event_id);
        persistedFinalEnvelopes.set(event.client_event_id, { envelope, settled });
        changed = true;
      }
      if (changed) notifyCollectionQueueChange();
    };

    let envelopes;
    try {
      envelopes = await processBatchFn(batch, {
        onAcknowledged: persistProgress,
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
        finalizedById.set(envelope.client_event_id, { envelope, settled: null });
      }

      for (let index = 0; index < batch.length; index += 1) {
        const event = batch[index];
        const persisted = finalizedById.get(event.client_event_id);
        const finalizedEnvelope = persisted?.envelope;

        if (finalizedEnvelope) {
          const settled = persisted?.settled
            || await persistFinalEnvelope(event, finalizedEnvelope, maxRetries);

          processed += 1;
          if (settled.synced) synced += 1;
          else if (settled.acknowledged) acknowledged += 1;
          else errors += 1;
          onResult?.({
            event,
            result: settled.result,
            error: settled.error,
            acknowledged: settled.acknowledged,
            state: collectionStateFromResult(finalizedEnvelope),
            batchIndex: index,
            batchCount: batch.length,
          });
          onProgress?.({
            processed,
            acknowledged,
            synced,
            errors,
            current: event.client_event_id,
          });
          continue;
        }

        const persistedEvent = await markEventError(
          event.client_event_id,
          transportError,
          maxRetries,
          { notify: false },
        );
        const preservedState = collectionStateFromResult(persistedEvent);
        const serverAccepted = preservedState === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
          || preservedState === COLLECTION_STATES.PROCESSING;
        processed += 1;
        if (serverAccepted) acknowledged += 1;
        else errors += 1;
        onResult?.({
          event,
          result: serverAccepted
            ? (persistedEvent.database_acknowledgement || persistedEvent)
            : (transportError?.result || null),
          error: serverAccepted ? null : transportError,
          acknowledged: serverAccepted,
          state: serverAccepted ? preservedState : COLLECTION_STATES.RETRYING,
          batchIndex: index,
          batchCount: batch.length,
        });
        onProgress?.({
          processed,
          acknowledged,
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
        const persistedEvent = await markEventError(event.client_event_id, missing, maxRetries, {
          notify: false,
        });
        const preservedState = collectionStateFromResult(persistedEvent);
        const serverAccepted = preservedState === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
          || preservedState === COLLECTION_STATES.PROCESSING;
        processed += 1;
        if (serverAccepted) acknowledged += 1;
        else errors += 1;
        onResult?.({
          event,
          result: serverAccepted ? persistedEvent : null,
          error: serverAccepted ? null : missing,
          acknowledged: serverAccepted,
          state: serverAccepted ? preservedState : COLLECTION_STATES.RETRYING,
          batchIndex: index,
          batchCount: batch.length,
        });
        onProgress?.({
          processed,
          acknowledged,
          synced,
          errors,
          current: event.client_event_id,
        });
        continue;
      }

      const settled = persistedFinalIds.has(event.client_event_id)
        ? persistedFinalEnvelopes.get(event.client_event_id).settled
        : await persistFinalEnvelope(event, envelope, maxRetries);

      if (settled.acknowledged) {
        processed += 1;
        acknowledged += 1;
        onResult?.({
          event,
          result: settled.result,
          error: null,
          acknowledged: true,
          state: collectionStateFromResult(envelope)
            || COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
          batchIndex: index,
          batchCount: batch.length,
        });
      } else if (!settled.synced) {
        processed += 1;
        errors += 1;
        onResult?.({
          event,
          result: settled.result,
          error: settled.error,
          acknowledged: false,
          state: collectionStateFromResult(envelope)
            || COLLECTION_STATES.DEAD_LETTERED,
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
          acknowledged: false,
          state: collectionStateFromResult(envelope),
          batchIndex: index,
          batchCount: batch.length,
        });
      }

      onProgress?.({
        processed,
        acknowledged,
        synced,
        errors,
        current: event.client_event_id,
      });
    }
    notifyCollectionQueueChange();
  }

  return {
    processed,
    acknowledged,
    synced,
    errors,
    batches: batches.length,
    remaining: Math.max(0, pending.length - batches.flat().length),
  };
}

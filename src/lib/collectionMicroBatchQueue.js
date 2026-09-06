import {
  claimCollectionEventsForTransport,
  getCollectionEvent,
  getPendingCollectionEvents,
  markEventDatabaseAcknowledged,
  markEventError,
  markEventFinalized,
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

function batchBoundary(event) {
  return JSON.stringify([
    eventSourceMode(event),
    event.device_id || event.deviceId || null,
    event.operator_session_id || event.operatorSessionId || null,
    event.operator_id || event.operatorId || null,
    event.cell_id || event.cellId || event.cell_name || event.cellName || null,
    event.machine_id || event.machineId || null,
    Number(event.pipeline_version) || null,
    event.event_kind || 'production_stage',
  ]);
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
    // One ingress envelope has exactly one operator session and device. Never
    // attribute old/offline events to another session or switch a pinned V2/V3.
    const boundary = batchBoundary(source[0]);
    const batch = [];
    while (batch.length < safeBatchSize && source.length
      && batchBoundary(source[0]) === boundary) {
      batch.push(source.shift());
    }
    batches.push(batch);
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

function persistedTerminalOutcome(event) {
  if (!event || !isCollectionTerminalState(event.collection_state)) return null;
  const failed = event.collection_state === COLLECTION_STATES.DEAD_LETTERED;
  return {
    state: event.collection_state,
    result: event.result || event.last_result || event,
    error: failed ? new Error(event.last_error || 'Evento enviado para dead letter.') : null,
    synced: !failed,
    acknowledged: false,
  };
}

async function authoritativeOutcome(clientEventId, settled) {
  return persistedTerminalOutcome(await getCollectionEvent(clientEventId)) || settled;
}

async function persistFinalEnvelope(event, envelope, maxRetries) {
  const result = envelope.result ?? envelope.resultado ?? envelope;

  if (envelope.status_sincronizacao === 'erro') {
    const error = envelopeError(
      envelope,
      'A leitura foi recebida, mas não pôde ser processada.',
    );
    const stored = await markEventError(event.client_event_id, error, maxRetries, {
      notify: false,
    });
    const persistedTerminal = persistedTerminalOutcome(stored);
    if (persistedTerminal) return persistedTerminal;
    return { result, error, synced: false, acknowledged: false, state: stored?.collection_state };
  }

  const state = collectionStateFromResult(envelope)
    || collectionStateFromResult(result);
  if (!isCollectionTerminalState(state)) {
    const stored = await markEventDatabaseAcknowledged(
      event.client_event_id,
      envelope,
      { notify: false },
    );
    const persistedTerminal = persistedTerminalOutcome(stored);
    if (persistedTerminal) return persistedTerminal;
    return {
      state: stored?.collection_state || COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      result: envelope,
      error: null,
      synced: false,
      acknowledged: true,
    };
  }

  const stored = await markEventFinalized(event.client_event_id, envelope, { notify: false });
  return persistedTerminalOutcome(stored)
    || { result: stored?.result ?? result, error: null, synced: true, acknowledged: false, state };
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
  const pending = await getPendingCollectionEvents({
    eventKind,
    limit: safeBatchSize * COLLECTION_MICRO_BATCH_MAX_BATCHES_PER_FLUSH + 1,
  });

  const batches = planCollectionMicroBatches(pending, safeBatchSize, {
    maxBatches,
  });
  let processed = 0;
  let acknowledged = 0;
  let synced = 0;
  let errors = 0;

  for (const plannedBatch of batches) {
    // One atomic IDB transaction for the whole claim; other tabs can no longer
    // claim a stale snapshot or overwrite a Broadcast that finalized first.
    const batch = await claimCollectionEventsForTransport(plannedBatch);
    if (!batch.length) continue;
    const eventsById = new Map(
      batch.map((event) => [event.client_event_id, event]),
    );
    const persistedFinalIds = new Set();
    const persistedFinalEnvelopes = new Map();

    notifyCollectionQueueChange();

    const persistProgress = async (finalizedEnvelopes = []) => {
      let changed = false;
      for (const envelope of finalizedEnvelopes) {
        const event = eventsById.get(envelope?.client_event_id);
        if (!event || persistedFinalEnvelopes.get(event.client_event_id)?.settled.synced) continue;
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
          const settled = await authoritativeOutcome(event.client_event_id, persisted?.settled
            || await persistFinalEnvelope(event, finalizedEnvelope, maxRetries));

          processed += 1;
          if (settled.synced) synced += 1;
          else if (settled.acknowledged) acknowledged += 1;
          else errors += 1;
          onResult?.({
            event,
            result: settled.result,
            error: settled.error,
            acknowledged: settled.acknowledged,
            state: settled.state || collectionStateFromResult(settled.result || {}) || collectionStateFromResult(finalizedEnvelope),
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
        const terminal = isCollectionTerminalState(preservedState)
          && preservedState !== COLLECTION_STATES.DEAD_LETTERED;
        const serverAccepted = terminal || preservedState === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
          || preservedState === COLLECTION_STATES.PROCESSING;
        processed += 1;
        if (terminal) synced += 1;
        else if (serverAccepted) acknowledged += 1;
        else errors += 1;
        onResult?.({
          event,
          result: serverAccepted
            ? (persistedEvent.result || persistedEvent.database_acknowledgement || persistedEvent)
            : (transportError?.result || null),
          error: serverAccepted ? null : transportError,
          acknowledged: serverAccepted && !terminal,
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
        const terminal = isCollectionTerminalState(preservedState)
          && preservedState !== COLLECTION_STATES.DEAD_LETTERED;
        const serverAccepted = terminal || preservedState === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
          || preservedState === COLLECTION_STATES.PROCESSING;
        processed += 1;
        if (terminal) synced += 1;
        else if (serverAccepted) acknowledged += 1;
        else errors += 1;
        onResult?.({
          event,
          result: serverAccepted ? (persistedEvent.result || persistedEvent) : null,
          error: serverAccepted ? null : missing,
          acknowledged: serverAccepted && !terminal,
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

      const storedEnvelope = persistedFinalEnvelopes.get(event.client_event_id);
      const isFinalResponse = isCollectionTerminalState(collectionStateFromResult(envelope))
        || envelope.status_sincronizacao === 'erro';
      const candidateOutcome = persistedFinalIds.has(event.client_event_id)
        && (storedEnvelope.settled.synced || !isFinalResponse)
        ? persistedFinalEnvelopes.get(event.client_event_id).settled
        : await persistFinalEnvelope(event, envelope, maxRetries);
      const settled = await authoritativeOutcome(event.client_event_id, candidateOutcome);

      if (settled.acknowledged) {
        processed += 1;
        acknowledged += 1;
        onResult?.({
          event,
          result: settled.result,
          error: null,
          acknowledged: true,
          state: settled.state || collectionStateFromResult(envelope)
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
          state: settled.state || collectionStateFromResult(envelope)
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
          state: settled.state || collectionStateFromResult(settled.result || {}) || collectionStateFromResult(envelope),
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

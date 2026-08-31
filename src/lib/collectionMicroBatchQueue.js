import {
  getEventsByStatus,
  markEventsAccepted,
  markEventsError,
  markEventsProcessing,
  markEventsSynced,
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

function progress(onProgress, state, event) {
  onProgress?.({ ...state, current: event.client_event_id });
}

/**
 * Escoa a fila IndexedDB em micro-lotes sem confundir ACK de transporte com
 * decisão produtiva. As transições locais são gravadas em uma única transação
 * por lote, evitando dezenas de writes/re-renders durante uma rajada de scanner.
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
    onAccepted,
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

  const state = {
    processed: 0,
    accepted: 0,
    synced: 0,
    errors: 0,
  };

  for (let offset = 0; offset < pending.length; offset += safeBatchSize) {
    const batch = pending.slice(offset, offset + safeBatchSize);
    await markEventsProcessing(batch);

    let envelopes;
    try {
      envelopes = await processBatchFn(batch);
      if (!Array.isArray(envelopes)) {
        const invalidResponse = new Error(
          'O processador do micro-lote retornou um formato inválido.',
        );
        invalidResponse.retryable = true;
        throw invalidResponse;
      }
    } catch (transportError) {
      transportError.retryable = transportError?.retryable !== false;
      await markEventsError(
        batch.map((event) => ({ event, error: transportError })),
        maxRetries,
      );

      batch.forEach((event, index) => {
        state.processed += 1;
        state.errors += 1;
        onResult?.({
          event,
          result: transportError?.result || null,
          error: transportError,
          batchIndex: index,
          batchCount: batch.length,
          source: 'transport',
        });
        progress(onProgress, state, event);
      });
      continue;
    }

    const byClientEventId = new Map(
      envelopes.map((envelope) => [envelope.client_event_id, envelope]),
    );
    const acceptedTransitions = [];
    const syncedTransitions = [];
    const errorTransitions = [];
    const callbacks = [];

    batch.forEach((event, index) => {
      const envelope = byClientEventId.get(event.client_event_id);

      if (!envelope) {
        const error = new Error(
          'O Supabase não confirmou esta leitura no retorno do micro-lote.',
        );
        error.retryable = true;
        errorTransitions.push({ event, error });
        callbacks.push({
          kind: 'error',
          event,
          result: null,
          error,
          batchIndex: index,
          source: 'transport',
        });
        return;
      }

      const result = envelope.result ?? envelope.resultado ?? null;
      const serverStatus = envelope.status_sincronizacao;

      if (serverStatus === 'erro') {
        const error = envelopeError(
          envelope,
          'A leitura foi recebida, mas não pôde ser processada.',
        );
        errorTransitions.push({ event, error });
        callbacks.push({
          kind: 'error',
          event,
          result,
          error,
          batchIndex: index,
          source: 'server-final',
          ingress: envelope.ingress,
        });
      } else if (serverStatus === 'sincronizada') {
        syncedTransitions.push({ event, result, ingress: envelope.ingress });
        callbacks.push({
          kind: 'synced',
          event,
          result,
          error: null,
          batchIndex: index,
          source: 'server-final',
          ingress: envelope.ingress,
        });
      } else if (['recebida', 'processando'].includes(serverStatus)) {
        const ingress = envelope.ingress || {
          client_event_id: event.client_event_id,
          status_sincronizacao: serverStatus,
        };
        acceptedTransitions.push({ event, ingress });
        callbacks.push({
          kind: 'accepted',
          event,
          envelope,
          batchIndex: index,
        });
      } else {
        const error = new Error(
          `Status de confirmação desconhecido: ${serverStatus || '(vazio)'}.`,
        );
        error.retryable = true;
        errorTransitions.push({ event, error });
        callbacks.push({
          kind: 'error',
          event,
          result,
          error,
          batchIndex: index,
          source: 'transport',
        });
      }
    });

    await Promise.all([
      markEventsAccepted(acceptedTransitions),
      markEventsSynced(syncedTransitions),
      markEventsError(errorTransitions, maxRetries),
    ]);

    callbacks.forEach((callback) => {
      state.processed += 1;
      if (callback.kind === 'accepted') {
        state.accepted += 1;
        onAccepted?.({
          event: callback.event,
          envelope: callback.envelope,
          batchIndex: callback.batchIndex,
          batchCount: batch.length,
        });
      } else if (callback.kind === 'synced') {
        state.synced += 1;
        onResult?.({
          event: callback.event,
          result: callback.result,
          error: null,
          batchIndex: callback.batchIndex,
          batchCount: batch.length,
          source: callback.source,
          ingress: callback.ingress,
        });
      } else {
        state.errors += 1;
        onResult?.({
          event: callback.event,
          result: callback.result,
          error: callback.error,
          batchIndex: callback.batchIndex,
          batchCount: batch.length,
          source: callback.source,
          ingress: callback.ingress,
        });
      }
      progress(onProgress, state, callback.event);
    });
  }

  return {
    ...state,
    batches: Math.ceil(pending.length / safeBatchSize),
  };
}

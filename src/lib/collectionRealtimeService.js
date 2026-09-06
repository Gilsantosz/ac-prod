import { supabase } from '@/lib/supabaseClient';
import {
  getCollectionEvent,
  getUnresolvedCollectionEvents,
  markEventDatabaseAcknowledged,
  markEventDeadLettered,
  markEventFinalized,
  markEventServerProcessing,
} from '@/lib/collectionEventQueue';
import {
  COLLECTION_STATES,
  collectionStateFromResult,
} from '@/lib/collectionStateMachine';

export const COLLECTION_BROADCAST_EVENTS = Object.freeze([
  'collection.received',
  'collection.processing',
  'collection.finalized',
  'collection.projection_delta',
  'collection.dead_lettered',
]);

function cleanChannelPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function unwrapCollectionBroadcast(message, eventName = null) {
  const payload = message?.payload?.payload
    || message?.payload
    || message
    || {};
  return {
    ...payload,
    broadcast_event: eventName || payload.broadcast_event || payload.event || null,
  };
}

/**
 * Abre exatamente um canal privado do dispositivo e, quando disponível, um da
 * célula. Todos os eventos são multiplexados nesses dois canais.
 */
export function subscribeToCollectionBroadcastV3({
  deviceId,
  cellId = null,
  onMessage,
  onStatus,
}) {
  if (!deviceId || typeof supabase.channel !== 'function') return null;
  const specs = [
    `collection:device:${cleanChannelPart(deviceId)}`,
  ];
  if (cellId) specs.push(`collection:cell:${cleanChannelPart(cellId)}`);

  const channels = specs.map((channelName) => {
    let channel = supabase.channel(channelName, {
      config: { private: true, broadcast: { self: false, ack: false } },
    });
    for (const eventName of COLLECTION_BROADCAST_EVENTS) {
      channel = channel.on(
        'broadcast',
        { event: eventName },
        (message) => onMessage?.(unwrapCollectionBroadcast(message, eventName)),
      );
    }
    channel.subscribe((status) => onStatus?.(status, channelName));
    return channel;
  });

  return { channels };
}

export async function unsubscribeFromCollectionBroadcastV3(subscription) {
  const channels = subscription?.channels || [];
  await Promise.all(channels.map((channel) => (
    supabase.removeChannel?.(channel) || Promise.resolve()
  )));
}

export async function persistCollectionBroadcastMessage(payload = {}) {
  const eventName = payload.broadcast_event || payload.event;
  const clientEventId = payload.client_event_id
    || payload.result?.client_event_id
    || null;
  if (!clientEventId) {
    return { event: null, state: null, payload };
  }

  if (eventName === 'collection.projection_delta') {
    if (payload.projection_kind !== 'correction') {
      return { event: null, state: null, payload };
    }
    const state = collectionStateFromResult(payload);
    if (!state) return { event: null, state: null, payload };
    const event = await markEventFinalized(clientEventId, {
      ...payload,
      collection_state: state,
    }, { force: true });
    return { event, state, payload };
  }

  if (eventName === 'collection.received') {
    const event = await markEventDatabaseAcknowledged(clientEventId, payload);
    return { event, state: collectionStateFromResult(event || {}) || COLLECTION_STATES.DATABASE_ACKNOWLEDGED, payload };
  }
  if (eventName === 'collection.processing') {
    const existing = await getCollectionEvent(clientEventId);
    if (existing?.collection_state === COLLECTION_STATES.PENDING_DATABASE) {
      await markEventDatabaseAcknowledged(clientEventId, payload, { notify: false });
    }
    const event = await markEventServerProcessing(clientEventId, payload);
    return { event, state: collectionStateFromResult(event || {}) || COLLECTION_STATES.PROCESSING, payload };
  }
  if (eventName === 'collection.dead_lettered') {
    const event = await markEventDeadLettered(clientEventId, payload);
    return { event, state: collectionStateFromResult(event || {}) || COLLECTION_STATES.DEAD_LETTERED, payload };
  }

  const state = collectionStateFromResult(payload)
    || collectionStateFromResult(payload.result);
  const event = await markEventFinalized(clientEventId, {
    ...payload,
    collection_state: state,
  });
  return { event, state: collectionStateFromResult(event || {}) || state, payload };
}

const RECONCILIATION_SELECT = [
  'client_event_id',
  'status_sincronizacao',
  'resultado',
  'erro',
  'retryable',
  'batch_id',
  'received_at_db',
  'server_received_at',
  'processado_em',
  'last_error_code',
  'pipeline_version',
].join(',');

export const COLLECTION_RECONCILIATION_TIMEOUT_MS = 10_000;

async function readReceiptsWithDeadline(ids, timeoutMs) {
  const controller = new AbortController();
  const query = supabase.from('coletas_producao').select(RECONCILIATION_SELECT)
    .in('client_event_id', ids);
  const request = typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error('Tempo limite ao reconciliar recibos de coleta.'), {
        code: 'COLLECTION_RECONCILIATION_TIMEOUT', retryable: true,
      });
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded catch-up independent of ingress and WebSocket delivery. Pages rotate
 * past missing receipts, with exact V2/V3 assignment checked before any write.
 * `hasMore` describes the scanned page, even if all its server rows are missing.
 */
export async function reconcileCollectionEventsV3(options = {}) {
  const unresolved = await getUnresolvedCollectionEvents({
    eventKind: options.eventKind || 'production_stage',
    limit: Math.min(100, Number(options.limit) || 100),
    olderThanMs: options.olderThanMs || 0,
  });
  const updates = [];
  Object.defineProperty(updates, 'hasMore', { value: unresolved.hasMore === true });
  if (!unresolved.length) return updates;

  const expectedPipeline = new Map(unresolved.map((event) => (
    [event.client_event_id, Number(event.pipeline_version)]
  )));
  const ids = unresolved.map((event) => event.client_event_id);
  const timeoutMs = Math.max(250, Math.min(COLLECTION_RECONCILIATION_TIMEOUT_MS,
    Number(options.timeoutMs) || COLLECTION_RECONCILIATION_TIMEOUT_MS));
  const { data, error } = await readReceiptsWithDeadline(ids, timeoutMs);
  if (error) throw error;

  for (const row of data || []) {
    if (Number(row.pipeline_version) !== expectedPipeline.get(row.client_event_id)) continue;
    let broadcastEvent = 'collection.received';
    if (row.status_sincronizacao === 'processando') {
      broadcastEvent = 'collection.processing';
    } else if (row.status_sincronizacao === 'sincronizada') {
      broadcastEvent = 'collection.finalized';
    } else if (row.status_sincronizacao === 'erro') {
      broadcastEvent = row.retryable === true
        ? 'collection.processing'
        : 'collection.dead_lettered';
    }
    const payload = {
      ...row,
      ...(row.resultado || {}),
      client_event_id: row.client_event_id,
      pipeline_version: row.pipeline_version,
      result: row.resultado || null,
      broadcast_event: broadcastEvent,
    };
    updates.push(await persistCollectionBroadcastMessage(payload));
  }
  return updates;
}

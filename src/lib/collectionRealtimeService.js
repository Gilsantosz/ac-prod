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
    return { event, state: COLLECTION_STATES.DATABASE_ACKNOWLEDGED, payload };
  }
  if (eventName === 'collection.processing') {
    const existing = await getCollectionEvent(clientEventId);
    if (existing?.collection_state === COLLECTION_STATES.PENDING_DATABASE) {
      await markEventDatabaseAcknowledged(clientEventId, payload, { notify: false });
    }
    const event = await markEventServerProcessing(clientEventId, payload);
    return { event, state: COLLECTION_STATES.PROCESSING, payload };
  }
  if (eventName === 'collection.dead_lettered') {
    const event = await markEventDeadLettered(clientEventId, payload);
    return { event, state: COLLECTION_STATES.DEAD_LETTERED, payload };
  }

  const state = collectionStateFromResult(payload)
    || collectionStateFromResult(payload.result);
  const event = await markEventFinalized(clientEventId, {
    ...payload,
    collection_state: state,
  });
  return { event, state, payload };
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
].join(',');

/**
 * Reconciliação leve por um único IN de no máximo 25 IDs ainda abertos.
 * O chamador decide o limiar de idade conforme a saúde do WebSocket.
 */
export async function reconcileCollectionEventsV3(options = {}) {
  const unresolved = await getUnresolvedCollectionEvents({
    eventKind: options.eventKind || 'production_stage',
    limit: Math.min(25, Number(options.limit) || 25),
    olderThanMs: options.olderThanMs || 0,
  });
  if (!unresolved.length) return [];

  const ids = unresolved.map((event) => event.client_event_id);
  const { data, error } = await supabase
    .from('coletas_producao')
    .select(RECONCILIATION_SELECT)
    .in('client_event_id', ids);
  if (error) throw error;

  const updates = [];
  for (const row of data || []) {
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
      result: row.resultado || null,
      broadcast_event: broadcastEvent,
    };
    updates.push(await persistCollectionBroadcastMessage(payload));
  }
  return updates;
}

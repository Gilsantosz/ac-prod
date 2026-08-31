import { supabase } from '@/lib/supabaseClient';
import {
  getCollectionEvents,
  getEventsByStatus,
  markEventPending,
  markEventsAccepted,
  markEventsError,
  markEventsSynced,
} from '@/lib/collectionEventQueue';
import { INGRESS_SELECT } from '@/lib/collectionBatchService';

const FINAL_STATUSES = new Set(['sincronizada', 'erro']);
const POLL_CHUNK_SIZE = 100;
const MISSING_ROW_REQUEUE_MS = 90_000;

function resultFor(row) {
  return row?.resultado || {
    success: false,
    status: 'error',
    reason_code: row?.erro
      ? 'COLLECTION_INBOX_ERROR'
      : 'COLLECTION_INBOX_EMPTY_RESULT',
    message: row?.erro || 'O servidor finalizou a leitura sem retornar o resultado.',
    client_event_id: row?.client_event_id,
  };
}

function finalErrorFor(row) {
  const result = resultFor(row);
  const error = new Error(
    row?.erro || result?.message || 'A leitura não pôde ser processada.',
  );
  error.retryable = row?.retryable === true;
  error.serverFinal = true;
  error.result = result;
  error.code = row?.last_error_code || result?.reason_code;
  return error;
}

export function isCollectionInboxFinal(row) {
  return FINAL_STATUSES.has(row?.status_sincronizacao);
}

/**
 * Aplica uma rajada de atualizações do Realtime em transações IndexedDB por
 * estado. Um lote de 300 decisões gera poucas transações, não 300 get/put.
 */
export async function applyCollectionInboxRows(rows = [], options = {}) {
  const { onResult } = options;
  const latestById = new Map();
  rows.forEach((row) => {
    if (row?.client_event_id) latestById.set(row.client_event_id, row);
  });
  if (!latestById.size) return { checked: 0, finalized: 0, accepted: 0 };

  const localEvents = await getCollectionEvents(Array.from(latestById.keys()));
  const eventById = new Map(
    localEvents.map((event) => [event.client_event_id, event]),
  );
  const acceptedTransitions = [];
  const syncedTransitions = [];
  const errorTransitions = [];
  const callbacks = [];

  latestById.forEach((row, clientEventId) => {
    const event = eventById.get(clientEventId);
    if (!event || ['synced', 'error'].includes(event.status)) return;

    if (row.status_sincronizacao === 'sincronizada') {
      const result = resultFor(row);
      syncedTransitions.push({ event, result, ingress: row });
      callbacks.push({ event, result, error: null, ingress: row });
    } else if (row.status_sincronizacao === 'erro') {
      const error = finalErrorFor(row);
      errorTransitions.push({ event, error });
      callbacks.push({ event, result: error.result, error, ingress: row });
    } else {
      acceptedTransitions.push({ event, ingress: row });
    }
  });

  await Promise.all([
    markEventsAccepted(acceptedTransitions),
    markEventsSynced(syncedTransitions),
    markEventsError(errorTransitions, 1),
  ]);

  callbacks.forEach(({ event, result, error, ingress }) => {
    onResult?.({
      event,
      result,
      error,
      source: 'server-final',
      ingress,
    });
  });

  return {
    checked: latestById.size,
    finalized: syncedTransitions.length + errorTransitions.length,
    accepted: acceptedTransitions.length,
  };
}

/** Aplica uma atualização isolada mantendo compatibilidade com testes/callers. */
export async function applyCollectionInboxRow(row, options = {}) {
  const summary = await applyCollectionInboxRows([row], options);
  return summary.checked > 0;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

/**
 * Polling de segurança para ambientes onde Realtime oscila. A reconciliação em
 * lote faz uma transação IndexedDB por estado, evitando travamento da tela.
 */
export async function reconcileAcceptedCollectionEvents(options = {}) {
  const { onResult, limit = 500 } = options;
  const accepted = (await getEventsByStatus('accepted'))
    .sort((left, right) => (
      left.created_at_client.localeCompare(right.created_at_client)
    ))
    .slice(0, Math.max(1, limit));

  if (!accepted.length || !navigator.onLine) {
    return {
      checked: 0,
      finalized: 0,
      stillWaiting: accepted.length,
      requeued: 0,
    };
  }

  const byId = new Map(
    accepted.map((event) => [event.client_event_id, event]),
  );
  const rows = [];

  for (const idChunk of chunks(Array.from(byId.keys()), POLL_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('coletas_producao')
      .select(INGRESS_SELECT)
      .in('client_event_id', idChunk);

    if (error) {
      const wrapped = new Error(
        error.message || 'Falha ao reconciliar o inbox de coleta.',
      );
      wrapped.code = error.code;
      wrapped.retryable = true;
      throw wrapped;
    }
    rows.push(...(data || []));
  }

  const acceptedTransitions = [];
  const syncedTransitions = [];
  const errorTransitions = [];
  const finalCallbacks = [];

  rows.forEach((row) => {
    const event = byId.get(row.client_event_id);
    if (!event) return;
    byId.delete(row.client_event_id);

    if (row.status_sincronizacao === 'sincronizada') {
      const result = resultFor(row);
      syncedTransitions.push({ event, result, ingress: row });
      finalCallbacks.push({ event, result, error: null, ingress: row });
    } else if (row.status_sincronizacao === 'erro') {
      const error = finalErrorFor(row);
      errorTransitions.push({ event, error });
      finalCallbacks.push({ event, result: error.result, error, ingress: row });
    } else {
      acceptedTransitions.push({ event, ingress: row });
    }
  });

  await Promise.all([
    markEventsAccepted(acceptedTransitions),
    markEventsSynced(syncedTransitions),
    markEventsError(errorTransitions, 1),
  ]);

  finalCallbacks.forEach(({ event, result, error, ingress }) => {
    onResult?.({
      event,
      result,
      error,
      source: 'server-final',
      ingress,
    });
  });

  let requeued = 0;
  const now = Date.now();
  for (const missing of byId.values()) {
    const acceptedAt = new Date(
      missing.server_received_at
        || missing.updated_at
        || missing.created_at_client,
    ).getTime();
    if (Number.isFinite(acceptedAt) && now - acceptedAt > MISSING_ROW_REQUEUE_MS) {
      await markEventPending(missing.client_event_id);
      requeued += 1;
    }
  }

  const finalized = syncedTransitions.length + errorTransitions.length;
  return {
    checked: accepted.length,
    finalized,
    stillWaiting: accepted.length - finalized - requeued,
    requeued,
  };
}

export function subscribeToCollectionInboxUpdates(options = {}) {
  const { onResult, onStatus, coalesceMs = 120 } = options;
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const pendingRows = new Map();
  let timer = null;
  let applying = false;

  const flushRows = async () => {
    if (applying || !pendingRows.size) return;
    applying = true;
    const rows = Array.from(pendingRows.values());
    pendingRows.clear();
    try {
      await applyCollectionInboxRows(rows, { onResult });
    } catch (error) {
      console.warn(
        '[CollectionInbox] Falha ao aplicar lote Realtime:',
        error,
      );
    } finally {
      applying = false;
      if (pendingRows.size && !timer) {
        timer = setTimeout(() => {
          timer = null;
          flushRows();
        }, Math.max(25, Number(coalesceMs) || 120));
      }
    }
  };

  const schedule = (row) => {
    if (!row?.client_event_id) return;
    pendingRows.set(row.client_event_id, row);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushRows();
    }, Math.max(25, Number(coalesceMs) || 120));
  };

  const channel = supabase
    .channel(`collection-inbox-final-${randomId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'coletas_producao',
      },
      (payload) => schedule(payload.new),
    )
    .subscribe((status) => onStatus?.(status));

  try {
    Object.defineProperty(channel, '__acprodInboxCleanup', {
      configurable: true,
      value: () => {
        if (timer) clearTimeout(timer);
        timer = null;
        pendingRows.clear();
      },
    });
  } catch {
    // O canal continua removível mesmo sem a propriedade auxiliar.
  }

  return channel;
}

export function unsubscribeFromCollectionInbox(channel) {
  if (!channel) return Promise.resolve();
  try { channel.__acprodInboxCleanup?.(); } catch {}
  return supabase.removeChannel(channel).catch(() => undefined);
}

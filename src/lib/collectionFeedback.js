import {
  COLLECTION_STATES,
  collectionStateFromResult,
  getCollectionStatePresentation,
  isCollectionTerminalState,
} from '@/lib/collectionStateMachine';

const detailKeys = ['lot', 'order', 'item', 'reading', 'route', 'general_lot'];
const defined = (value = {}) => Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item != null));

/** O cache antigo sem sessão nunca deve aprovar uma leitura no próximo posto. */
export function restoreCollectionFeedback(saved, operatorSessionId) {
  if (!saved || !operatorSessionId) return null;
  try {
    const parsed = JSON.parse(saved);
    return parsed?.operator_session_id === operatorSessionId
      ? mergeCollectionFeedback(null, parsed) : null;
  } catch {
    return null;
  }
}

/** Recibos compactos e resultados completos compartilham a mesma apresentação. */
export function normalizeCollectionFeedback(input = {}) {
  const envelopeState = collectionStateFromResult(input);
  let result = {};
  let layer = input;
  for (let depth = 0; depth < 5 && layer && typeof layer === 'object'; depth += 1) {
    const previous = result;
    result = { ...result, ...defined(layer) };
    for (const key of detailKeys) {
      if (previous[key] || layer[key]) result[key] = { ...defined(previous[key]), ...defined(layer[key]) };
    }
    layer = layer.result || layer.resultado;
  }
  delete result.result;
  delete result.resultado;
  const lot = {
    ...defined({ id: result.lot_id, lot_code: result.lot_code || result.customer_lot_code,
      pcp_import_batch_id: result.pcp_import_batch_id, general_lot_code: result.general_lot_code }),
    ...defined(result.lot),
  };
  const order = {
    ...defined({ id: result.order_id, order_number: result.order_number,
      customer_name: result.customer_name || result.client_name }),
    ...defined(result.order),
  };
  if (Object.keys(lot).length) result.lot = lot;
  if (Object.keys(order).length) result.order = order;
  if (envelopeState) result.collection_state = envelopeState;
  return result;
}

export function collectionFeedbackMessage(feedback, state = collectionStateFromResult(feedback)) {
  const message = feedback?.message;
  const waiting = /aguardando (processamento|valida[çc][aã]o|registro|confirma[çc][aã]o|sincroniza[çc][aã]o|envio)|preservada.*(tentativa|processamento)|enfileirad|leitura capturada/i;
  if (!message || (state === COLLECTION_STATES.APPROVED && waiting.test(message))) {
    return getCollectionStatePresentation(state).defaultMessage;
  }
  return message;
}

/** Um ACK atrasado não pode apagar a decisão final da mesma leitura. */
export function mergeCollectionFeedback(previous, incoming) {
  if (!incoming) return null;
  const next = normalizeCollectionFeedback(incoming);
  const sameEvent = previous?.client_event_id && previous.client_event_id === next.client_event_id;
  const previousState = collectionStateFromResult(previous || {});
  let state = collectionStateFromResult(next);
  const preserveDecision = sameEvent && isCollectionTerminalState(previousState)
    && !isCollectionTerminalState(state);
  const merged = sameEvent ? { ...previous, ...next } : next;
  for (const key of detailKeys) {
    if (sameEvent && (previous[key] || next[key])) {
      merged[key] = { ...defined(previous[key]), ...defined(next[key]) };
    }
  }
  if (preserveDecision) {
    state = previousState;
    merged.message = previous.message;
  }
  if (state) {
    merged.collection_state = state;
    merged.status = state.toLowerCase();
    merged.success = state === COLLECTION_STATES.APPROVED;
    if (isCollectionTerminalState(state)) {
      merged.pending = false;
      merged.queued = false;
    }
    merged.message = collectionFeedbackMessage(merged, state);
  }
  return merged;
}

export function hasCollectionLotIdentity(value) {
  return Boolean(value?.lot?.id || value?.lot?.lot_code || value?.lot?.pcp_import_batch_id
    || value?.lot?.general_lot_code || value?.general_lot?.general_lot_code || value?.general_lot_code);
}

/** Usa identificação recebida do servidor; ausência de progresso permanece N/D. */
export function resolveCollectionLotContext({ feedback, lastIdentifiedFeedback, activeGeneralLots = [], activeContext, selectedPiece }) {
  const source = normalizeCollectionFeedback(hasCollectionLotIdentity(feedback) ? feedback : lastIdentifiedFeedback || {});
  const batchId = source.lot?.pcp_import_batch_id || source.general_lot?.id;
  const generalCode = source.lot?.general_lot_code || source.general_lot?.general_lot_code || source.general_lot_code;
  const candidates = [...activeGeneralLots];
  if (activeContext) candidates.push({
    id: activeContext.active_pcp_import_batch_id,
    general_lot_code: activeContext.active_general_lot_code,
    lot_id: activeContext.active_lot_id,
    lot_code: activeContext.active_lot_code,
    customer_name: activeContext.customer_name,
    progress_percent: activeContext.progress_percent,
  });
  const match = batchId
    ? candidates.find((lot) => lot.id === batchId)
    : generalCode
      ? candidates.find((lot) => lot.general_lot_code === generalCode)
      : source.lot?.id || source.lot?.lot_code
        ? candidates.find((lot) => (source.lot?.id && lot.lot_id === source.lot.id) || (source.lot?.lot_code && lot.lot_code === source.lot.lot_code))
        : candidates[0];
  const progress = match?.progress_percent ?? source.general_lot?.progress_percent;
  const selectedFallback = !hasCollectionLotIdentity(source) && !match ? selectedPiece : null;
  return {
    generalLot: {
      id: batchId || match?.id || null,
      general_lot_code: generalCode || match?.general_lot_code || selectedFallback?.general_lot_code || null,
      progress_percent: progress != null && Number.isFinite(Number(progress)) ? Number(progress) : null,
    },
    clientLotCode: source.lot?.lot_code || match?.lot_code || selectedFallback?.lot_code || null,
    customerName: source.order?.customer_name || match?.customer_name || selectedFallback?.client_name || null,
  };
}

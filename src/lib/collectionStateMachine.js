/**
 * Estados canônicos do pipeline de coleta V3.
 *
 * `status` continua existindo na fila local somente como índice de transporte
 * compatível com instalações antigas. A decisão exibida pela UI sempre vem de
 * `collection_state` e nunca é inferida de `success` antes de APPROVED.
 */
export const COLLECTION_STATES = Object.freeze({
  CAPTURED_LOCAL: 'CAPTURED_LOCAL',
  PENDING_DATABASE: 'PENDING_DATABASE',
  DATABASE_ACKNOWLEDGED: 'DATABASE_ACKNOWLEDGED',
  PROCESSING: 'PROCESSING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BLOCKED: 'BLOCKED',
  DUPLICATED: 'DUPLICATED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  RETRYING: 'RETRYING',
  DEAD_LETTERED: 'DEAD_LETTERED',
});

export const COLLECTION_TERMINAL_STATES = Object.freeze([
  COLLECTION_STATES.APPROVED,
  COLLECTION_STATES.REJECTED,
  COLLECTION_STATES.BLOCKED,
  COLLECTION_STATES.DUPLICATED,
  COLLECTION_STATES.PENDING_REVIEW,
  COLLECTION_STATES.DEAD_LETTERED,
]);

const TERMINAL_STATE_SET = new Set(COLLECTION_TERMINAL_STATES);

const ALLOWED_TRANSITIONS = Object.freeze({
  [COLLECTION_STATES.CAPTURED_LOCAL]: new Set([
    COLLECTION_STATES.PENDING_DATABASE,
    COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    COLLECTION_STATES.PROCESSING,
    COLLECTION_STATES.RETRYING,
    COLLECTION_STATES.DEAD_LETTERED,
    ...COLLECTION_TERMINAL_STATES,
  ]),
  [COLLECTION_STATES.PENDING_DATABASE]: new Set([
    COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    COLLECTION_STATES.PROCESSING,
    COLLECTION_STATES.RETRYING,
    COLLECTION_STATES.DEAD_LETTERED,
    ...COLLECTION_TERMINAL_STATES,
  ]),
  [COLLECTION_STATES.DATABASE_ACKNOWLEDGED]: new Set([
    COLLECTION_STATES.PROCESSING,
    ...COLLECTION_TERMINAL_STATES,
  ]),
  [COLLECTION_STATES.PROCESSING]: new Set([
    COLLECTION_STATES.RETRYING,
    ...COLLECTION_TERMINAL_STATES,
  ]),
  [COLLECTION_STATES.RETRYING]: new Set([
    COLLECTION_STATES.PENDING_DATABASE,
    COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
    COLLECTION_STATES.PROCESSING,
    ...COLLECTION_TERMINAL_STATES,
  ]),
  [COLLECTION_STATES.APPROVED]: new Set(),
  [COLLECTION_STATES.REJECTED]: new Set(),
  [COLLECTION_STATES.BLOCKED]: new Set(),
  [COLLECTION_STATES.DUPLICATED]: new Set(),
  [COLLECTION_STATES.PENDING_REVIEW]: new Set(),
  [COLLECTION_STATES.DEAD_LETTERED]: new Set(),
});

const STATE_ALIASES = Object.freeze({
  captured_local: COLLECTION_STATES.CAPTURED_LOCAL,
  pending_database: COLLECTION_STATES.PENDING_DATABASE,
  queued: COLLECTION_STATES.PENDING_DATABASE,
  pending: COLLECTION_STATES.PENDING_DATABASE,
  recebida: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
  received: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
  database_acknowledged: COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
  processing: COLLECTION_STATES.PROCESSING,
  processando: COLLECTION_STATES.PROCESSING,
  approved: COLLECTION_STATES.APPROVED,
  aprovada: COLLECTION_STATES.APPROVED,
  rejected: COLLECTION_STATES.REJECTED,
  reprovada: COLLECTION_STATES.REJECTED,
  blocked: COLLECTION_STATES.BLOCKED,
  bloqueada: COLLECTION_STATES.BLOCKED,
  wrong_step: COLLECTION_STATES.BLOCKED,
  wrong_cell: COLLECTION_STATES.BLOCKED,
  invalid_context: COLLECTION_STATES.BLOCKED,
  duplicated: COLLECTION_STATES.DUPLICATED,
  duplicate: COLLECTION_STATES.DUPLICATED,
  duplicada: COLLECTION_STATES.DUPLICATED,
  pending_review: COLLECTION_STATES.PENDING_REVIEW,
  warning: COLLECTION_STATES.PENDING_REVIEW,
  retrying: COLLECTION_STATES.RETRYING,
  retry: COLLECTION_STATES.RETRYING,
  dead_lettered: COLLECTION_STATES.DEAD_LETTERED,
  error: COLLECTION_STATES.DEAD_LETTERED,
  erro: COLLECTION_STATES.DEAD_LETTERED,
  invalid: COLLECTION_STATES.REJECTED,
  not_found: COLLECTION_STATES.REJECTED,
});

export function normalizeCollectionState(value, fallback = null) {
  if (!value) return fallback;
  const normalized = String(value).trim();
  if (Object.values(COLLECTION_STATES).includes(normalized)) return normalized;
  return STATE_ALIASES[normalized.toLowerCase()] || fallback;
}

export function collectionStateFromResult(result = {}, fallback = null) {
  const direct = [
    result.collection_state,
    result.state,
    result.decision,
    result.event_status,
    result.status,
    result.result?.collection_state,
    result.result?.state,
    result.result?.decision,
    result.result?.status,
  ].map((candidate) => normalizeCollectionState(candidate))
    .find(Boolean);
  if (direct) return direct;

  if (result.status_sincronizacao === 'recebida') {
    return COLLECTION_STATES.DATABASE_ACKNOWLEDGED;
  }
  if (result.status_sincronizacao === 'processando') {
    return COLLECTION_STATES.PROCESSING;
  }
  return fallback;
}

export function isCollectionTerminalState(value) {
  return TERMINAL_STATE_SET.has(normalizeCollectionState(value));
}

export function isCollectionApproved(value) {
  return normalizeCollectionState(value) === COLLECTION_STATES.APPROVED;
}

export function canTransitionCollectionState(from, to) {
  const normalizedFrom = normalizeCollectionState(from);
  const normalizedTo = normalizeCollectionState(to);
  if (!normalizedFrom || !normalizedTo) return false;
  if (normalizedFrom === normalizedTo) return true;
  return ALLOWED_TRANSITIONS[normalizedFrom]?.has(normalizedTo) === true;
}

export function assertCollectionTransition(from, to) {
  if (!canTransitionCollectionState(from, to)) {
    throw new Error(`Transição de coleta inválida: ${from || 'UNKNOWN'} -> ${to || 'UNKNOWN'}.`);
  }
  return normalizeCollectionState(to);
}

export function legacyQueueStatusForCollectionState(value) {
  const state = normalizeCollectionState(value, COLLECTION_STATES.CAPTURED_LOCAL);
  if (state === COLLECTION_STATES.CAPTURED_LOCAL
    || state === COLLECTION_STATES.PENDING_DATABASE
    || state === COLLECTION_STATES.RETRYING) {
    return 'pending';
  }
  if (state === COLLECTION_STATES.DATABASE_ACKNOWLEDGED
    || state === COLLECTION_STATES.PROCESSING) {
    return 'processing';
  }
  if (state === COLLECTION_STATES.DEAD_LETTERED) return 'error';
  return 'synced';
}

export const COLLECTION_STATE_PRESENTATION = Object.freeze({
  [COLLECTION_STATES.CAPTURED_LOCAL]: Object.freeze({ tone: 'neutral', label: 'LEITURA CAPTURADA', defaultMessage: 'Leitura salva com segurança neste dispositivo.' }),
  [COLLECTION_STATES.PENDING_DATABASE]: Object.freeze({ tone: 'neutral', label: 'AGUARDANDO ENVIO', defaultMessage: 'Leitura aguardando confirmação do banco.' }),
  [COLLECTION_STATES.DATABASE_ACKNOWLEDGED]: Object.freeze({ tone: 'neutral', label: 'REGISTRADA NO BANCO', defaultMessage: 'Registrada no banco. Aguardando processamento.' }),
  [COLLECTION_STATES.PROCESSING]: Object.freeze({ tone: 'neutral', label: 'EM PROCESSAMENTO', defaultMessage: 'O servidor está validando a leitura.' }),
  [COLLECTION_STATES.APPROVED]: Object.freeze({ tone: 'approved', label: 'PEÇA LIBERADA — OK', defaultMessage: 'Leitura aprovada.' }),
  [COLLECTION_STATES.REJECTED]: Object.freeze({ tone: 'danger', label: 'LEITURA REPROVADA', defaultMessage: 'Leitura reprovada.' }),
  [COLLECTION_STATES.BLOCKED]: Object.freeze({ tone: 'warning', label: 'ENTRADA BLOQUEADA', defaultMessage: 'Leitura bloqueada.' }),
  [COLLECTION_STATES.DUPLICATED]: Object.freeze({ tone: 'warning', label: 'LEITURA DUPLICADA', defaultMessage: 'Esta leitura já foi registrada.' }),
  [COLLECTION_STATES.PENDING_REVIEW]: Object.freeze({ tone: 'warning', label: 'REVISÃO NECESSÁRIA', defaultMessage: 'Leitura encaminhada para revisão.' }),
  [COLLECTION_STATES.RETRYING]: Object.freeze({ tone: 'neutral', label: 'REENVIO PROGRAMADO', defaultMessage: 'Leitura preservada e aguardando nova tentativa.' }),
  [COLLECTION_STATES.DEAD_LETTERED]: Object.freeze({ tone: 'danger', label: 'FALHA DE SINCRONIA', defaultMessage: 'Leitura preservada para análise manual.' }),
});

export function getCollectionStatePresentation(value) {
  const state = normalizeCollectionState(value, COLLECTION_STATES.CAPTURED_LOCAL);
  return {
    state,
    ...COLLECTION_STATE_PRESENTATION[state],
  };
}

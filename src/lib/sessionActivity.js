export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

const LAST_ACTIVITY_KEY = 'acprod_auth_last_activity_v1';
export const SESSION_ACTIVITY_EVENT = 'acprod-session-human-activity';
let memoryLastActivity = 0;

function readStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getLastSessionActivity() {
  try {
    const parsed = Number(readStorage()?.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch { /* fallback em memória */ }
  return memoryLastActivity || null;
}

export function recordSessionActivity(at = Date.now()) {
  const timestamp = Number(at);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  memoryLastActivity = timestamp;
  try {
    readStorage()?.setItem(LAST_ACTIVITY_KEY, String(timestamp));
  } catch {
    // O valor em memória mantém a proteção enquanto a página estiver aberta.
  }
  return timestamp;
}

export function isSessionInactive(now = Date.now(), timeoutMs = SESSION_INACTIVITY_MS) {
  const lastActivity = getLastSessionActivity();
  if (!lastActivity) return false;
  const timeout = Number(timeoutMs);
  return Number(now) - lastActivity >= (Number.isFinite(timeout) && timeout > 0 ? timeout : SESSION_INACTIVITY_MS);
}

/** Scanner/câmera: a captura é atividade; retries e respostas do banco não são. */
export function requestSessionActivity() {
  if (typeof window === 'undefined') return true;
  return window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT, { cancelable: true }));
}

export function clearSessionActivity() {
  memoryLastActivity = 0;
  try {
    readStorage()?.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    // Sem armazenamento disponível, o valor em memória já foi limpo.
  }
}

export const SESSION_ACTIVITY_STORAGE_KEY = LAST_ACTIVITY_KEY;

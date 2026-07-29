export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

const LAST_ACTIVITY_KEY = 'acprod_auth_last_activity_v1';
let memoryLastActivity = 0;

function readStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getLastSessionActivity() {
  const stored = readStorage()?.getItem(LAST_ACTIVITY_KEY);
  const parsed = Number(stored);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
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

export function isSessionInactive(now = Date.now()) {
  const lastActivity = getLastSessionActivity();
  if (!lastActivity) return false;
  return Number(now) - lastActivity >= SESSION_INACTIVITY_MS;
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

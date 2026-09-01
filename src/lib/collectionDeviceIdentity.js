import { getDeviceId } from '@/lib/operatorSessionService';

const DEVICE_SEQUENCE_PREFIX = 'acprod_collection_device_sequence:';
const DEVICE_SEQUENCE_LOCK_PREFIX = 'acprod-collection-device-sequence:';
let fallbackSequenceTask = Promise.resolve();
let memorySequence = 0;
let memoryDeviceId = null;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

function generateUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function getCollectionDeviceId() {
  const existing = getDeviceId();
  if (isUuid(existing)) return existing;
  if (!memoryDeviceId) memoryDeviceId = generateUuid();
  try {
    globalThis.localStorage?.setItem('acprod_device_id', memoryDeviceId);
  } catch {
    // Fallback em memória para WebViews com storage bloqueado.
  }
  return memoryDeviceId;
}

function readSequence(key) {
  try {
    const stored = Number(globalThis.localStorage?.getItem(key));
    if (Number.isSafeInteger(stored) && stored >= 0) return stored;
  } catch {
    // Electron/PWA em modo privado pode bloquear localStorage.
  }
  return memorySequence;
}

function writeSequence(key, value) {
  memorySequence = Math.max(memorySequence, value);
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    // A sequência em memória mantém monotonicidade dentro deste renderer.
  }
  return value;
}

async function incrementSequence(deviceId) {
  const key = `${DEVICE_SEQUENCE_PREFIX}${deviceId}`;
  const current = readSequence(key);
  if (current >= Number.MAX_SAFE_INTEGER) {
    const error = new Error(
      'A sequência deste dispositivo atingiu o limite seguro. '
      + 'Reautorize este equipamento antes de registrar novas leituras.',
    );
    error.code = 'COLLECTION_DEVICE_SEQUENCE_EXHAUSTED';
    error.retryable = false;
    throw error;
  }
  const next = current + 1;
  return writeSequence(key, next);
}

export function nextCollectionDeviceSequence(deviceId = getCollectionDeviceId()) {
  const lockManager = globalThis.navigator?.locks;
  if (lockManager?.request) {
    return lockManager.request(
      `${DEVICE_SEQUENCE_LOCK_PREFIX}${deviceId}`,
      () => incrementSequence(deviceId),
    );
  }

  const task = fallbackSequenceTask.then(
    () => incrementSequence(deviceId),
    () => incrementSequence(deviceId),
  );
  fallbackSequenceTask = task.catch(() => undefined);
  return task;
}

export function getCollectionAppVersion() {
  return import.meta.env.VITE_APP_VERSION
    || import.meta.env.VITE_BUILD_VERSION
    || 'web';
}

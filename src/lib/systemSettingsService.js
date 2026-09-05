import { supabase } from '@/lib/supabaseClient';

const CACHE_KEY = 'acprod_system_settings_v1';
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SETTINGS_FIELDS = 'id,default_timeout_minutes,warning_seconds,role_timeouts,cell_timeouts,sectors,version,updated_at';
const listeners = new Set();
let cached = null;
let fetchedAt = 0;
let pendingLoad = null;

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
  default_timeout_minutes: 30,
  warning_seconds: 60,
  role_timeouts: {},
  cell_timeouts: {},
  sectors: [],
  cell_catalog: [],
  version: 0,
});

function validSnapshot(value) {
  return value && Number.isInteger(value.default_timeout_minutes)
    && value.default_timeout_minutes >= 1 && value.default_timeout_minutes <= 1440
    && Number.isInteger(value.warning_seconds) && value.warning_seconds >= 0
    && value.warning_seconds <= 300 && Number.isSafeInteger(value.version)
    && value.version > 0 && Array.isArray(value.sectors)
    && value.role_timeouts && typeof value.role_timeouts === 'object'
    && value.cell_timeouts && typeof value.cell_timeouts === 'object';
}

// Cache contains configuration only. It allows the same screen policy after a
// reload without blocking login on a slow network; the database stays authoritative.
export function getCachedSystemSettings() {
  if (cached) return cached;
  try {
    const stored = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
    if (validSnapshot(stored)) cached = stored;
  } catch { /* Browsers with blocked storage use the in-memory snapshot. */ }
  return cached;
}

function publishSettings(settings) {
  // A read begun before an admin save must not replace the new version.
  if (cached && cached.version > settings.version) return cached;
  cached = settings;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings)); } catch { /* optional cache */ }
  listeners.forEach((listener) => listener(settings));
  return settings;
}

function handleStorage(event) {
  if (event.key !== CACHE_KEY || !event.newValue) return;
  try {
    const settings = JSON.parse(event.newValue);
    if (validSnapshot(settings) && (!cached || settings.version >= cached.version)) {
      cached = settings;
      listeners.forEach((listener) => listener(settings));
    }
  } catch { /* Ignore malformed cross-tab cache updates. */ }
}

export function subscribeSystemSettings(listener) {
  if (!listeners.size) window.addEventListener('storage', handleStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', handleStorage);
  };
}

async function loadCells(signal) {
  const cells = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('cells')
      .select('id,name,active').order('id').range(from, from + pageSize - 1).abortSignal(signal);
    if (error) throw error;
    cells.push(...(data || []));
    if (!data || data.length < pageSize) return cells;
  }
}

export async function loadSystemSettings({ force = false } = {}) {
  if (pendingLoad) return pendingLoad;
  if (!force && cached && Date.now() - fetchedAt < CACHE_TTL_MS) return cached;
  pendingLoad = (async () => {
    const controller = new AbortController();
    let timeout;
    try {
      const [settingsResult, cellCatalog] = await Promise.race([
        Promise.all([
          supabase.from('system_settings').select(SETTINGS_FIELDS).eq('id', 'session').maybeSingle().abortSignal(controller.signal),
          loadCells(controller.signal),
        ]),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('A conexão demorou para carregar as configurações. Tente novamente.'));
          }, REQUEST_TIMEOUT_MS);
        }),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (!validSnapshot(settingsResult.data)) {
        throw new Error('As configurações do sistema ainda não estão disponíveis. Recarregue e tente novamente.');
      }
      fetchedAt = Date.now();
      return publishSettings({ ...settingsResult.data, cell_catalog: cellCatalog });
    } finally {
      clearTimeout(timeout);
    }
  })();
  try { return await pendingLoad; } finally { pendingLoad = null; }
}

export async function saveSystemSettings(settings) {
  const payload = {
    default_timeout_minutes: settings.default_timeout_minutes,
    warning_seconds: settings.warning_seconds,
    role_timeouts: settings.role_timeouts,
    cell_timeouts: settings.cell_timeouts,
    sectors: settings.sectors,
  };
  const { data, error } = await supabase.rpc('save_system_settings', {
    p_settings: payload,
    p_expected_version: settings.version,
  });
  if (error) {
    if (error.code === '40001') {
      throw new Error('Outro administrador alterou as configurações. Recarregue antes de salvar novamente.');
    }
    if (error.code === '42501') throw new Error('Somente administradores ativos podem alterar as configurações.');
    throw error;
  }
  const saved = Array.isArray(data) ? data[0] : data;
  if (!validSnapshot(saved)) throw new Error('O servidor não confirmou o salvamento. Recarregue as configurações.');
  fetchedAt = Date.now();
  return publishSettings({ ...saved, cell_catalog: settings.cell_catalog || cached?.cell_catalog || [] });
}

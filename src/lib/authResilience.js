import { getDefaultPermissions } from '@/config/appRoutes';
import { measureAuthStep } from '@/lib/authTelemetry';

export const PROFILE_TIMEOUT_MS = 8_000;
export const PROFILE_CACHE_TTL_MS = 30_000;

const profileCache = new Map();
const profileRequests = new Map();

export function profileAccessError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function isAccessDeniedError(error) {
  return ['USER_NOT_REGISTERED', 'USER_INACTIVE', 'ACCESS_REMOVED'].includes(error?.code);
}

export function isDefinitiveSessionError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return [
    'refresh_token_not_found',
    'invalid_refresh_token',
    'invalid_grant',
    'session_not_found',
    'user_not_found',
  ].includes(code)
    || message.includes('invalid refresh token')
    || message.includes('refresh token not found')
    || message.includes('user not found');
}

export function isTransientAuthError(error) {
  if (!error) return false;
  if (error.code === 'PROFILE_UNAVAILABLE' || error.name === 'AbortError') return true;
  if ([408, 429, 500, 502, 503, 504].includes(Number(error.status || error.statusCode))) return true;
  const message = String(error.message || '').toLowerCase();
  return ['timeout', 'timed out', 'failed to fetch', 'network', 'load failed', 'connection'].some((part) => message.includes(part));
}

export function mapProfile(supabaseUser, profile) {
  const userRole = profile.role;
  return {
    id: supabaseUser.id,
    email: profile.email || supabaseUser.email,
    name: profile.name,
    role: userRole,
    cell: profile.cell || '',
    permissions: profile.permissions || getDefaultPermissions(userRole),
    dashboard_layout: profile.dashboard_layout || null,
    managed_cells: profile.managed_cells || [],
    report_delivery_enabled: profile.report_delivery_enabled === true,
    receives_daily_report: profile.receives_daily_report === true,
    active: true,
  };
}

export function getCachedProfile(userId, { allowExpired = false } = {}) {
  const cached = profileCache.get(userId);
  if (!cached) return null;
  if (!allowExpired && cached.expiresAt <= Date.now()) return null;
  return cached.profile;
}

export function invalidateProfileCache(userId) {
  if (userId) profileCache.delete(userId);
  else profileCache.clear();
}

export function clearProfileRequestState() {
  for (const request of profileRequests.values()) request.controller.abort();
  profileRequests.clear();
  profileCache.clear();
}

export function fetchProfileSingleFlight(supabase, supabaseUser, options = {}) {
  if (!supabaseUser?.id) return Promise.resolve(null);
  const { force = false, correlationId = 'background' } = options;
  const cached = getCachedProfile(supabaseUser.id);
  if (!force && cached) return Promise.resolve(cached);
  if (profileRequests.has(supabaseUser.id)) return profileRequests.get(supabaseUser.id).promise;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('PROFILE_TIMEOUT'), PROFILE_TIMEOUT_MS);
  const promise = measureAuthStep(correlationId, 'profiles', async () => {
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('id', supabaseUser.id)
      .maybeSingle();
    if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
    const { data: profile, error } = await query;
    if (controller.signal.aborted) {
      throw profileAccessError('PROFILE_UNAVAILABLE', 'Validação de acesso temporariamente indisponível.');
    }
    if (error) {
      if (isTransientAuthError(error)) {
        throw profileAccessError('PROFILE_UNAVAILABLE', 'Validação de acesso temporariamente indisponível.', error);
      }
      throw error;
    }
    if (!profile) throw profileAccessError('USER_NOT_REGISTERED', 'Este e-mail ainda não foi cadastrado pelo administrador.');
    if (profile.active === false) throw profileAccessError('USER_INACTIVE', 'Esta conta está desativada. Procure o administrador.');

    const mapped = mapProfile(supabaseUser, profile);
    profileCache.set(supabaseUser.id, { profile: mapped, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
    return mapped;
  }).finally(() => {
    clearTimeout(timeoutId);
    const active = profileRequests.get(supabaseUser.id);
    if (active?.promise === promise) profileRequests.delete(supabaseUser.id);
  });

  profileRequests.set(supabaseUser.id, { promise, controller });
  return promise;
}

export function retryDelay(attempt, { baseMs = 750, maxMs = 15_000, random = Math.random } = {}) {
  const exponential = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt)));
  return Math.round(exponential * (0.75 + random() * 0.5));
}

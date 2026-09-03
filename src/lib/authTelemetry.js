const AUTH_METRICS_KEY = 'ac-prod-auth-metrics-v1';
const MAX_AUTH_METRICS = 120;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function safeDeviceType() {
  if (typeof navigator === 'undefined') return 'server';
  const agent = String(navigator.userAgent || '').toLowerCase();
  if (/ipad|tablet/.test(agent)) return 'tablet';
  if (/mobile|iphone|android/.test(agent)) return 'mobile';
  return 'desktop';
}

function safeAppVersion() {
  return String(import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_COMMIT_SHA || 'development').slice(0, 80);
}

export function createAuthCorrelationId() {
  return globalThis.crypto?.randomUUID?.() || `auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeAuthError(error) {
  if (!error) return null;
  return {
    code: String(error.code || error.name || 'AUTH_ERROR').slice(0, 64),
    status: Number(error.status || error.statusCode) || null,
  };
}

export function recordAuthMetric({ correlationId, step, result, durationMs = null, error = null }) {
  const normalizedError = normalizeAuthError(error);
  const metric = {
    correlation_id: String(correlationId || 'background').slice(0, 80),
    step: String(step || 'unknown').slice(0, 80),
    result: String(result || (normalizedError ? 'error' : 'success')).slice(0, 32),
    duration_ms: durationMs == null ? null : Number(Number(durationMs).toFixed(3)),
    error_code: normalizedError?.code || null,
    http_status: normalizedError?.status || null,
    app_version: safeAppVersion(),
    device_type: safeDeviceType(),
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
    recorded_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      const current = JSON.parse(window.sessionStorage?.getItem(AUTH_METRICS_KEY) || '[]');
      const metrics = Array.isArray(current) ? current : [];
      metrics.push(metric);
      window.sessionStorage?.setItem(AUTH_METRICS_KEY, JSON.stringify(metrics.slice(-MAX_AUTH_METRICS)));
    } catch { /* armazenamento indisponível não pode bloquear autenticação */ }
    window.dispatchEvent(new CustomEvent('acprod-auth-metric', { detail: metric }));
  }

  return metric;
}

export async function measureAuthStep(correlationId, step, operation) {
  const startedAt = nowMs();
  try {
    const value = await operation();
    recordAuthMetric({ correlationId, step, result: 'success', durationMs: nowMs() - startedAt });
    return value;
  } catch (error) {
    recordAuthMetric({ correlationId, step, result: 'error', durationMs: nowMs() - startedAt, error });
    throw error;
  }
}

export function getAuthMetrics() {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.sessionStorage?.getItem(AUTH_METRICS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}


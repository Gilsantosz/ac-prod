import { LIMITS, TARGET } from './plan.mjs';
export function evaluate(e = {}) {
  const reasons = [];
  const m = e.metrics ?? {};
  const requireTrue = (value, name) => { if (value !== true) reasons.push(name); };
  requireTrue(e.real_auth, 'REAL_AUTH_NOT_PROVEN');
  requireTrue(e.real_database, 'REAL_DATABASE_NOT_PROVEN');
  requireTrue(e.real_realtime, 'REAL_REALTIME_NOT_PROVEN');
  requireTrue(e.reconciliation_complete, 'RECONCILIATION_INCOMPLETE');
  requireTrue(e.telemetry_complete, 'TELEMETRY_INCOMPLETE');
  requireTrue(e.scenarios_a_to_k_complete, 'SCENARIOS_INCOMPLETE');
  if (e.target !== TARGET) reasons.push('STAGING_TARGET_INVALID');
  if (!Number.isInteger(e.sessions_min) || e.sessions_min < 200) reasons.push('SESSIONS_NOT_PROVEN');
  if (!Number.isInteger(e.collectors_min) || e.collectors_min < 100) reasons.push('COLLECTORS_NOT_PROVEN');
  if (!Number.isFinite(e.soak_seconds) || e.soak_seconds < 3600) reasons.push('SOAK_NOT_PROVEN');
  if (!Number.isFinite(e.rate_per_minute) || e.rate_per_minute < 2000) reasons.push('RATE_NOT_PROVEN');
  for (const [name, maximum] of Object.entries(LIMITS)) {
    const value = m[name];
    if (!Number.isFinite(value) || value < 0) reasons.push(`UNMEASURED:${name}`);
    else if (name === 'error_rate' ? value >= maximum : value > maximum) reasons.push(`SLO_FAILED:${name}`);
  }
  for (const name of ['lost_collections','duplicated_production','involuntary_logouts','deadlocks','counter_divergence','dropped_iterations']) {
    if (!Number.isInteger(m[name]) || m[name] < 0) reasons.push(`UNMEASURED:${name}`);
    else if (m[name] !== 0) reasons.push(`SLO_FAILED:${name}`);
  }
  return { status: reasons.length ? 'FAIL' : 'PASS', capacity: reasons.length ? 'NOT_PROVEN' : 'PROVEN', reasons };
}

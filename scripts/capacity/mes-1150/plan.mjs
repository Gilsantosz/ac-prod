/** Pure planning and evidence checks. Does NOT provision users or write to a backend. */
export const PROJECT_REF = 'smnsihksrhzbkhcbdjfu';
export const TARGET = `https://${PROJECT_REF}.supabase.co`;
export const ALLOCATION = Object.freeze([
  ['cut', 'Corte', 30], ['edge', 'Borda', 60], ['drill', 'Furação', 20],
  ['cnc', 'Usinagem', 10], ['joinery', 'Marcenaria', 15],
  ['separation', 'Separação', 5], ['packaging', 'Embalagem', 5],
]);
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireCondition(ok, message) { if (!ok) throw new Error(message); }
export function buildPlan(runId = 'mes1150-20260907') {
  requireCondition(/^[a-z][a-z0-9-]{5,31}$/.test(runId), 'Invalid isolated run identifier.');
  const workstations = ALLOCATION.flatMap(([stage, cell, count]) => Array.from({ length: count }, (_, i) => ({
    station_key: `${stage}-${String(i + 1).padStart(3, '0')}`, stage, cell_name: cell,
    reserved: false, collects: true,
  })));
  for (let i = 1; i <= 5; i += 1) workstations.push({
    station_key: `reserve-${String(i).padStart(3, '0')}`, stage: 'reserve',
    cell_name: null, reserved: true, collects: false,
  });
  const operators = workstations.map((s, i) => ({
    account_key: `operator-${String(i + 1).padStart(3, '0')}`, role: 'operator',
    planned_email: `${runId}.op${String(i + 1).padStart(3, '0')}@example.invalid`,
    station_key: s.station_key, state: 'PLANNED_NOT_PROVISIONED',
  }));
  const management = Array.from({ length: 1000 }, (_, i) => ({
    account_key: `management-${String(i + 1).padStart(4, '0')}`,
    role: i === 0 ? 'admin' : i < 100 ? 'manager' : 'viewer',
    planned_email: `${runId}.mg${String(i + 1).padStart(4, '0')}@example.invalid`,
    state: 'PLANNED_NOT_PROVISIONED',
  }));
  return {
    run_id: runId, project_ref: PROJECT_REF, target: TARGET,
    status: 'BLOCKED_PROVISIONING_NOT_EXECUTED', database_writes_executed: false,
    physical_computers_created: 0, auth_users_created: 0, workstations_created: 0,
    target_operator_identities: 150, target_management_identities: 1000,
    target_collecting_workstations: 145, target_reserve_workstations: 5,
    role_mix_is_assumption: true, reserve_allocation_is_assumption: true,
    workstations, accounts: [...operators, ...management],
    stages: [
      { name: 'functional', purpose: 'One valid receipt, decision and projection per productive cell; route and negative cases.' },
      { name: 'access', purpose: '1150 distinct authenticated identities; no collection writes.' },
      { name: 'mixed', purpose: '145 collecting stations, five reserve sessions and 1000 concurrent administrative readers.' },
      { name: 'browser', purpose: 'Real browser evidence of capture, cross-device rendering, reconnect and session recovery.' },
      { name: 'soak', purpose: 'Sustained load across real token renewal and shift/inactivity boundaries.' },
    ],
    non_go_coverage: ['browser_rendering', 'full_route', 'realtime_delivery', 'token_refresh',
      'replacement', 'rework', 'pcp_import', 'exports', 'offline_reconnect', 'emergency_stop'],
  };
}
/** Upper bound for unique events, NOT maximum production throughput. */
export function uniqueCodeBudget(stations, durationSeconds, intervalSeconds) {
  requireCondition(Number.isSafeInteger(stations) && stations >= 0, 'Invalid station count.');
  requireCondition(Number.isFinite(durationSeconds) && durationSeconds > 0, 'Invalid duration.');
  requireCondition(Number.isFinite(intervalSeconds) && intervalSeconds > 0, 'Invalid cadence.');
  return stations * Math.ceil(durationSeconds / intervalSeconds);
}
/** Validate structure and identity separation; remote Auth/RLS validation remains mandatory. */
export function validateFixture(fixture, decodeClaims, { nowMs = Date.now(), requiredSeconds = 900, minCodes = 0 } = {}) {
  requireCondition(fixture?.project_ref === PROJECT_REF, 'Wrong project; production is forbidden.');
  requireCondition(typeof fixture.run_id === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(fixture.run_id), 'Invalid run ID.');
  const operators = fixture.operators || [], management = fixture.management || [];
  requireCondition(operators.length === 150 && management.length === 1000, 'Exactly 150 operators and 1000 administrative identities are required.');
  const users = new Set(), sessions = new Set(), devices = new Set(), machines = new Set(), codes = new Set();
  const counts = Object.fromEntries(ALLOCATION.map(([s]) => [s, 0])); counts.reserve = 0;
  const roleCounts = { admin: 0, manager: 0, viewer: 0 };
  for (const [index, identity] of [...operators, ...management].entries()) {
    let claims; try { claims = decodeClaims(identity.access_token); } catch { /* rejected below */ }
    requireCondition(claims && claims.role === 'authenticated' && claims.iss === `${TARGET}/auth/v1`
      && uuidPattern.test(claims.sub || '') && Number.isFinite(claims.exp)
      && claims.exp * 1000 > nowMs + requiredSeconds * 1000, `Invalid, expired or non-user credential at slot ${index}.`);
    requireCondition(!users.has(claims.sub), 'A JWT/identity cannot impersonate multiple users.'); users.add(claims.sub);
    requireCondition(uuidPattern.test(identity.device_id || '') && !devices.has(identity.device_id), 'Device IDs must be unique UUIDs.'); devices.add(identity.device_id);
    if (index >= 150) {
      requireCondition(Object.hasOwn(roleCounts, identity.role), 'Invalid management role.'); roleCounts[identity.role] += 1;
      requireCondition(typeof identity.batch_id === 'string' && uuidPattern.test(identity.batch_id), 'Administrative query must target a test batch.');
      continue;
    }
    requireCondition(Object.hasOwn(counts, identity.stage), 'Unknown operator stage.'); counts[identity.stage] += 1;
    for (const key of ['operator_session_id', 'cell_id', 'machine_id']) requireCondition(uuidPattern.test(identity[key] || ''), `Missing operational ${key}.`);
    requireCondition(!sessions.has(identity.operator_session_id) && !machines.has(identity.machine_id), 'Operational sessions and machines must be distinct.');
    sessions.add(identity.operator_session_id); machines.add(identity.machine_id);
    const values = identity.codes || [];
    requireCondition(identity.stage === 'reserve' ? values.length === 0 : values.length >= minCodes, 'Insufficient unique codes, or a reserve was configured to collect.');
    for (const code of values) {
      requireCondition(typeof code === 'string' && /^\d{8}$/.test(code) && !codes.has(code), 'Codes must be unique eight-digit strings; preserve leading zeros.');
      codes.add(code);
    }
  }
  for (const [stage, , count] of ALLOCATION) requireCondition(counts[stage] === count, `Wrong workstation allocation for ${stage}.`);
  requireCondition(counts.reserve === 5, 'Five reserve identities are required.');
  requireCondition(roleCounts.admin === 1 && roleCounts.manager === 99 && roleCounts.viewer === 900, 'Role mix differs from the documented 1/99/900 assumption.');
  return { identities: users.size, operators: operators.length, management: management.length, counts, roleCounts, unique_codes: codes.size };
}
/** Sweep verified presence intervals. Total logins alone never proves simultaneous users. */
export function peakConcurrent(intervals) {
  const ids = new Set(), events = [];
  for (const { identity_id: id, start_ms: start, end_ms: end } of intervals) {
    requireCondition(typeof id === 'string' && !ids.has(id), 'Presence evidence must contain one interval per distinct identity.'); ids.add(id);
    requireCondition(Number.isFinite(start) && Number.isFinite(end) && end > start, 'Invalid presence interval.');
    events.push([start, 1], [end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, peak = 0; for (const [, delta] of events) { current += delta; peak = Math.max(current, peak); }
  return peak;
}
/** Report status is conservative: missing evidence is not zero failures or GO. */
export function decideRun(evidence) {
  if (!evidence?.remote_measurement) return 'NO_MEASUREMENT';
  if (evidence.integrity_errors > 0 || evidence.auth_losses > 0 || evidence.failed_thresholds?.length) return 'NO_GO';
  const required = ['integrity_errors', 'auth_losses', 'verified_identities', 'peak_concurrent_identities', 'approved_projected', 'offered_events'];
  if (required.some(key => !Number.isFinite(evidence[key]))) return 'INCOMPLETE_EVIDENCE';
  if (evidence.verified_identities !== 1150 || evidence.peak_concurrent_identities !== 1150
      || evidence.approved_projected !== evidence.offered_events || evidence.offered_events <= 0) return 'INCOMPLETE_EVIDENCE';
  if (buildPlan().non_go_coverage.some(key => evidence.coverage?.[key] !== 'passed')) return 'PARTIAL_PROFILE_ONLY';
  return 'REQUESTED_SCENARIO_PASSED_NOT_MAXIMUM_CAPACITY';
}

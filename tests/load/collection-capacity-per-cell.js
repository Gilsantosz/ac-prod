/* Extends the existing V3 workload, never an alternate ingress or auth bypass.
 * Projected receipts prove server projection, NOT browser rendering/scanning.
 */
import * as fabric from './collection-fabric-v3.js';
import http from 'k6/http';
import execution from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { assertVerifiedCollectionSession } from './collection-load-preflight.js';

const fixture = JSON.parse(open(__ENV.K6_FIXTURES));
const devices = fixture.devices;
const profile = (__ENV.K6_PROFILE || 'smoke').toLowerCase();
const exercisedCount = ({ smoke: 1, microbatch: 5, idempotency: 20, contention_piece: 20, contention_cell_lot: 50 })[profile] ?? devices.length;
const exercisedDevices = devices.slice(0, exercisedCount);
const cells = [...new Set(exercisedDevices.map(d => d.cell_id))];
const base = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const runId = __ENV.K6_RUN_ID;
const names = ['scheduled_unique_events', 'verified_receipts', 'verified_decisions',
  'verified_projections', 'approved_pieces', 'approved_projected_pieces', 'blocked_or_duplicate',
  'reconciliation_errors', 'unexpected_outcomes', 'auth_losses'];
const counters = Object.fromEntries(names.map(name => [name, new Counter('capacity_' + name)]));
const verifiedUsers = new Counter('capacity_preflight_verified_users');
const observedMs = new Trend('capacity_observed_confirmation_ms', true);
const serverMs = new Trend('capacity_server_receipt_to_projection_ms', true);
const trendNames = ['collection_ingress_ack_ms', 'collection_decision_ms', 'collection_projection_ms',
  'collection_queue_age_ms', 'capacity_observed_confirmation_ms', 'capacity_server_receipt_to_projection_ms'];
const thresholds = { ...fabric.options.thresholds };
for (const name of ['reconciliation_errors', 'unexpected_outcomes', 'auth_losses']) {
  thresholds['capacity_' + name] = [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '3s' }];
}
for (const cell of cells) {
  if (!/^[0-9a-f-]{36}$/i.test(cell || '')) throw new Error('Invalid cell UUID.');
  for (const name of names) thresholds[`capacity_${name}{cell_id:${cell}}`] = ['count>=0'];
  for (const name of trendNames) {
    thresholds[`${name}{cell_id:${cell}}`] = fabric.options.thresholds[name] || ['min>=0'];
  }
}
export const options = { ...fabric.options, thresholds,
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'p(99)', 'max'] };
function add(name, count = 1, tags) { counters[name].add(count, tags); }
function tagDevice(device) { execution.vu.metrics.tags.cell_id = device.cell_id; }
function headers(device) {
  return { apikey: __ENV.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${device.access_token}`, 'Content-Type': 'application/json' };
}
function readRows(path, device, operation) {
  const response = http.get(`${base}${path}`, {
    headers: headers(device), timeout: '10s', tags: { operation, profile, cell_id: device.cell_id },
  });
  if (response.status === 401 || response.status === 403) add('auth_losses');
  if (response.status !== 200) return null;
  try { return response.json(); } catch { return null; }
}
function probeIdentity(device) {
  const user = readRows('/auth/v1/user', device, 'capacity_auth_check');
  const rows = readRows('/rest/v1/operator_sessions?select=id,auth_user_id,cell_id,machine_id,ended_at,revoked_at,expires_at&id=eq.'
    + device.operator_session_id, device, 'capacity_session_check');
  let valid = false;
  try {
    if (user && Array.isArray(rows) && rows.length === 1) {
      assertVerifiedCollectionSession(device, user, rows[0]); valid = true;
    }
  } catch { valid = false; }
  if (!valid) add('auth_losses');
  check(valid, { 'identity and authorized operational session preserved': value => value });
}
function reconcile(device, ids, started) {
  const tuple = encodeURIComponent('(' + ids.map(id => `"${id}"`).join(',') + ')');
  const receiptRows = readRows('/rest/v1/coletas_producao?select=client_event_id,received_at_db,decision_committed_at,projected_at,dead_lettered_at&client_event_id=in.'
    + tuple, device, 'capacity_verify_receipts');
  const ledgerRows = readRows('/rest/v1/production_stage_readings?select=client_event_id,status&pipeline_version=eq.3&client_event_id=in.'
    + tuple, device, 'capacity_verify_ledger');
  if (!Array.isArray(receiptRows) || !Array.isArray(ledgerRows)) { add('reconciliation_errors', ids.length); return; }
  const expectedIds = new Set(ids);
  const rm = new Map(receiptRows.map(r => [r.client_event_id, r]));
  const lm = new Map(ledgerRows.map(r => [r.client_event_id, r]));
  const exact = receiptRows.length === ids.length && ledgerRows.length === ids.length
    && rm.size === ids.length && lm.size === ids.length
    && receiptRows.every(r => expectedIds.has(r.client_event_id))
    && ledgerRows.every(r => expectedIds.has(r.client_event_id));
  if (!exact) add('reconciliation_errors');
  check(exact, { 'one receipt and canonical decision per scheduled event': value => value });
  for (const id of ids) {
    const r = rm.get(id), l = lm.get(id);
    if (!r || !l) continue;
    add('verified_receipts');
    if (r.decision_committed_at) add('verified_decisions');
    if (r.projected_at) add('verified_projections');
    if (l.status === 'approved') add('approved_pieces');
    if (['blocked', 'duplicated'].includes(l.status)) add('blocked_or_duplicate');
    if (profile !== 'contention_piece' && l.status !== 'approved') add('unexpected_outcomes');
    if (r.dead_lettered_at || !r.decision_committed_at || !r.projected_at) add('reconciliation_errors');
    if (r.projected_at && l.status === 'approved') add('approved_projected_pieces');
    if (r.projected_at) {
      const lag = Date.parse(r.projected_at) - Date.parse(r.received_at_db);
      if (Number.isFinite(lag) && lag >= 0) serverMs.add(lag); else add('reconciliation_errors');
      observedMs.add(Date.now() - started); // Upper bound including verification reads, not UI latency.
    }
  }
}
function run(name, scenario, size, data, contention = false) {
  const iteration = Number(execution.scenario.iterationInTest);
  const index = contention ? Number(execution.vu.idInTest) - 1 : iteration % devices.length;
  const device = devices[index]; tagDevice(device);
  const eventIndex = contention ? index : iteration;
  const ids = Array.from({ length: size }, (_, j) => contention
    ? `k6-v3:${runId}:${scenario}:${eventIndex}` : `k6-v3:${runId}:${scenario}:${eventIndex}:${j}`);
  add('scheduled_unique_events', size);
  const start = Date.now(); fabric[name](data); reconcile(device, ids, start);
}
export function setup() {
  const result = fabric.setup(); // Remote Auth/RLS verifies every distinct fixture identity.
  for (const d of devices) verifiedUsers.add(1, { cell_id: d.cell_id });
  for (const cell of cells) for (const name of names) add(name, 0, { cell_id: cell });
  return result;
}
export function smoke(d) { run('smoke', 'smoke', 1, d); }
export function nominal(d) { run('nominal', 'nominal', 1, d); }
export function burst(d) { run('burst', 'burst', 1, d); }
export function microbatch(d) { run('microbatch', 'microbatch', 25, d); }
export function priorityReplaySeed(d) { run('priorityReplaySeed', 'priority_replay_seed', 25, d); }
export function priorityLive(d) { run('priorityLive', 'priority_live', 1, d); }
export function priorityReplay(d) { run('priorityReplay', 'priority_replay', 1, d); }
export function idempotency(d) { run('idempotency', 'idempotency', 1, d); }
export function contentionSamePiece(d) { run('contentionSamePiece', 'contention_piece', 1, d, true); }
export function contentionSameCellLot(d) { run('contentionSameCellLot', 'contention_cell_lot', 1, d, true); }
export function connectedDevice(d) {
  const device = devices[(Number(execution.vu.idInTest) - 1) % 100];
  tagDevice(device); probeIdentity(device); fabric.connectedDevice(d); probeIdentity(device);
}
export function teardown(d) { fabric.teardown(d); }
export function handleSummary(data) {
  const metrics = data.metrics || {};
  const value = (name, key, cell = null) => metrics[cell ? `${name}{cell_id:${cell}}` : name]?.values?.[key] ?? null;
  const durationSeconds = (data.state?.testRunDurationMs || 0) / 1000;
  const failed = Object.entries(metrics).filter(([,m]) => Object.values(m.thresholds || {}).some(t => t.ok === false)).map(([name]) => name);
  const byCell = cells.map(cell => {
    const count = value('capacity_approved_projected_pieces', 'count', cell);
    return { cell_id: cell, configured_users: exercisedDevices.filter(d => d.cell_id === cell).length,
      scheduled_unique_events: value('capacity_scheduled_unique_events', 'count', cell),
      verified_receipts: value('capacity_verified_receipts', 'count', cell),
      verified_decisions: value('capacity_verified_decisions', 'count', cell),
      verified_projections: value('capacity_verified_projections', 'count', cell),
      approved_projected_pieces: count,
      approved_projected_per_second_over_whole_run: count !== null && durationSeconds > 0 ? count / durationSeconds : null,
      ack_p95_ms: value('collection_ingress_ack_ms', 'p(95)', cell),
      decision_p95_ms: value('collection_decision_ms', 'p(95)', cell),
      projection_p95_ms: value('collection_projection_ms', 'p(95)', cell),
      observed_confirmation_p95_ms: value('capacity_observed_confirmation_ms', 'p(95)', cell),
      server_receipt_to_projection_p95_ms: value('capacity_server_receipt_to_projection_ms', 'p(95)', cell),
      auth_losses: value('capacity_auth_losses', 'count', cell) };
  });
  const total = value('capacity_scheduled_unique_events', 'count');
  const report = { run_id: runId, target: 'smnsihksrhzbkhcbdjfu', profile,
    slo_profile: __ENV.K6_SLO_PROFILE || 'production',
    status: !total ? 'NO_MEASUREMENT' : failed.length ? 'NO_GO' : 'PROFILE_PASSED_NOT_MAXIMUM_CAPACITY',
    verified_preflight_users: value('capacity_preflight_verified_users', 'count'),
    elapsed_whole_run_seconds: durationSeconds, failed_thresholds: failed, cells: byCell,
    caveats: ['Counts are distinct events per cell, not globally distinct physical pieces across a route.',
      'Extra receipt and ledger reads are part of this measured workload.',
      'Average uses the whole k6 run including setup/drain, not a peak or sustained plateau.',
      'Authenticated identities are not VUs, database connections or physical devices.',
      'No browser rendering, IndexedDB, physical scanner, token refresh or reconnect certification.',
      'A passing profile is one measured operating point, never proof of maximum capacity.'] };
  const text = ['# AC.Prod - capacidade por celula', '', `Estado: ${report.status}`, `Perfil: ${profile}`,
    `Usuarios verificados no preflight: ${report.verified_preflight_users ?? 'N/D'}`, '',
    '| Celula | Eventos programados | Recibos | Pecas aprovadas e projetadas | ACK p95 (ms) |', '|---|---:|---:|---:|---:|',
    ...byCell.map(c => `| ${c.cell_id} | ${c.scheduled_unique_events ?? 'N/D'} | ${c.verified_receipts ?? 'N/D'} | ${c.approved_projected_pieces ?? 'N/D'} | ${c.ack_p95_ms ?? 'N/D'} |`),
    '', 'Limites de interpretacao:', ...report.caveats.map(c => '- ' + c), ''].join('\n');
  return { 'artifacts/k6-capacity/system-summary.json': JSON.stringify(data, null, 2),
    'artifacts/k6-capacity/capacity-by-cell.json': JSON.stringify(report, null, 2),
    'artifacts/k6-capacity/capacity-by-cell.md': text, stdout: '\n' + text + '\n' };
}

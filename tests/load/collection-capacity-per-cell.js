/* Capacity reporting over the existing V3 workload; no alternate ingress,
 * bypassed authentication, new database permissions, or automatic fixture seed.
 * A projected receipt is NOT evidence of browser rendering or physical scanning.
 */
import * as fabric from './collection-fabric-v3.js';
import http from 'k6/http';
import execution from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { assertVerifiedCollectionSession } from './collection-load-preflight.js';

const fixture = JSON.parse(open(__ENV.K6_FIXTURES));
const devices = fixture.devices;
const cells = [...new Set(devices.map(d => d.cell_id))];
const profile = (__ENV.K6_PROFILE || 'smoke').toLowerCase();
const base = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const runId = __ENV.K6_RUN_ID;

const scheduled = new Counter('capacity_scheduled_unique_events');
const receipts = new Counter('capacity_verified_receipts');
const decisions = new Counter('capacity_verified_decisions');
const projections = new Counter('capacity_verified_projections');
const approved = new Counter('capacity_approved_pieces');
const synchronized = new Counter('capacity_approved_projected_pieces');
const blocked = new Counter('capacity_blocked_or_duplicate');
const errors = new Counter('capacity_reconciliation_errors');
const unexpected = new Counter('capacity_unexpected_outcomes');
const authLosses = new Counter('capacity_auth_losses');
const verifiedUsers = new Counter('capacity_preflight_verified_users');
const observedMs = new Trend('capacity_observed_confirmation_ms', true);
const serverMs = new Trend('capacity_server_receipt_to_projection_ms', true);
const countNames = ['capacity_scheduled_unique_events', 'capacity_verified_receipts',
  'capacity_verified_decisions', 'capacity_verified_projections', 'capacity_approved_pieces',
  'capacity_approved_projected_pieces', 'capacity_blocked_or_duplicate',
  'capacity_reconciliation_errors', 'capacity_unexpected_outcomes', 'capacity_auth_losses'];
const trendNames = ['collection_ingress_ack_ms', 'collection_decision_ms',
  'collection_projection_ms', 'collection_queue_age_ms',
  'capacity_observed_confirmation_ms', 'capacity_server_receipt_to_projection_ms'];
const thresholds = { ...fabric.options.thresholds,
  capacity_reconciliation_errors: ['count==0'],
  capacity_unexpected_outcomes: ['count==0'],
  capacity_auth_losses: ['count==0'],
};
for (const cell of cells) {
  if (!/^[0-9a-f-]{36}$/i.test(cell || '')) throw new Error('Invalid cell UUID.');
  for (const name of countNames) thresholds[`${name}{cell_id:${cell}}`] = ['count>=0'];
  for (const name of trendNames) {
    // Keep original production/test latency gates for EACH cell, not only globally.
    thresholds[`${name}{cell_id:${cell}}`] = fabric.options.thresholds[name] || ['min>=0'];
  }
}
export const options = { ...fabric.options, thresholds,
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
};

function tagDevice(device) {
  execution.vu.metrics.tags.cell_id = device.cell_id;
}
function headers(device) {
  return { apikey: __ENV.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${device.access_token}`, 'Content-Type': 'application/json' };
}
function readRows(path, device, operation) {
  const response = http.get(`${base}${path}`, {
    headers: headers(device), timeout: '10s', tags: { operation, profile, cell_id: device.cell_id },
  });
  if (response.status === 401 || response.status === 403) authLosses.add(1);
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
  if (!valid) authLosses.add(1);
  check(valid, { 'identity and authorized operational session preserved': value => value });
}
function reconcile(device, ids, started) {
  const tuple = encodeURIComponent('(' + ids.map(id => `"${id}"`).join(',') + ')');
  const receiptRows = readRows('/rest/v1/coletas_producao?select=client_event_id,received_at_db,decision_committed_at,projected_at,dead_lettered_at&client_event_id=in.'
    + tuple, device, 'capacity_verify_receipts');
  const ledgerRows = readRows('/rest/v1/production_stage_readings?select=client_event_id,status&pipeline_version=eq.3&client_event_id=in.'
    + tuple, device, 'capacity_verify_ledger');
  if (!Array.isArray(receiptRows) || !Array.isArray(ledgerRows)) {
    errors.add(ids.length); return;
  }
  const expectedIds = new Set(ids);
  const rm = new Map(receiptRows.map(r => [r.client_event_id, r]));
  const lm = new Map(ledgerRows.map(r => [r.client_event_id, r]));
  const exact = receiptRows.length === ids.length && ledgerRows.length === ids.length
    && rm.size === ids.length && lm.size === ids.length
    && receiptRows.every(r => expectedIds.has(r.client_event_id))
    && ledgerRows.every(r => expectedIds.has(r.client_event_id));
  if (!exact) errors.add(1);
  check(exact, { 'one receipt and canonical decision per scheduled event': value => value });
  for (const id of ids) {
    const r = rm.get(id), l = lm.get(id);
    if (!r || !l) continue;
    receipts.add(1);
    if (r.decision_committed_at) decisions.add(1);
    if (r.projected_at) projections.add(1);
    if (l.status === 'approved') approved.add(1);
    if (['blocked', 'duplicated'].includes(l.status)) blocked.add(1);
    if (profile !== 'contention_piece' && l.status !== 'approved') unexpected.add(1);
    if (r.dead_lettered_at || !r.decision_committed_at || !r.projected_at) errors.add(1);
    if (r.projected_at && l.status === 'approved') synchronized.add(1);
    if (r.projected_at) {
      const lag = Date.parse(r.projected_at) - Date.parse(r.received_at_db);
      if (Number.isFinite(lag) && lag >= 0) serverMs.add(lag);
      else errors.add(1);
      // Conservative client-observed bound, including the extra verification reads.
      observedMs.add(Date.now() - started);
    }
  }
}
function run(name, scenario, size, data, contention = false) {
  const iteration = Number(execution.scenario.iterationInTest);
  const index = contention ? Number(execution.vu.idInTest) - 1 : iteration % devices.length;
  const device = devices[index];
  tagDevice(device);
  const eventIndex = contention ? index : iteration;
  const ids = Array.from({ length: size }, (_, j) => contention
    ? `k6-v3:${runId}:${scenario}:${eventIndex}`
    : `k6-v3:${runId}:${scenario}:${eventIndex}:${j}`);
  scheduled.add(size);
  const start = Date.now();
  fabric[name](data);
  reconcile(device, ids, start);
}
export function setup() {
  const result = fabric.setup(); // Includes remote Auth/RLS checks for every distinct identity.
  for (const d of devices) verifiedUsers.add(1, { cell_id: d.cell_id });
  for (const metric of [errors, unexpected, authLosses]) metric.add(0);
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
  tagDevice(device); probeIdentity(device);
  fabric.connectedDevice(d);
  probeIdentity(device);
}
export function teardown(d) { fabric.teardown(d); }

export function handleSummary(data) {
  const metrics = data.metrics || {};
  const value = (name, key, cell = null) => metrics[cell ? `${name}{cell_id:${cell}}` : name]?.values?.[key] ?? null;
  const durationSeconds = (data.state?.testRunDurationMs || 0) / 1000;
  const failed = Object.entries(metrics).filter(([,m]) =>
    Object.values(m.thresholds || {}).some(t => t.ok === false)).map(([name]) => name);
  const byCell = cells.map(cell => {
    const count = value('capacity_approved_projected_pieces', 'count', cell);
    return { cell_id: cell, configured_users: devices.filter(d => d.cell_id === cell).length,
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
      auth_losses: value('capacity_auth_losses', 'count', cell),
    };
  });
  const total = value('capacity_scheduled_unique_events', 'count');
  const report = { run_id: runId, target: 'smnsihksrhzbkhcbdjfu', profile,
    slo_profile: __ENV.K6_SLO_PROFILE || 'production',
    status: !total ? 'NO_MEASUREMENT' : failed.length ? 'NO_GO' : 'PROFILE_PASSED_NOT_MAXIMUM_CAPACITY',
    verified_preflight_users: value('capacity_preflight_verified_users', 'count'),
    elapsed_whole_run_seconds: durationSeconds, failed_thresholds: failed, cells: byCell,
    caveats: [
      'Counts refer to distinct events per cell, not globally distinct physical pieces across a route.',
      'Extra receipt and ledger reads are part of this measured workload.',
      'The reported average uses the whole k6 run, including setup/drain; it is not a peak or sustained plateau rate.',
      'Authenticated identities are not interchangeable with VUs, database connections or physical devices.',
      'No browser rendering, IndexedDB, physical scanner, token refresh or reconnect certification is provided by this script.',
      'A passing profile is one measured operating point, never proof of the maximum capacity.',
    ],
  };
  const text = ['# AC.Prod - capacidade por celula', '', `Estado: ${report.status}`, `Perfil: ${profile}`,
    `Usuarios verificados no preflight: ${report.verified_preflight_users ?? 'N/D'}`, '',
    '| Celula | Eventos programados | Recibos | Pecas aprovadas e projetadas | ACK p95 (ms) |',
    '|---|---:|---:|---:|---:|',
    ...byCell.map(c => `| ${c.cell_id} | ${c.scheduled_unique_events ?? 'N/D'} | ${c.verified_receipts ?? 'N/D'} | ${c.approved_projected_pieces ?? 'N/D'} | ${c.ack_p95_ms ?? 'N/D'} |`),
    '', 'Limites de interpretacao:', ...report.caveats.map(c => '- ' + c), '',
  ].join('\n');
  return { 'artifacts/k6-capacity/system-summary.json': JSON.stringify(data, null, 2),
    'artifacts/k6-capacity/capacity-by-cell.json': JSON.stringify(report, null, 2),
    'artifacts/k6-capacity/capacity-by-cell.md': text,
    stdout: '\n' + text + '\n',
  };
}

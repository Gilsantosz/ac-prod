import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('tests/load/collection-capacity-per-cell.js', 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const CELL = '10000000-0000-4000-a000-000000000001';
function harness({ profile = 'smoke', outcome = 'approved', wrongId = false, deviceCount = 1 } = {}) {
  const samples = new Map();
  const checks = [];
  const execution = { vu: { idInTest: 1, metrics: { tags: {} } }, scenario: { iterationInTest: 0 } };
  class Metric {
    constructor(name) { this.name = name; }
    add(value, tags = {}) {
      const list = samples.get(this.name) || [];
      list.push({ value, tags: { ...execution.vu.metrics.tags, ...tags } });
      samples.set(this.name, list);
    }
  }
  const devices = Array.from({ length: deviceCount }, (_, i) => ({
    cell_id: i ? '20000000-0000-4000-a000-000000000001' : CELL,
    access_token: 'NON_AUTHENTICATING_OFFLINE_TEST_PLACEHOLDER', operator_session_id: 'offline-session',
  }));
  const fabric = new Proxy({ options: { thresholds: {}, scenarios: {} }, setup: () => ({}) }, {
    get: (target, key) => key in target ? target[key] : () => {},
  });
  const id = 'k6-v3:offline:' + profile + ':0' + (profile === 'contention_piece' ? '' : ':0');
  const ctx = vm.createContext({
    fabric, execution, Counter: Metric, Trend: Metric, Date, console,
    check: (value, definitions) => { const ok = Object.values(definitions).every(fn => fn(value)); checks.push(ok); return ok; },
    __ENV: { K6_FIXTURES: 'not-a-real-fixture', K6_PROFILE: profile, K6_RUN_ID: 'offline', SUPABASE_URL: 'https://smnsihksrhzbkhcbdjfu.supabase.co' },
    open: () => JSON.stringify({ devices }),
    assertVerifiedCollectionSession: () => {},
    http: { get: url => ({ status: 200, json: () => url.includes('coletas_producao')
      ? [{ client_event_id: wrongId ? 'WRONG_EVENT' : id, received_at_db: '2026-09-07T00:00:00Z', decision_committed_at: '2026-09-07T00:00:00.100Z', projected_at: '2026-09-07T00:00:00.200Z' }]
      : [{ client_event_id: id, status: outcome }] }) },
  });
  vm.runInContext(source + '\nglobalThis.api = {smoke,idempotency,contentionSamePiece,handleSummary,options};', ctx);
  return { api: ctx.api, checks, count: name => (samples.get(name) || []).reduce((sum, s) => sum + s.value, 0), samples };
}

test('approved receipt + canonical ledger + projection count as one synchronized piece', () => {
  const h = harness(); h.api.smoke();
  assert.equal(h.count('capacity_scheduled_unique_events'), 1);
  assert.equal(h.count('capacity_approved_projected_pieces'), 1);
  assert.equal(h.count('capacity_reconciliation_errors'), 0);
  assert.equal(h.samples.get('capacity_verified_receipts')[0].tags.cell_id, CELL);
  assert.ok(h.checks.every(Boolean));
});
test('wrong receipt identifier is not accepted as a matching ACK', () => {
  const h = harness({ wrongId: true }); h.api.smoke();
  assert.ok(h.count('capacity_reconciliation_errors') > 0);
  assert.equal(h.count('capacity_approved_projected_pieces'), 0);
});
test('blocked decision can be projected but is not approved production', () => {
  const h = harness({ outcome: 'blocked' }); h.api.smoke();
  assert.equal(h.count('capacity_verified_projections'), 1);
  assert.equal(h.count('capacity_approved_projected_pieces'), 0);
  assert.equal(h.count('capacity_unexpected_outcomes'), 1);
});
test('idempotency profile reports one physical-stage event, not five transport deliveries', () => {
  const h = harness({ profile: 'idempotency' }); h.api.idempotency();
  assert.equal(h.count('capacity_scheduled_unique_events'), 1);
  assert.equal(h.count('capacity_approved_projected_pieces'), 1);
});
test('expected duplicate under same-piece contention is not extra production or unexpected outcome', () => {
  const h = harness({ profile: 'contention_piece', outcome: 'duplicated' }); h.api.contentionSamePiece();
  assert.equal(h.count('capacity_blocked_or_duplicate'), 1);
  assert.equal(h.count('capacity_approved_projected_pieces'), 0);
  assert.equal(h.count('capacity_unexpected_outcomes'), 0);
});
test('no samples means NO_MEASUREMENT, never a capacity approval', () => {
  const h = harness();
  const files = h.api.handleSummary({ metrics: {}, state: { testRunDurationMs: 1 } });
  const report = JSON.parse(files['artifacts/k6-capacity/capacity-by-cell.json']);
  assert.equal(report.status, 'NO_MEASUREMENT');
  assert.equal(report.cells[0].approved_projected_per_second_over_whole_run, null);
});
test('report divides verified pieces by the explicitly named whole-run denominator', () => {
  const h = harness();
  const files = h.api.handleSummary({ state: { testRunDurationMs: 60000 }, metrics: {
    capacity_scheduled_unique_events: { values: { count: 120 } },
    ['capacity_approved_projected_pieces{cell_id:' + CELL + '}']: { values: { count: 120 } },
  } });
  const report = JSON.parse(files['artifacts/k6-capacity/capacity-by-cell.json']);
  assert.equal(report.cells[0].approved_projected_per_second_over_whole_run, 2);
  assert.equal(report.status, 'PROFILE_PASSED_NOT_MAXIMUM_CAPACITY');
});
test('failed thresholds remain NO_GO in exported report', () => {
  const h = harness();
  const files = h.api.handleSummary({ metrics: {
    capacity_scheduled_unique_events: { values: { count: 1 } },
    capacity_reconciliation_errors: { thresholds: { 'count==0': { ok: false } } },
  } });
  assert.equal(JSON.parse(files['artifacts/k6-capacity/capacity-by-cell.json']).status, 'NO_GO');
});

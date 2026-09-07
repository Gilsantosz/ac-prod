import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, uniqueCodeBudget, validateFixture, peakConcurrent, decideRun, TARGET, PROJECT_REF } from './plan.mjs';
const now = Date.now();
const uuid = n => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
function fixture() {
  const p = buildPlan();
  const identity = (a, i) => ({ role: a.role, access_token: JSON.stringify({ sub: uuid(i + 1), role: 'authenticated', iss: `${TARGET}/auth/v1`, exp: Math.floor(now / 1000) + 7200 }), device_id: uuid(i + 2001) });
  return { project_ref: PROJECT_REF, run_id: 'offline-test', operators: p.accounts.slice(0, 150).map((a, i) => ({ ...identity(a, i), stage: p.workstations[i].stage, operator_session_id: uuid(i + 4001), machine_id: uuid(i + 5001), cell_id: uuid(i + 6001), codes: i < 145 ? [String(i + 1).padStart(8, '0')] : [] })), management: p.accounts.slice(150).map((a, i) => ({ ...identity(a, i + 150), batch_id: uuid(9001) })) };
}
test('145 productive + five reserves, exactly 1150 planned accounts', () => { const p = buildPlan(); assert.equal(p.workstations.filter(s => s.collects).length, 145); assert.equal(p.accounts.length, 1150); assert.equal(p.auth_users_created, 0); });
test('1 admin, 99 managers, 900 viewers, no embedded credentials', () => { const p = buildPlan(); for (const [role, count] of [['admin',1],['manager',99],['viewer',900]]) assert.equal(p.accounts.filter(a => a.role === role).length, count); assert.ok(!JSON.stringify(p).includes('access_token')); });
test('every planned email is unique and not deliverable to real employees', () => { const a = buildPlan().accounts; assert.equal(new Set(a.map(x => x.planned_email)).size, 1150); assert.ok(a.every(x => x.planned_email.endsWith('@example.invalid'))); });
test('300 pieces cannot supply 145 stations at one event per 5 sec for 10 min', () => assert.equal(uniqueCodeBudget(145, 600, 5), 17400));
test('complete fixture has 1150 distinct identities', () => assert.equal(validateFixture(fixture(), JSON.parse, { nowMs: now, minCodes: 1 }).identities, 1150));
test('shared identity cannot simulate a second person', () => { const f = fixture(); f.management[0].access_token = f.operators[0].access_token; assert.throws(() => validateFixture(f, JSON.parse)); });
test('production target is always refused', () => { const f = fixture(); f.project_ref = 'uozuzdfvnufsjsonswag'; assert.throws(() => validateFixture(f, JSON.parse)); });
test('service role is not an operator credential', () => { const f = fixture(); const t = JSON.parse(f.operators[0].access_token); t.role = 'service_role'; f.operators[0].access_token = JSON.stringify(t); assert.throws(() => validateFixture(f, JSON.parse)); });
test('expired token is refused before remote requests', () => { const f = fixture(); const t = JSON.parse(f.operators[0].access_token); t.exp = 1; f.operators[0].access_token = JSON.stringify(t); assert.throws(() => validateFixture(f, JSON.parse)); });
test('eight digits including leading zeros, no numeric coercion', () => { const f = fixture(); f.operators[0].codes = [1]; assert.throws(() => validateFixture(f, JSON.parse)); });
test('no code reuse across cells in independent-stage capacity scenario', () => { const f = fixture(); f.operators[1].codes = f.operators[0].codes; assert.throws(() => validateFixture(f, JSON.parse)); });
test('reserve is logged in but never contributes production', () => { const f = fixture(); f.operators[149].codes = ['99000001']; assert.throws(() => validateFixture(f, JSON.parse)); });
test('wrong productive allocation is refused', () => { const f = fixture(); f.operators[0].stage = 'edge'; assert.throws(() => validateFixture(f, JSON.parse)); });
test('sequential logins do not prove concurrency', () => assert.equal(peakConcurrent([{identity_id:'a',start_ms:0,end_ms:10},{identity_id:'b',start_ms:10,end_ms:20}]),1));
test('overlapping distinct presence intervals prove concurrency within the observed window', () => assert.equal(peakConcurrent([{identity_id:'a',start_ms:0,end_ms:20},{identity_id:'b',start_ms:10,end_ms:30}]),2));
test('empty metrics cannot generate a GO', () => { assert.equal(decideRun({}), 'NO_MEASUREMENT'); assert.equal(decideRun({ remote_measurement:true }), 'INCOMPLETE_EVIDENCE'); });
test('protocol success does not certify a complete MES', () => assert.equal(decideRun({remote_measurement:true, integrity_errors:0, auth_losses:0, failed_thresholds:[], verified_identities:1150, peak_concurrent_identities:1150, offered_events:145, approved_projected:145}), 'PARTIAL_PROFILE_ONLY'));
test('integrity failure is NO_GO, even with incomplete counts', () => assert.equal(decideRun({remote_measurement:true, integrity_errors:1}), 'NO_GO'));

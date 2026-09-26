import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './gate.mjs';
import { TARGET,LIMITS } from './plan.mjs';
// Synthetic unit-test inputs ONLY. They are never emitted as capacity evidence.
const sample = () => ({target:TARGET,real_auth:true,real_database:true,real_realtime:true,
 reconciliation_complete:true,telemetry_complete:true,scenarios_a_to_k_complete:true,
 sessions_min:200,collectors_min:100,soak_seconds:3600,rate_per_minute:2000,
 metrics:{...LIMITS,error_rate:0.0009,lost_collections:0,duplicated_production:0,involuntary_logouts:0,deadlocks:0,counter_divergence:0,dropped_iterations:0}});
test('empty evidence fails closed',()=>assert.equal(evaluate().status,'FAIL'));
test('complete synthetic unit sample passes evaluator only',()=>assert.equal(evaluate(sample()).status,'PASS'));
test('null latency is not coerced to zero',()=>{const e=sample();e.metrics.ack_p95_ms=null;assert.equal(evaluate(e).status,'FAIL');});
test('zero-error claim without reconciliation is rejected',()=>{const e=sample();e.reconciliation_complete=false;assert.equal(evaluate(e).status,'FAIL');});
test('strict error rate excludes exactly 0.1 percent',()=>{const e=sample();e.metrics.error_rate=0.001;assert.equal(evaluate(e).status,'FAIL');});
test('relaxed latency thresholds cannot pass',()=>{const e=sample();e.metrics.processing_p99_ms=2000;assert.equal(evaluate(e).status,'FAIL');});
test('registered identities do not prove concurrent sessions',()=>{const e=sample();e.sessions_min=null;assert.equal(evaluate(e).status,'FAIL');});
test('missing scenario cannot be hidden by nominal success',()=>{const e=sample();e.scenarios_a_to_k_complete=false;assert.equal(evaluate(e).status,'FAIL');});
test('unknown resource telemetry blocks certification',()=>{const e=sample();e.telemetry_complete=false;assert.equal(evaluate(e).status,'FAIL');});

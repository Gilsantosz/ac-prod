/** Isolated API diagnostic only. Provisioning, login, Realtime and browser evidence are separate gates. */
import http from 'k6/http';
import execution from 'k6/execution';
import encoding from 'k6/encoding';
import { check, fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { TARGET, PROJECT_REF, ALLOCATION, validateFixture } from '../../scripts/capacity/mes-1150/plan.mjs';
import { assertIsolatedCollectionTarget, assertVerifiedCollectionSession } from './collection-load-preflight.js';
const mode = __ENV.MES_MODE || 'access';
const duration = Number(__ENV.MES_DURATION_SECONDS || 180);
const cadence = Number(__ENV.MES_SCAN_INTERVAL_SECONDS || 5);
const sequenceBase = Number(__ENV.K6_SEQUENCE_BASE);
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
try { assertIsolatedCollectionTarget(__ENV.SUPABASE_URL, __ENV.K6_TARGET, __ENV.K6_CONFIRM_WRITES); } catch (e) { fail(e.message); }
if (!['access', 'mixed'].includes(mode) || !Number.isInteger(duration) || duration < 30 || duration > 600
  || !Number.isFinite(cadence) || cadence < 1 || !Number.isSafeInteger(sequenceBase) || sequenceBase < 1
  || !__ENV.K6_FIXTURES || !anonKey) fail('Invalid isolated fixture, mode, duration, cadence or reserved sequence.');
const fixture = JSON.parse(open(__ENV.K6_FIXTURES));
const identities = [...(fixture.operators || []), ...(fixture.management || [])];
const sent = new Counter('mes_unique_events_sent'), projected = new Counter('mes_approved_projected');
const queries = new Counter('mes_management_queries'), authLoss = new Counter('mes_auth_losses');
const integrity = new Counter('mes_integrity_errors'), unavailable = new Counter('mes_query_errors');
const missed = new Counter('mes_missed_scan_slots'), actors = new Counter('mes_started_identities');
const ack = new Trend('mes_ack_ms', true), decision = new Trend('mes_decision_ms', true);
const projection = new Trend('mes_projection_ms', true), queriesMs = new Trend('mes_management_query_ms', true);
const thresholds = {
  checks: ['rate==1'], mes_started_identities: ['count==1150'],
  mes_auth_losses: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '5s' }],
  mes_integrity_errors: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '5s' }],
  mes_query_errors: ['count==0'], mes_management_query_ms: ['p(95)<2000'],
};
if (mode === 'mixed') {
  thresholds.mes_missed_scan_slots = ['count==0'];
  thresholds.mes_ack_ms = ['p(95)<250']; thresholds.mes_decision_ms = ['p(95)<800', 'p(99)<2000'];
  thresholds.mes_projection_ms = ['p(95)<500'];
  for (const [stage] of ALLOCATION) {
    for (const name of ['mes_unique_events_sent','mes_approved_projected']) thresholds[`${name}{stage:${stage}}`] = ['count>0'];
    for (const name of ['mes_ack_ms','mes_decision_ms','mes_projection_ms']) thresholds[`${name}{stage:${stage}}`] = thresholds[name];
  }
}
export const options = {
  scenarios: { authorized_identities: { executor:'per-vu-iterations', exec:'userScenario', vus:1150, iterations:1, maxDuration:`${duration + 60}s`, gracefulStop:'15s' } },
  setupTimeout:'5m', teardownTimeout:'30s', thresholds,
  summaryTrendStats:['min','med','p(95)','p(99)','max'],
  systemTags:['status','method','name','scenario','expected_response'],
};
function params(a, operation) { return { headers:{ apikey:anonKey, Authorization:`Bearer ${a.access_token}`, 'Content-Type':'application/json' }, timeout:'10s', tags:{ name:operation, stage:a.stage || 'management', role:a.role || 'operator' } }; }
function json(r) { try { return r.json(); } catch { return null; } }
function request(a, method, path, body, operation) {
  const r = http.request(method, `${TARGET}${path}`, body === undefined ? null : JSON.stringify(body), params(a,operation));
  if (r.status === 401 || r.status === 403) authLoss.add(1);
  return r;
}
export function setup() {
  validateFixture(fixture, token => JSON.parse(encoding.b64decode(token.split('.')[1], 'rawurl', 's')), {
    requiredSeconds: duration + 900, minCodes: mode === 'mixed' ? Math.ceil(duration / cadence) : 0,
  });
  // Structural decoding is not authentication. Every identity and profile is remotely verified.
  for (let i = 0; i < identities.length; i += 10) {
    const chunk = identities.slice(i, i + 10);
    const responses = http.batch(chunk.flatMap(a => [
      { method:'GET', url:`${TARGET}/auth/v1/user`, params:params(a,'verify_auth_identity') },
      { method:'GET', url:`${TARGET}/rest/v1/profiles?select=id,role,active&id=eq.${JSON.parse(encoding.b64decode(a.access_token.split('.')[1], 'rawurl', 's')).sub}`, params:params(a,'verify_profile') },
    ]));
    for (let j = 0; j < chunk.length; j += 1) {
      const a = chunk[j], r = responses[j * 2], profileResponse = responses[j * 2 + 1];
      const user = json(r), rows = json(profileResponse);
      if (r.status !== 200 || profileResponse.status !== 200 || !Array.isArray(rows) || rows.length !== 1
        || rows[0].id !== user?.id || rows[0].role !== (a.role || 'operator') || rows[0].active !== true) fail('Remote identity/profile preflight failed; no collection was sent.');
      if (a.operator_session_id) {
        const s = request(a,'GET',`/rest/v1/operator_sessions?select=id,auth_user_id,cell_id,machine_id,device_id,ended_at,revoked_at,expires_at&id=eq.${a.operator_session_id}`,undefined,'verify_operational_session');
        const sessions = json(s);
        if (s.status !== 200 || !Array.isArray(sessions) || sessions.length !== 1 || sessions[0].device_id !== a.device_id) fail('Operational context preflight failed.');
        try { assertVerifiedCollectionSession(a,user,sessions[0]); } catch (e) { fail(e.message); }
      }
    }
    sleep(0.2);
  }
  const h = request(identities[0],'POST','/rest/v1/rpc/get_collection_runtime_health_v3',{},'preflight_health');
  if (h.status !== 200 || json(h)?.ready !== true || json(h)?.structural_ready !== true) fail('Staging health is not ready.');
  for (const metric of [authLoss,integrity,unavailable,missed,sent,projected,queries]) metric.add(0);
  return { started_at_ms:Date.now()+2000 };
}
function collect(a, slot, n) {
  const id = `k6-mes:${fixture.run_id}:${slot}:${n}`;
  const stamp = Date.now();
  const event = { client_event_id:id, raw_value:a.codes[n], reader_type:'keyboard_barcode',
    captured_at_client:new Date(stamp).toISOString(), device_sequence:sequenceBase+n+1, quantity:1 };
  const batchId = `${sequenceBase.toString(16).padStart(8,'0').slice(-8)}-${slot.toString(16).padStart(4,'0')}-4000-a000-${n.toString(16).padStart(12,'0')}`;
  const response = request(a,'POST','/rest/v1/rpc/ingest_collection_batch_v3',{p_batch_id:batchId,p_device_id:a.device_id,
    p_events:{operator_session_id:a.operator_session_id,source_mode:'live',app_version:`k6-mes-${fixture.run_id}`,events:[event]}},'ingest_collection_batch_v3');
  sent.add(1); ack.add(response.timings.duration);
  const rows = json(response)?.results;
  const valid = response.status === 200 && Array.isArray(rows) && rows.length === 1
    && rows[0].client_event_id === id && rows[0].persisted === true && !rows[0].error_code;
  if (!check(valid,{'exact event has durable ACK':x=>x})) { integrity.add(1); return; }
  const deadline = Date.now()+10000;
  while (Date.now() < deadline) {
    const r = request(a,'GET',`/rest/v1/coletas_producao?select=client_event_id,received_at_db,decision_committed_at,projected_at,dead_lettered_at&client_event_id=eq.${encodeURIComponent(id)}`,undefined,'verify_receipt');
    const result = json(r);
    if (r.status !== 200 || !Array.isArray(result) || result.length !== 1 || result[0].client_event_id !== id || result[0].dead_lettered_at) { integrity.add(1); return; }
    const receipt = result[0];
    if (receipt.projected_at && receipt.decision_committed_at) {
      const l = request(a,'GET',`/rest/v1/production_stage_readings?select=client_event_id,status,machine_id&pipeline_version=eq.3&client_event_id=eq.${encodeURIComponent(id)}`,undefined,'verify_canonical_approval');
      const ledger = json(l);
      if (l.status !== 200 || !Array.isArray(ledger) || ledger.length !== 1 || ledger[0].client_event_id !== id || ledger[0].status !== 'approved' || ledger[0].machine_id !== a.machine_id) { integrity.add(1); return; }
      const d = Date.parse(receipt.decision_committed_at)-Date.parse(receipt.received_at_db);
      const p = Date.parse(receipt.projected_at)-Date.parse(receipt.decision_committed_at);
      if (!Number.isFinite(d) || !Number.isFinite(p) || d < 0 || p < 0) { integrity.add(1); return; }
      decision.add(d); projection.add(p); projected.add(1); return;
    }
    sleep(0.5);
  }
  integrity.add(1);
}
export function userScenario(data) {
  const slot = Number(execution.scenario.iterationInTest), a = identities[slot];
  if (!a) fail('Identity slot exceeds fixture.');
  execution.vu.metrics.tags.stage = a.stage || 'management'; execution.vu.metrics.tags.role = a.role || 'operator';
  sleep(Math.max(0,(data.started_at_ms-Date.now())/1000));
  const end = data.started_at_ms+duration*1000;
  actors.add(1);
  if (a.stage && a.stage !== 'reserve' && mode === 'mixed') {
    const planned = Math.ceil(duration/cadence);
    for (let n = 0; n < planned; n += 1) {
      const scheduled = data.started_at_ms+n*cadence*1000;
      if (Date.now() >= end) { missed.add(planned-n); break; }
      sleep(Math.max(0,(scheduled-Date.now())/1000));
      if (Date.now()-scheduled > cadence*1000) { missed.add(1); continue; }
      collect(a,slot,n);
    }
  } else {
    const batch = a.batch_id || fixture.management[0].batch_id;
    while (Date.now() < end) {
      for (const operation of ['get_general_lot_tracking','get_lot_route_stage_progress','get_lot_route_completion_metrics']) {
        const body = operation === 'get_general_lot_tracking' ? {p_batch_id:batch,p_limit:1} : {p_batch_id:batch};
        const r = request(a,'POST',`/rest/v1/rpc/${operation}`,body,operation);
        queries.add(1); queriesMs.add(r.timings.duration);
        if (r.status !== 200 || json(r) === null) unavailable.add(1);
      }
      sleep(Math.min(30,Math.max(0,(end-Date.now())/1000)));
    }
  }
  const r = request(a,'GET','/auth/v1/user',undefined,'verify_identity_end');
  if (r.status !== 200) authLoss.add(1);
  // Executor activity, NOT proof of a connected WebSocket/browser.
  console.log(JSON.stringify({type:'mes_executor_activity',slot,role:a.role || 'operator',stage:a.stage || 'management',start_ms:data.started_at_ms,end_ms:Date.now(),auth_ok_end:r.status===200}));
}
export function handleSummary(data) {
  const m = data.metrics || {}, count = name => m[name]?.values?.count ?? null;
  const failed = Object.entries(m).filter(([,v])=>Object.values(v.thresholds || {}).some(t=>t.ok === false)).map(([k])=>k);
  const hasMeasurement = Number(count('mes_started_identities') || 0)>0;
  const report = { project_ref:PROJECT_REF,run_id:fixture.run_id,mode,
    status:!hasMeasurement?'NO_MEASUREMENT':failed.length?'NO_GO':'PARTIAL_PROTOCOL_MEASUREMENT',
    measured_actor_starts:count('mes_started_identities'),offered_events:count('mes_unique_events_sent'),approved_projected:count('mes_approved_projected'),failed_thresholds:failed,
    maximum_mes_capacity:null,simultaneous_browser_sessions:null,source:'k6 protocol diagnostic',
    omissions:['Real login throughput and refresh','WebSocket delivery/latency','Rendered dashboards and IndexedDB','Full routes, replacement, rework and exports','Emergency-stop integration and sustained capacity'],
    caveats:['Fixture tokens must come from normal login. They are never minted by this script.',
      '145 productive workstations plus five reserves, not 150 collecting stations.',
      'Actor starts are not proof of 1150 simultaneous browser sessions.',
      'Missing scan slots fail the test; a slow loop cannot silently reduce offered load.',
      'Management and reserve reads use a selected test batch every 30 seconds, not every page in the MES.'],
  };
  return {'artifacts/mes-1150/api-summary.json':JSON.stringify(data,null,2),
    'artifacts/mes-1150/api-result.json':JSON.stringify(report,null,2),stdout:JSON.stringify(report,null,2)+'\n'};
}

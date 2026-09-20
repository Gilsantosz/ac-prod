import http from 'k6/http';
import execution from 'k6/execution';
import { check, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  assertProductionCollectionReadOnlyTarget,
  isFreshCollectionImmediateSnapshot,
} from './collection-load-preflight.js';

/*
 * Prova não mutante do caminho público PostgreSQL/PostgREST.
 * Não chama login, ingresso, fila, worker, projeção ou tabelas de produção.
 */

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const runId = __ENV.K6_RUN_ID || '';
const target = __ENV.K6_TARGET || '';
const confirmation = __ENV.K6_CONFIRM_READS || '';
const readProfile = (__ENV.K6_READONLY_PROFILE || 'smoke').toLowerCase();
const logicalDeviceCount = 1000;
const gateUrl = `${supabaseUrl}/rest/v1/rpc/get_public_collection_immediate_release`;

if (!supabaseUrl || !anonKey) fail('Defina SUPABASE_URL e SUPABASE_ANON_KEY.');
try { assertProductionCollectionReadOnlyTarget(supabaseUrl, target, confirmation); }
catch (error) { fail(error.message); }
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(runId)) {
  fail('K6_RUN_ID deve ter de 1 a 32 caracteres seguros e ser exclusivo da rodada.');
}
if (!['smoke', 'global'].includes(readProfile)) {
  fail('K6_READONLY_PROFILE deve ser smoke ou global.');
}

const requests = new Counter('collection_readonly_requests');
const gateFailures = new Counter('collection_public_gate_failures');
const gateLatency = new Trend('collection_public_gate_ms', true);

export const options = {
  maxRedirects: 0,
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: readProfile === 'global' ? {
    thousand_logical_devices_http_readonly: {
      executor: 'ramping-arrival-rate',
      exec: 'readPublicGate',
      startRate: 10,
      timeUnit: '1s',
      stages: [
        { duration: '1m', target: 35 },
        { duration: '1m', target: 40 },
        { duration: '10m', target: 40 },
        { duration: '30s', target: 0 },
      ],
      preAllocatedVUs: 100,
      maxVUs: 300,
      gracefulStop: '30s',
    },
  } : {
    public_gate_readonly_short_ramp: {
      executor: 'ramping-arrival-rate',
      exec: 'readPublicGate',
      startRate: 1,
      timeUnit: '1s',
      stages: [
        { duration: '5s', target: 10 },
        { duration: '10s', target: 35 },
        { duration: '10s', target: 40 },
        { duration: '20s', target: 40 },
        { duration: '5s', target: 0 },
      ],
      preAllocatedVUs: 50,
      maxVUs: 100,
      gracefulStop: '10s',
    },
  },
  thresholds: {
    checks: [{ threshold: 'rate==1', abortOnFail: true, delayAbortEval: '10s' }],
    dropped_iterations: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '15s' }],
    http_req_failed: [{ threshold: 'rate==0', abortOnFail: true, delayAbortEval: '10s' }],
    collection_public_gate_failures: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '10s' }],
    collection_readonly_requests: [readProfile === 'global' ? 'count>=28000' : 'count>=1450'],
    collection_public_gate_ms: [
      { threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'p(99)<2000', abortOnFail: true, delayAbortEval: '30s' },
    ],
    'http_req_duration{operation:public_immediate_gate}': [
      { threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '30s' },
      { threshold: 'p(99)<2000', abortOnFail: true, delayAbortEval: '30s' },
    ],
  },
  userAgent: `acprod-production-readonly-k6/${runId}/${readProfile}`,
};

function logicalDeviceId(iteration) {
  return `k6-readonly:${runId}:${String(iteration % logicalDeviceCount).padStart(4, '0')}`;
}

function parse(response) {
  try { return response.json(); } catch { return null; }
}

function gateReady(payload) {
  const flags = Object.values(payload?.schema_flags || {});
  return payload?.ready === true
    && isFreshCollectionImmediateSnapshot(payload)
    && payload?.transport === 'immediate_v3'
    && payload?.ingress_rpc === 'ingest_collection_batch_immediate_v3'
    && Number(payload?.max_events_per_request) === 5
    && payload?.projection === 'async_v3_outbox'
    && payload?.gate_migration_version === '20260913043419'
    && payload?.gate_release_version === '20260913_acprod_collection_immediate_owner_gate_v1_1'
    && flags.length >= 9
    && flags.every((value) => value === true);
}

function requestGate(iteration, phase) {
  const logicalId = logicalDeviceId(iteration);
  const response = http.get(gateUrl, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
      'X-ACProd-Logical-Device': logicalId,
    },
    redirects: 0,
    timeout: __ENV.K6_HTTP_TIMEOUT || '5s',
    tags: {
      operation: 'public_immediate_gate',
      phase,
      // Mantém cardinalidade baixa nas séries; o ID completo viaja só no header.
      device_shard: String(iteration % 20),
    },
  });
  const payload = parse(response);
  const valid = response.status === 200 && gateReady(payload);
  gateLatency.add(response.timings.duration, { phase });
  requests.add(1, { phase });
  if (!valid) gateFailures.add(1, { phase, status: String(response.status) });
  check(response, {
    'gate publico responde 200': () => response.status === 200,
    'gate publico confirma transporte imediato pronto': () => gateReady(payload),
  });
  return valid;
}

export function setup() {
  if (!requestGate(0, 'preflight')) {
    fail('Preflight do gate publico falhou; a rampa somente leitura nao foi iniciada.');
  }
  return { preflight_at: new Date().toISOString(), logical_devices: logicalDeviceCount };
}

export function readPublicGate() {
  requestGate(Number(execution.scenario.iterationInTest), 'ramp');
}

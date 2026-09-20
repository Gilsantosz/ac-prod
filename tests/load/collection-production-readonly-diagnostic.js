import http from 'k6/http';
import execution from 'k6/execution';
import { check, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { assertProductionCollectionReadOnlyTarget, isFreshCollectionImmediateSnapshot } from './collection-load-preflight.js';

/*
 * Diagnóstico GET-only: compara a borda Auth com o gate PostgreSQL na mesma
 * cadência. Nenhuma função mutante ou tabela produtiva é chamada.
 */

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const runId = __ENV.K6_RUN_ID || '';
const target = __ENV.K6_TARGET || '';
const confirmation = __ENV.K6_CONFIRM_READS || '';
const authHealthUrl = `${supabaseUrl}/auth/v1/health`;
const gateUrl = `${supabaseUrl}/rest/v1/rpc/get_public_collection_immediate_release`;

if (!supabaseUrl || !anonKey) fail('Defina SUPABASE_URL e SUPABASE_ANON_KEY.');
try { assertProductionCollectionReadOnlyTarget(supabaseUrl, target, confirmation); }
catch (error) { fail(error.message); }
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(runId)) {
  fail('K6_RUN_ID deve ter de 1 a 32 caracteres seguros.');
}

const authLatency = new Trend('diagnostic_auth_health_ms', true);
const gateLatency = new Trend('diagnostic_public_gate_ms', true);
const authRequests = new Counter('diagnostic_auth_health_requests');
const gateRequests = new Counter('diagnostic_public_gate_requests');
const authFailures = new Counter('diagnostic_auth_health_failures');
const gateFailures = new Counter('diagnostic_public_gate_failures');
const diagnosticRates = [1, 5, 10, 15];

const stepThresholds = Object.fromEntries(diagnosticRates.flatMap((rate) => ([
  [`diagnostic_auth_health_ms{step_rps:${rate}}`, ['p(95)<500', 'p(99)<1000']],
  [`diagnostic_public_gate_ms{step_rps:${rate}}`, ['p(95)<1000', 'p(99)<2000']],
])));

function stepScenario(endpoint, rate, startTime) {
  return {
    executor: 'constant-arrival-rate',
    exec: endpoint === 'auth_health' ? 'readAuthHealth' : 'readPublicGate',
    startTime,
    rate,
    timeUnit: '1s',
    duration: '20s',
    preAllocatedVUs: Math.max(5, rate * 2),
    maxVUs: Math.max(10, rate * 5),
    gracefulStop: '5s',
    tags: { endpoint, step_rps: String(rate) },
    env: { DIAGNOSTIC_STEP_RPS: String(rate) },
  };
}

export const options = {
  maxRedirects: 0,
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    auth_health_1rps: stepScenario('auth_health', 1, '0s'),
    public_gate_1rps: stepScenario('public_gate', 1, '0s'),
    auth_health_5rps: stepScenario('auth_health', 5, '25s'),
    public_gate_5rps: stepScenario('public_gate', 5, '25s'),
    auth_health_10rps: stepScenario('auth_health', 10, '50s'),
    public_gate_10rps: stepScenario('public_gate', 10, '50s'),
    auth_health_15rps: stepScenario('auth_health', 15, '75s'),
    public_gate_15rps: stepScenario('public_gate', 15, '75s'),
  },
  thresholds: {
    checks: [{ threshold: 'rate==1', abortOnFail: true, delayAbortEval: '10s' }],
    dropped_iterations: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '15s' }],
    http_req_failed: [{ threshold: 'rate==0', abortOnFail: true, delayAbortEval: '10s' }],
    diagnostic_auth_health_failures: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '10s' }],
    diagnostic_public_gate_failures: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '10s' }],
    diagnostic_auth_health_requests: ['count>=600'],
    diagnostic_public_gate_requests: ['count>=600'],
    diagnostic_auth_health_ms: [
      { threshold: 'p(95)<500', abortOnFail: true, delayAbortEval: '20s' },
      { threshold: 'p(99)<1000', abortOnFail: true, delayAbortEval: '20s' },
    ],
    diagnostic_public_gate_ms: [
      { threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '20s' },
      { threshold: 'p(99)<2000', abortOnFail: true, delayAbortEval: '20s' },
    ],
    // Os submétricos deixam o summary-export comparável por degrau. O aborto
    // permanece nos agregados para oferecer uma janela inicial de amostragem.
    ...stepThresholds,
  },
  userAgent: `acprod-readonly-diagnostic-k6/${runId}`,
};

function headers(logicalDevice) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
    'X-ACProd-Logical-Device': logicalDevice,
    'Cache-Control': 'no-store',
  };
}

function logicalDevice(endpoint) {
  const iteration = Number(execution.scenario.iterationInTest);
  return `k6-diagnostic:${runId}:${endpoint}:${String(iteration % 1000).padStart(4, '0')}`;
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

export function readAuthHealth() {
  const step = __ENV.DIAGNOSTIC_STEP_RPS || 'unknown';
  const response = http.get(authHealthUrl, {
    headers: headers(logicalDevice('auth')),
    redirects: 0,
    timeout: __ENV.K6_HTTP_TIMEOUT || '5s',
    tags: { operation: 'auth_health_baseline', endpoint: 'auth_health', step_rps: step },
  });
  const payload = parse(response);
  const valid = response.status === 200 && payload !== null;
  authLatency.add(response.timings.duration, { step_rps: step });
  authRequests.add(1, { step_rps: step });
  if (!valid) authFailures.add(1, { step_rps: step, status: String(response.status) });
  check(response, {
    'auth health responde 200': () => response.status === 200,
    'auth health retorna JSON': () => payload !== null,
  });
}

export function readPublicGate() {
  const step = __ENV.DIAGNOSTIC_STEP_RPS || 'unknown';
  const response = http.get(gateUrl, {
    headers: headers(logicalDevice('gate')),
    redirects: 0,
    timeout: __ENV.K6_HTTP_TIMEOUT || '5s',
    tags: { operation: 'public_immediate_gate', endpoint: 'public_gate', step_rps: step },
  });
  const payload = parse(response);
  const valid = response.status === 200 && gateReady(payload);
  gateLatency.add(response.timings.duration, { step_rps: step });
  gateRequests.add(1, { step_rps: step });
  if (!valid) gateFailures.add(1, { step_rps: step, status: String(response.status) });
  check(response, {
    'gate publico responde 200': () => response.status === 200,
    'gate publico continua fail-closed e pronto': () => gateReady(payload),
  });
}

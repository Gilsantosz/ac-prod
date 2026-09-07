import http from 'k6/http';
import { check } from 'k6';
import execution from 'k6/execution';
import crypto from 'k6/crypto';
import { Counter, Rate } from 'k6/metrics';
import { readLoadConfig } from './config.mjs';

const config = readLoadConfig(__ENV);
const created = new Counter('mes_created');
const replays = new Counter('mes_replayed');
const conflicts = new Counter('mes_conflict');
const unexpected = new Rate('mes_unexpected');
const endpoint = `${config.origin}/api/apontamentos`;
const payload = JSON.stringify({
  equipamento_id: config.equipamento,
  produto_id: config.produto,
  qte_boa: 5,
  qte_refugo: 1,
});
const differentPayload = JSON.stringify({ ...JSON.parse(payload), qte_refugo: 2 });

export const options = {
  // Não encaminhar POSTs para um destino fora da origem validada.
  maxRedirects: 0,
  batch: 20,
  batchPerHost: 20,
  setupTimeout: '30s',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    // 40 eventos novos/s = 2.400 gravações/min. Sem sleep ou lotes artificiais.
    apontamentos_novos: {
      executor: 'constant-arrival-rate', exec: 'newEntry',
      rate: config.rate, timeUnit: '1s', duration: `${config.seconds}s`,
      preAllocatedVUs: config.vus, maxVUs: config.vus, gracefulStop: '15s',
    },
    // Mais 10 POSTs/s: 5 repetições idênticas e 5 conflitos esperados.
    idempotencia: {
      executor: 'constant-arrival-rate', exec: 'replayAndConflict',
      rate: 5, timeUnit: '1s', duration: `${config.seconds}s`,
      preAllocatedVUs: 20, maxVUs: 20, gracefulStop: '15s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    mes_unexpected: ['rate==0'],
    dropped_iterations: ['count==0'],
    mes_created: [`count>=${config.rate * config.seconds}`],
    mes_replayed: [`count>=${5 * config.seconds}`],
    mes_conflict: [`count>=${5 * config.seconds}`],
    'http_req_duration{operation:create}': [`p(95)<${config.p95}`],
    'http_req_duration{operation:replay}': [`p(95)<${config.p95}`],
    'http_req_duration{operation:conflict}': [`p(95)<${config.p95}`],
  },
};

function uuid() {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function params(key, operation, ...statuses) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      'Idempotency-Key': key,
    },
    tags: { name: 'POST /api/apontamentos', operation },
    timeout: '10s', redirects: 0,
    responseCallback: http.expectedStatuses(...statuses),
  };
}

function responseBody(response) {
  try { return response.json(); } catch { return {}; }
}

function matches(response, key) {
  const body = responseBody(response);
  return body.id === key && body.equipamento_id === config.equipamento
    && body.produto_id === config.produto && body.qte_boa === 5
    && body.qte_refugo === 1 && Number.isFinite(Date.parse(body.data_hora));
}

export function setup() {
  // Falha antes da carga se autenticação, cadastro ou contrato estiverem errados.
  const denied = params(uuid(), 'authentication', 401);
  denied.headers.Authorization = 'Bearer invalid-load-test-token';
  const unauthorized = http.post(endpoint, payload, denied);
  if (!check(unauthorized, { 'token inválido recusado': (r) => r.status === 401 })) {
    execution.test.abort('Autenticação não passou; carga cancelada.');
  }

  const key = uuid();
  const concurrent = http.batch(Array.from({ length: 20 }, () => ({
    method: 'POST', url: endpoint, body: payload,
    params: params(key, 'concurrent_idempotency', 200, 201),
  })));
  const correct = check(concurrent, {
    '20 POSTs concorrentes geram apenas um 201': (rows) => rows.filter((r) => r.status === 201).length === 1,
    '19 POSTs concorrentes são repetições 200': (rows) => rows.filter((r) => r.status === 200
      && r.headers['Idempotency-Replayed'] === 'true').length === 19,
    'repetições preservam o evento': (rows) => rows.every((r) => matches(r, key)),
  });
  if (!correct) execution.test.abort('Cadastro ou idempotência não passou; carga cancelada.');
  return { replayKey: key };
}

export function newEntry() {
  const key = uuid();
  const response = http.post(endpoint, payload, params(key, 'create', 201));
  if (response.status === 201) created.add(1);
  const passed = check(response, {
    'novo evento retorna 201': (r) => r.status === 201,
    'evento gravado corresponde ao payload': (r) => matches(r, key),
  });
  unexpected.add(!passed);
}

export function replayAndConflict(data) {
  const repeated = http.post(endpoint, payload, params(data.replayKey, 'replay', 200));
  if (repeated.status === 200) replays.add(1);
  const replayOk = check(repeated, {
    'repetição retorna 200 e cabeçalho': (r) => r.status === 200 && r.headers['Idempotency-Replayed'] === 'true',
    'repetição preserva payload e ID': (r) => matches(r, data.replayKey),
  });
  const conflict = http.post(endpoint, differentPayload, params(data.replayKey, 'conflict', 409));
  if (conflict.status === 409) conflicts.add(1);
  const conflictOk = check(conflict, {
    'payload diferente retorna conflito 409': (r) => r.status === 409
      && responseBody(r).erro === 'CHAVE_REUTILIZADA_COM_DADOS_DIFERENTES',
  });
  unexpected.add(!replayOk || !conflictOk);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const failures = Object.entries(metrics).flatMap(([name, metric]) =>
    Object.entries(metric.thresholds || {}).filter(([, result]) => !result.ok)
      .map(([threshold]) => `${name}: ${threshold}`));
  const p95 = metrics['http_req_duration{operation:create}']?.values['p(95)'];
  const output = {
    stdout: `\nMES k6: ${metrics.mes_created?.values.count || 0} novos apontamentos; `
      + `${metrics.mes_replayed?.values.count || 0} repetições; `
      + `${metrics.mes_conflict?.values.count || 0} conflitos esperados.\n`
      + `p95 dos novos apontamentos: ${p95?.toFixed(2) ?? 'N/D'} ms.\n`
      + `Critérios: ${failures.length ? `REPROVADO (${failures.join('; ')})` : 'APROVADO'}.\n`,
  };
  if (__ENV.MES_LOADTEST_SUMMARY_PATH) {
    output[__ENV.MES_LOADTEST_SUMMARY_PATH] = JSON.stringify(data, null, 2);
  }
  return output;
}

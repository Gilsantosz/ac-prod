import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp, INSERT_SQL, FIND_SQL, OEE_SQL } from '../app.mjs';
import { loadConfig } from '../config.mjs';

const token = 'testing-only-token-with-32-characters-minimum';
const body = { equipamento_id: randomUUID(), produto_id: randomUUID(), qte_boa: 5, qte_refugo: 1 };
const environment = {
  DATABASE_URL: 'postgresql://test@localhost:5432/test',
  API_TOKEN: token, DB_SSL: 'disable', DB_POOL_MAX: '1', DB_QUEUE_MAX: '1',
};
const authorization = `Bearer ${token}`;
const request = (key = randomUUID(), payload = body) => ({
  method: 'POST', url: '/api/apontamentos', payload,
  headers: { authorization, 'idempotency-key': key },
});

class FakePool extends EventEmitter {
  calls = [];
  ended = false;
  query(text, values) {
    this.calls.push({ text, values });
    return this.respond(text, values);
  }
  respond = async () => ({ rows: [] });
  async end() { this.ended = true; }
}

function setup(t, pool = new FakePool()) {
  const app = createApp(loadConfig(environment), { pool, logger: false });
  t.after(() => app.close());
  return { app, pool };
}

test('autenticação ocorre antes da validação e não toca no banco', async (t) => {
  const { app, pool } = setup(t);
  const response = await app.inject({ method: 'POST', url: '/api/apontamentos', payload: {} });
  assert.equal(response.statusCode, 401);
  assert.equal(pool.calls.length, 0);
  assert.equal((await app.inject('/api/oee')).statusCode, 401);
  assert.equal((await app.inject('/healthz')).statusCode, 200);
});

test('valida UUID, chave, inteiros, limites e campos desconhecidos', async (t) => {
  const { app, pool } = setup(t);
  const invalid = [
    { ...body, equipamento_id: "'; DROP TABLE produtos;--" },
    { ...body, qte_boa: '5' }, { ...body, qte_refugo: -1 },
    { ...body, qte_boa: 2147483648 }, { ...body, qte_boa: 1.5 },
    { ...body, extra: true },
  ];
  for (const payload of invalid) {
    assert.equal((await app.inject(request(randomUUID(), payload))).statusCode, 400);
  }
  assert.equal((await app.inject(request('not-a-uuid'))).statusCode, 400);
  assert.equal((await app.inject({ ...request(), headers: { authorization } })).statusCode, 400);
  assert.equal(pool.calls.length, 0);
});

test('INSERT parametrizado utiliza Idempotency-Key como PK e aceita máximos INTEGER', async (t) => {
  const { app, pool } = setup(t);
  const id = randomUUID();
  const payload = { ...body, qte_boa: 2147483647 };
  pool.respond = async (_sql, values) => ({ rows: [{ id: values[0], ...payload, data_hora: '2026-09-07T00:00:00Z' }] });
  const response = await app.inject(request(id.toUpperCase(), payload));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(pool.calls[0], { text: INSERT_SQL, values: [id, body.equipamento_id, body.produto_id, 2147483647, 1] });
  assert.equal(response.json().id, id);
});

test('repetição é 200, colisão com outro payload é 409 e nunca executa UPDATE', async (t) => {
  const { app, pool } = setup(t);
  const id = randomUUID();
  pool.respond = async (sql) => ({ rows: sql === FIND_SQL ? [{ id, ...body }] : [] });
  const replay = await app.inject(request(id));
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  const conflict = await app.inject(request(id, { ...body, qte_boa: 6 }));
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().erro, 'CHAVE_REUTILIZADA_COM_DADOS_DIFERENTES');
  assert.equal(pool.calls.some(({ text }) => /UPDATE/.test(text)), false);
});

test('limita fila global, rejeita excedente e recupera capacidade', async (t) => {
  const { app, pool } = setup(t);
  await app.ready();
  const releases = [];
  pool.respond = () => new Promise((resolve) => releases.push(resolve));
  const first = app.inject(request()).then((response) => response);
  const second = app.inject({ method: 'GET', url: '/api/oee', headers: { authorization } }).then((response) => response);
  while (releases.length < 2) await new Promise((resolve) => setImmediate(resolve));
  const overloaded = await app.inject(request());
  assert.equal(overloaded.statusCode, 503);
  assert.equal(overloaded.headers['retry-after'], '1');
  assert.equal(pool.calls.length, 2);
  releases[0]({ rows: [{ id: randomUUID(), ...body }] });
  releases[1]({ rows: [{ id: randomUUID(), ...body }] });
  assert.equal((await first).statusCode, 201);
  assert.equal((await second).statusCode, 200);
  pool.respond = async () => ({ rows: [{ id: randomUUID(), ...body }] });
  assert.equal((await app.inject(request())).statusCode, 201);
});

test('timeouts, falhas de rede e FK retornam respostas seguras e liberam vagas', async (t) => {
  const { app, pool } = setup(t);
  const cases = [['23503', 422], ['55P03', 503], ['57014', 504], ['ECONNRESET', 503], ['XX000', 500]];
  for (const [code, status] of cases) {
    pool.respond = async () => { throw Object.assign(new Error('secret-db-password'), { code }); };
    const response = await app.inject(request());
    assert.equal(response.statusCode, status);
    assert.equal(response.body.includes('secret-db-password'), false);
  }
  pool.respond = async () => { throw new Error('Query read timeout'); };
  assert.equal((await app.inject(request())).statusCode, 504);
  pool.emit('error', new Error('idle connection failed'));
  pool.respond = async () => ({ rows: [{ id: randomUUID(), ...body }] });
  assert.equal((await app.inject(request())).statusCode, 201);
});

test('OEE somente repassa a MV e encerramento rejeita novas operações', async (t) => {
  const { app, pool } = setup(t);
  const rows = [{ equipamento_id: body.equipamento_id, oee_percentual: '85.50' }];
  pool.respond = async () => ({ rows });
  const response = await app.inject({ method: 'GET', url: '/api/oee', headers: { authorization } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), rows);
  assert.equal(pool.calls[0].text, OEE_SQL);
  app.beginShutdown();
  assert.equal((await app.inject(request())).statusCode, 503);
  await app.close();
  assert.equal(pool.ended, true);
});

test('configuração limita conexões e impede desligar TLS ou trocar destino em produção', () => {
  const production = { ...environment, NODE_ENV: 'production', DB_SSL: 'verify-full',
    DATABASE_URL: 'postgresql://mes_api.ref:password@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true' };
  const config = loadConfig(production);
  assert.equal(config.pool.ssl.rejectUnauthorized, true);
  assert.equal(config.pool.connectionString.includes('sslmode'), false);
  for (const change of [
    { DB_POOL_MAX: '51' }, { DB_SSL: 'disable' }, { API_TOKEN: 'short' },
    { DATABASE_URL: production.DATABASE_URL.replace(':6543/', ':5432/') },
    { DATABASE_URL: production.DATABASE_URL + '&host=another-host' },
    { DB_QUERY_TIMEOUT_MS: '5000' },
  ]) assert.throws(() => loadConfig({ ...production, ...change }));
  assert.equal(loadConfig(environment).pool.ssl, false);
});

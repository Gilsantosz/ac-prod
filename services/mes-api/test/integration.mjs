import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';

test('PostgreSQL temporário: privilégios mínimos, 1.000 POSTs e idempotência concorrente', async (t) => {
  const adminUrl = process.env.MES_TEST_DATABASE_URL;
  assert.ok(adminUrl, 'Execute npm run test:integration; nunca utilizar banco externo.');
  assert.equal(new URL(adminUrl).hostname, '127.0.0.1');
  const admin = new pg.Pool({ connectionString: adminUrl, ssl: false });
  t.after(() => admin.end());
  const equipamento = randomUUID();
  const produto = randomUUID();
  await admin.query(`
    CREATE TABLE public.equipamentos(id uuid PRIMARY KEY);
    CREATE TABLE public.produtos(id uuid PRIMARY KEY);
    CREATE TABLE public.apontamentos_producao(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      equipamento_id uuid NOT NULL REFERENCES public.equipamentos(id),
      produto_id uuid NOT NULL REFERENCES public.produtos(id),
      qte_boa integer NOT NULL CHECK(qte_boa >= 0),
      qte_refugo integer NOT NULL CHECK(qte_refugo >= 0),
      data_hora timestamptz NOT NULL DEFAULT NOW()
    );
    CREATE MATERIALIZED VIEW public.oee_tempo_real AS
      SELECT id AS equipamento_id, 85.50::numeric AS oee_percentual FROM public.equipamentos;
    CREATE ROLE mes_api LOGIN;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO mes_api;
    GRANT INSERT, SELECT ON public.apontamentos_producao TO mes_api;
    GRANT SELECT ON public.oee_tempo_real TO mes_api;
    ALTER ROLE mes_api SET statement_timeout = '5s';
    ALTER ROLE mes_api SET lock_timeout = '1s';
  `);
  await admin.query('INSERT INTO public.equipamentos VALUES($1)', [equipamento]);
  await admin.query('INSERT INTO public.produtos VALUES($1)', [produto]);
  await admin.query('REFRESH MATERIALIZED VIEW public.oee_tempo_real');

  const apiUrl = new URL(adminUrl);
  apiUrl.username = 'mes_api';
  const token = 'integration-only-token-with-32-characters';
  const config = loadConfig({ DATABASE_URL: apiUrl.toString(), API_TOKEN: token,
    NODE_ENV: 'test', DB_SSL: 'disable', DB_POOL_MAX: '50', DB_QUEUE_MAX: '2000' });
  const pool = new pg.Pool(config.pool);
  let active = 0;
  let peak = 0;
  pool.on('acquire', () => { active += 1; peak = Math.max(peak, active); });
  pool.on('release', () => { active -= 1; });
  const app = createApp(config, { pool, logger: false });
  t.after(() => app.close());
  await app.ready();
  const payload = { equipamento_id: equipamento, produto_id: produto, qte_boa: 5, qte_refugo: 1 };
  const post = (key, body = payload) => app.inject({
    method: 'POST', url: '/api/apontamentos', payload: body,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
  });

  await assert.rejects(pool.query('UPDATE public.apontamentos_producao SET qte_boa = 0'), { code: '42501' });
  await assert.rejects(pool.query('DELETE FROM public.apontamentos_producao'), { code: '42501' });
  const began = performance.now();
  const results = await Promise.all(Array.from({ length: 1000 }, () => post(randomUUID())));
  const elapsed = Math.round(performance.now() - began);
  assert.equal(results.filter((r) => r.statusCode === 201).length, 1000);
  assert.ok(peak <= 50, `pico de ${peak} conexões`);
  assert.equal((await admin.query('SELECT count(*)::integer AS count FROM public.apontamentos_producao')).rows[0].count, 1000);

  const key = randomUUID();
  const duplicates = await Promise.all(Array.from({ length: 20 }, () => post(key)));
  assert.equal(duplicates.filter((r) => r.statusCode === 201).length, 1);
  assert.equal(duplicates.filter((r) => r.statusCode === 200).length, 19);
  assert.equal((await post(key, { ...payload, qte_refugo: 2 })).statusCode, 409);
  assert.equal((await admin.query('SELECT count(*)::integer AS count FROM public.apontamentos_producao')).rows[0].count, 1001);

  assert.equal((await post(randomUUID(), { ...payload, equipamento_id: randomUUID() })).statusCode, 422);
  const oee = await app.inject({ url: '/api/oee', headers: { authorization: `Bearer ${token}` } });
  assert.equal(oee.statusCode, 200);
  assert.equal(oee.json()[0].oee_percentual, '85.50');

  // Mantém lock incompatível para provar que timeout não duplica o evento.
  const blocker = await admin.connect();
  await blocker.query('BEGIN');
  await blocker.query('LOCK TABLE public.apontamentos_producao IN ACCESS EXCLUSIVE MODE');
  const blockedId = randomUUID();
  try { assert.equal((await post(blockedId)).statusCode, 503); }
  finally { await blocker.query('ROLLBACK'); blocker.release(); }
  assert.equal((await post(blockedId)).statusCode, 201);
  assert.equal((await post(blockedId)).statusCode, 200);
  assert.equal((await admin.query('SELECT count(*)::integer AS count FROM public.apontamentos_producao WHERE id=$1', [blockedId])).rows[0].count, 1);
  t.diagnostic(`1.000 POSTs simultâneos em ${elapsed} ms; pico ${peak}/50 conexões; 20 repetições = 1 INSERT.`);
});

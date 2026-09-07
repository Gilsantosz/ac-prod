import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  // As tabelas já existentes no MES são dependências das migrations reais.
  // O cron é um stub somente neste cluster efêmero: não há agendamento externo.
  await admin.query(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE TABLE public.production_orders(id uuid PRIMARY KEY);
    CREATE TABLE public.operators(id uuid PRIMARY KEY);
    CREATE TABLE public.production_machines(id uuid PRIMARY KEY, name text, cell_name text, active boolean);
    CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
  `);
  const migration = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  await admin.query(migration('20260907011551_mes_layer1.sql'));
  await admin.query(`
    CREATE MATERIALIZED VIEW public.oee_tempo_real AS
      SELECT id AS equipamento_id, 85.50::numeric AS oee_percentual FROM public.equipamentos;
    ALTER ROLE mes_api LOGIN CONNECTION LIMIT 50;
  `);
  await admin.query(migration('20260907015138_mes_cycle_learning.sql'));
  await admin.query("INSERT INTO public.equipamentos(id,nome,celula_linha,status_atual) VALUES($1,'Equipamento de teste','Linha de teste','Operando')", [equipamento]);
  await admin.query("INSERT INTO public.produtos(id,sku,descricao,tempo_ciclo_padrao) VALUES($1,'TESTE','Produto sem padrão',NULL)", [produto]);
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
  assert.equal(oee.json()[0].oee_percentual, null);
  assert.equal(oee.json()[0].estado_ciclo, 'sem_producao');
  assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.amostras_ciclo')).rows[0].n, 0);

  await t.test('medição completa cria uma amostra pelo trigger e reenvio equivalente não duplica', async () => {
    const measuredKey = randomUUID();
    const measured = { ...payload, qte_refugo: 0,
      inicio_operacao: '2026-01-06T10:00:00.123456-03:00',
      fim_operacao: '2026-01-06T10:01:00.123456-03:00',
      origem_tempo: 'sensor', teve_interrupcao: false, retrabalho: false };
    const created = await post(measuredKey, measured);
    assert.equal(created.statusCode, 201, created.body);
    const equivalent = { ...measured,
      inicio_operacao: '2026-01-06T13:00:00.123456Z',
      fim_operacao: '2026-01-06T13:01:00.123456Z' };
    const replays = await Promise.all(Array.from({ length: 20 }, () => post(measuredKey, equivalent)));
    assert.ok(replays.every((response) => response.statusCode === 200));
    assert.ok(replays.every((response) => response.headers['idempotency-replayed'] === 'true'));
    const samples = await admin.query('SELECT quantidade, ciclo_minutos FROM public.amostras_ciclo WHERE apontamento_id=$1', [measuredKey]);
    assert.equal(samples.rowCount, 1);
    assert.equal(samples.rows[0].quantidade, '5');
    assert.equal(Number(samples.rows[0].ciclo_minutos), 0.2);
    await assert.rejects(pool.query('SELECT * FROM public.amostras_ciclo'), { code: '42501' });
    await assert.rejects(pool.query('INSERT INTO public.amostras_ciclo DEFAULT VALUES'), { code: '42501' });

    for (const changed of [
      { equipamento_id: randomUUID() }, { produto_id: randomUUID() },
      { qte_boa: 6 }, { qte_refugo: 1 }, { origem_tempo: 'operador' },
      { teve_interrupcao: true }, { retrabalho: true },
      { inicio_operacao: '2026-01-06T13:00:00.123455Z' },
      { fim_operacao: '2026-01-06T13:01:00.123457Z' },
    ]) {
      const conflict = await post(measuredKey, { ...equivalent, ...changed });
      assert.equal(conflict.statusCode, 409, JSON.stringify(changed));
    }
    assert.equal((await post(measuredKey, payload)).statusCode, 409);
    assert.equal((await post(key, measured)).statusCode, 409);
  });

  await t.test('refugo, interrupção e retrabalho são registrados sem virar ciclo aprendido', async () => {
    const measured = { ...payload, qte_refugo: 0,
      inicio_operacao: '2026-01-06T10:00:00Z', fim_operacao: '2026-01-06T10:01:00Z',
      origem_tempo: 'operador', teve_interrupcao: false, retrabalho: false };
    for (const flags of [{ qte_refugo: 1 }, { teve_interrupcao: true }, { retrabalho: true }]) {
      const id = randomUUID();
      assert.equal((await post(id, { ...measured, ...flags })).statusCode, 201);
      assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.amostras_ciclo WHERE apontamento_id=$1', [id])).rows[0].n, 0);
    }
  });

  await t.test('banco recusa intervalo invertido, fim futuro e medição sem peças', async () => {
    const measured = { ...payload, qte_refugo: 0,
      inicio_operacao: '2026-01-06T10:00:00Z', fim_operacao: '2026-01-06T10:01:00Z',
      origem_tempo: 'sensor', teve_interrupcao: false, retrabalho: false };
    for (const changed of [
      { fim_operacao: measured.inicio_operacao },
      { inicio_operacao: '2026-01-06T10:02:00Z' },
      { fim_operacao: '2999-01-01T00:00:00Z' }, { qte_boa: 0 },
    ]) {
      const id = randomUUID();
      assert.equal((await post(id, { ...measured, ...changed })).statusCode, 400);
      assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.apontamentos_producao WHERE id=$1', [id])).rows[0].n, 0);
    }
  });

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

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';

// Este runner ignora DATABASE_URL e não aceita um banco/API externos.
const folder = mkdtempSync(join(tmpdir(), 'mes-k6-pg-'));
const reportFolder = process.env.MES_LOADTEST_RESULTS_DIR
  ? resolve(process.env.MES_LOADTEST_RESULTS_DIR)
  : mkdtempSync(join(tmpdir(), 'mes-k6-results-'));
mkdirSync(reportFolder, { recursive: true });
const summaryPath = join(reportFolder, 'k6-summary.json');
const verificationPath = join(reportFolder, 'verification.json');
const script = fileURLToPath(new URL('./apontamentos.k6.js', import.meta.url));
const migrationFolder = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const k6 = process.env.MES_LOADTEST_K6_BIN || 'k6';
let app;
let admin;
let child;
let interrupted = false;
const stop = () => { interrupted = true; child?.kill('SIGTERM'); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`${command} falhou: ${result.error?.message || result.stderr}`);
  return result.stdout.trim();
}

async function availablePort() {
  const socket = createServer();
  await new Promise((accept, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', accept);
  });
  const port = socket.address().port;
  await new Promise((accept) => socket.close(accept));
  return port;
}

function positiveInteger(name, fallback, max) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    throw new Error(`${name}: inteiro entre 1 e ${max}.`);
  }
  return Number(raw);
}

try {
  const seconds = positiveInteger('MES_LOADTEST_DURATION_SECONDS', 60, 1800);
  const rate = positiveInteger('MES_LOADTEST_RATE', 40, 1000);
  const vus = positiveInteger('MES_LOADTEST_VUS', 100, 1000);
  const p95 = positiveInteger('MES_LOADTEST_P95_MS', 500, 30000);
  const poolMax = positiveInteger('MES_LOADTEST_POOL_MAX', 30, 50);
  const version = run(k6, ['version']);
  const port = await availablePort();
  run('initdb', ['-D', folder, '-U', 'mes_loadtest_admin', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', folder, '-l', join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ''`, '-w', 'start']);
  if (interrupted) throw new Error('Teste interrompido.');

  const url = `postgresql://mes_loadtest_admin@127.0.0.1:${port}/postgres`;
  admin = new pg.Pool({ connectionString: url, ssl: false, max: 1 });
  // Stubs vazios dos vínculos legados, somente neste banco descartável.
  // O cron não está disponível no PostgreSQL local: valida-se a chamada,
  // porém nenhum agendamento é instalado ou alegado como testado.
  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE public.production_orders(id uuid PRIMARY KEY);
    CREATE TABLE public.operators(id uuid PRIMARY KEY);
    CREATE TABLE public.production_machines(id uuid PRIMARY KEY, name text, cell_name text, active boolean);
    CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint
      LANGUAGE sql AS 'SELECT 1::bigint';
  `);
  const migrations = [];
  for (const file of [
    '20260907011551_mes_layer1.sql',
    '20260907011554_mes_layer2_oee.sql',
    '20260907011647_mes_service_logins.sql',
    '20260907015138_mes_cycle_learning.sql',
  ]) {
    const source = readFileSync(join(migrationFolder, file), 'utf8');
    const sql = source.replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;\s*$/gm,
      '-- pg_cron substituído pelo stub local; sem agendamento.');
    await admin.query(`BEGIN;\n${sql}\nCOMMIT;`);
    migrations.push({ file, sha256: createHash('sha256').update(source).digest('hex') });
  }
  const roleLimit = (await admin.query("SELECT rolconnlimit FROM pg_roles WHERE rolname = 'mes_api'")).rows[0].rolconnlimit;
  assert.ok(roleLimit === -1 || poolMax <= roleLimit, 'Pool solicitado excede o limite real do papel mes_api na migração.');
  const equipamento = randomUUID();
  const produto = randomUUID();
  await admin.query("INSERT INTO public.equipamentos (id, nome, celula_linha, status_atual) VALUES ($1, 'Equipamento de teste', 'Teste local', 'Disponível')", [equipamento]);
  await admin.query("INSERT INTO public.produtos (id, sku, descricao, tempo_ciclo_padrao) VALUES ($1, 'FIXTURE-K6-LOCAL', 'Produto de teste', NULL)", [produto]);
  const token = randomBytes(32).toString('hex');
  const apiDatabase = new URL(url);
  apiDatabase.username = 'mes_api';
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: apiDatabase.toString(), API_TOKEN: token,
    DB_SSL: 'disable', DB_POOL_MAX: String(poolMax), DB_QUEUE_MAX: '2000',
  });
  const pool = new pg.Pool(config.pool);
  await assert.rejects(pool.query('UPDATE public.apontamentos_producao SET qte_boa = 0'), { code: '42501' });
  await assert.rejects(pool.query('DELETE FROM public.apontamentos_producao'), { code: '42501' });
  await assert.rejects(pool.query('SELECT * FROM public.amostras_ciclo'), { code: '42501' });
  let acquired = 0;
  let peakAcquired = 0;
  // Inclui a conexão que já verificou as permissões antes da carga.
  let peakConnections = pool.totalCount;
  pool.on('connect', () => { peakConnections = Math.max(peakConnections, pool.totalCount); });
  pool.on('acquire', () => { acquired += 1; peakAcquired = Math.max(peakAcquired, acquired); });
  pool.on('release', () => { acquired -= 1; });
  app = createApp(config, { pool, logger: false });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });

  console.log(`k6 local: ${rate} novos eventos/s por ${seconds}s; API HTTP real; pool máximo ${poolMax}.`);
  const began = new Date().toISOString();
  // A execução é assíncrona: spawnSync bloquearia a API no mesmo processo.
  const result = await new Promise((accept, reject) => {
    child = spawn(k6, ['run', '--quiet', script], {
      stdio: 'inherit',
      // Nenhuma credencial herdada do projeto é enviada ao processo k6.
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        K6_NO_USAGE_REPORT: 'true',
        MES_LOADTEST_BASE_URL: origin,
        MES_LOADTEST_API_TOKEN: token,
        MES_LOADTEST_EQUIPAMENTO_ID: equipamento,
        MES_LOADTEST_PRODUTO_ID: produto,
        MES_LOADTEST_RATE: String(rate),
        MES_LOADTEST_DURATION_SECONDS: String(seconds),
        MES_LOADTEST_VUS: String(vus),
        MES_LOADTEST_P95_MS: String(p95),
        MES_LOADTEST_SUMMARY_PATH: summaryPath,
      },
    });
    const deadline = setTimeout(() => child.kill('SIGTERM'), (seconds + 60) * 1000);
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(deadline); accept({ code, signal }); });
  });
  child = undefined;
  if (interrupted) throw new Error('Teste interrompido.');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const created = summary.metrics.mes_created?.values.count ?? 0;
  const stored = (await admin.query(`
    SELECT count(*)::integer AS eventos,
      count(DISTINCT id)::integer AS ids_unicos,
      sum(qte_boa)::integer AS boas, sum(qte_refugo)::integer AS refugos,
      bool_and(equipamento_id = $1 AND produto_id = $2) AS somente_fixture
    FROM public.apontamentos_producao
  `, [equipamento, produto])).rows[0];
  // Sem medição de ciclo no payload, nenhuma amostra artificial pode nascer.
  await admin.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.ciclos_observados');
  await admin.query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.oee_tempo_real');
  const learning = (await admin.query(`
    SELECT estado_ciclo, oee_percentual, desempenho_percentual,
      cobertura_ciclo_percentual,
      (SELECT count(*)::integer FROM public.amostras_ciclo) AS amostras_ciclo
    FROM public.oee_tempo_real WHERE equipamento_id = $1
  `, [equipamento])).rows[0];
  const verification = {
    began, finished: new Date().toISOString(), environment: 'local-disposable-postgresql',
    k6: version, k6ExitCode: result.code, k6Signal: result.signal,
    requestedNewEventsPerSecond: rate, durationSeconds: seconds,
    createdViaK6: created, setupFixtureEvents: 1, stored,
    poolLimit: poolMax, databaseRoleConnectionLimit: roleLimit, peakConnections, peakAcquired,
    migrations, learning,
    p95NewEventMs: summary.metrics['http_req_duration{operation:create}']?.values['p(95)'],
    scope: 'API HTTP, SQL parametrizado, idempotência, migrações MES com índices/RLS/trigger, PostgreSQL local e limite do pool. Confere OEE indisponível sem medição. Não valida hospedagem, Supavisor, cron ativo, cálculos de OEE com ciclos medidos ou 1.000 PCs simultâneos.',
  };
  writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);
  console.log(`Relatórios: ${reportFolder}`);
  assert.equal(result.code, 0, 'k6 reprovou os critérios; consulte k6-summary.json.');
  assert.ok(created >= rate * seconds, 'Volume de novos eventos abaixo do solicitado.');
  assert.equal(stored.eventos, created + 1, 'Contagem no banco diverge das respostas 201 + evento de preparação.');
  assert.equal(stored.ids_unicos, stored.eventos, 'Há duplicidade de IDs.');
  assert.equal(stored.boas, 5 * stored.eventos, 'Peças boas divergentes.');
  assert.equal(stored.refugos, stored.eventos, 'Conflito alterou quantidades ou perdeu registros.');
  assert.equal(stored.somente_fixture, true, 'Registro fora dos cadastros de teste.');
  assert.equal(learning.estado_ciclo, 'aprendendo');
  assert.equal(learning.oee_percentual, null, 'Sem medição, OEE deve permanecer desconhecido.');
  assert.equal(learning.desempenho_percentual, null);
  assert.equal(learning.amostras_ciclo, 0, 'Carga sem duração não deve inventar amostras de ciclo.');
  assert.ok(peakConnections <= poolMax && peakAcquired <= poolMax, 'Limite do pool excedido.');
  console.log(`Banco conferido: ${stored.eventos} eventos, sem duplicações; pico ${peakConnections}/${poolMax} conexões.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    await app?.close();
    await admin?.end();
  } finally {
    if (existsSync(join(folder, 'postmaster.pid'))) {
      run('pg_ctl', ['-D', folder, '-m', 'fast', '-w', 'stop']);
    }
    rmSync(folder, { recursive: true, force: true });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

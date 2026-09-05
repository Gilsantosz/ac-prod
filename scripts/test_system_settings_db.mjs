/**
 * Isolated PostgreSQL validation. Never accepts a remote URL or project ref.
 * Install test-only packages OUTSIDE the repository:
 * npm install --prefix /tmp/acprod-session-sql-runtime --no-audit --no-fund --save-exact embedded-postgres@17.10.0-beta.17 pg@8.16.3
 * ACPROD_SQL_TEST_RUNTIME=/tmp/acprod-session-sql-runtime/node_modules node scripts/test_system_settings_db.mjs
 * In root-only user namespaces (native Postgres cannot safely start), install
 * @electric-sql/pglite@0.5.8 in that same runtime and append --wasm. This runs the
 * same SQL suite but reports concurrent-connection tests as skipped.
 * The fixture models only this migration's dependencies, not the full MES schema.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, chown, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.env.ACPROD_SQL_TEST_RUNTIME;
const requireRuntime = createRequire(runtime ? path.resolve(runtime, '../package.json') : import.meta.url);
const wasm = process.argv.includes('--wasm');
const fixture = await readFile(path.join(root, 'supabase/tests/fixtures/system_settings_fixture.sql'), 'utf8');
const migration = await readFile(path.join(root, 'supabase/migrations/20260905025625_admin_session_settings.sql'), 'utf8');
const temp = await mkdtemp(path.join(tmpdir(), 'acprod-session-db-'));

// Drop privileges only for this disposable process, without creating OS users.
if (!wasm && process.getuid?.() === 0) {
  await chown(temp, 65534, 65534);
  process.setgid(65534);
  process.setuid(65534);
}
const port = wasm ? 0 : await new Promise((resolve, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port: freePort } = server.address();
    server.close(() => resolve(freePort));
  });
});
const cluster = wasm ? null : new (await import(requireRuntime.resolve('embedded-postgres'))).default({
  databaseDir: path.join(temp, 'data'), user: 'postgres', password: 'isolated-local-test',
  port, persistent: false, onLog() {}, onError(message) { if (/error|fatal/i.test(String(message))) console.error(message); },
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=12'],
});
const connection = { host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: 'isolated-local-test' };
const lite = wasm ? new (await import(requireRuntime.resolve('@electric-sql/pglite'))).PGlite(path.join(temp, 'data')) : null;
const clients = [];
let checks = 0;
const admin = '10000000-0000-0000-0000-000000000001';
const operator = '10000000-0000-0000-0000-000000000002';
const manager = '10000000-0000-0000-0000-000000000003';
const inactive = '10000000-0000-0000-0000-000000000004';
const secondAdmin = '10000000-0000-0000-0000-000000000005';
const cellA = '20000000-0000-0000-0000-000000000001';
const cellB = '20000000-0000-0000-0000-000000000002';
const sectorA = '30000000-0000-0000-0000-000000000001';
const sectorB = '30000000-0000-0000-0000-000000000002';
const unknown = '90000000-0000-0000-0000-000000000001';
const base = { default_timeout_minutes: 30, warning_seconds: 60, role_timeouts: {}, cell_timeouts: {}, sectors: [] };
const valid = { ...base, default_timeout_minutes: 45, role_timeouts: { operator: 15, admin: 60 }, cell_timeouts: { [cellA]: 5 }, sectors: [{ id: sectorA, name: ' LSM ', cell_ids: [cellA, cellB], timeout_minutes: 20 }] };
const saveSql = 'select * from public.save_system_settings($1::jsonb, $2::bigint)';
function ok(condition, label) { assert.ok(condition, label); checks++; }
async function openClient() {
  if (wasm) return { async query(sql, params) {
    const result = await lite.query(sql, params);
    return { ...result, rowCount: result.rows.length };
  } };
  const { Client } = requireRuntime('pg');
  const client = new Client(connection); await client.connect(); clients.push(client); return client;
}
async function actor(client, id, role = 'authenticated') {
  assert.ok(['authenticated', 'anon'].includes(role));
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [id || '']);
}
async function transaction(client, id, fn, role = 'authenticated') {
  await client.query('begin');
  try { await actor(client, id, role); return await fn(); }
  finally { await client.query('rollback'); }
}
async function rejects(client, id, query, params, code, label, role) {
  await assert.rejects(transaction(client, id, () => client.query(query, params), role), error => error.code === code, label);
  checks++;
}

try {
  if (cluster) { await cluster.initialise(); await cluster.start(); }
  const db = await openClient();
  if (wasm) { await lite.exec(fixture); await lite.exec(migration); }
  else { await db.query(fixture); await db.query(migration); }
  const version = (await db.query('select version()')).rows[0].version;
  ok(version.includes('PostgreSQL'), 'Run against a PostgreSQL engine');
  const defaults = (await db.query('select * from public.system_settings')).rows;
  ok(defaults.length === 1 && defaults[0].id === 'session' && defaults[0].default_timeout_minutes === 30 && defaults[0].warning_seconds === 60 && Number(defaults[0].version) === 1, 'Singleton seeded with defaults');
  for (const id of [admin, operator, manager]) {
    const rows = await transaction(db, id, () => db.query('select * from public.system_settings'));
    ok(rows.rowCount === 1, 'Active profiles read settings');
  }
  for (const id of [inactive, unknown, null]) {
    const rows = await transaction(db, id, () => db.query('select * from public.system_settings'));
    ok(rows.rowCount === 0, 'Inactive, missing or unauthenticated profiles cannot read');
  }
  await rejects(db, null, 'select * from public.system_settings', [], '42501', 'Anonymous settings read denied', 'anon');
  await rejects(db, null, saveSql, [base, 1], '42501', 'Anonymous RPC denied', 'anon');
  for (const id of [operator, manager, inactive, unknown, null]) {
    await rejects(db, id, saveSql, [base, 1], '42501', 'Non-admin settings save denied');
  }
  for (const sql of [
    "update public.system_settings set default_timeout_minutes = 2 where id = 'session'",
    "insert into public.system_settings (id) values ('session')",
    "delete from public.system_settings where id = 'session'",
    "insert into public.system_settings_audit (settings_id, previous_settings, next_settings) values ('session', '{}', '{}')",
    'delete from public.system_settings_audit',
  ]) await rejects(db, admin, sql, [], '42501', 'Even admin clients cannot bypass RPC or alter audit');

  const badPayloads = [
    null, [], { ...base, unexpected: true }, { ...base, version: 1 }, { ...base, warning_seconds: undefined },
    { ...base, default_timeout_minutes: 0 }, { ...base, default_timeout_minutes: 1441 },
    { ...base, default_timeout_minutes: 1.2 }, { ...base, default_timeout_minutes: '30' },
    { ...base, warning_seconds: -1 }, { ...base, warning_seconds: 301 }, { ...base, warning_seconds: 0.5 },
    { ...base, role_timeouts: [] }, { ...base, role_timeouts: { user: 10 } },
    { ...base, role_timeouts: { admin: null } }, { ...base, role_timeouts: { operator: -1 } },
    { ...base, role_timeouts: { admin: '20' } }, { ...base, role_timeouts: { manager: 1.2 } },
    { ...base, cell_timeouts: [] }, { ...base, cell_timeouts: { Corte: 10 } },
    { ...base, cell_timeouts: { [unknown]: 10 } }, { ...base, cell_timeouts: { [cellA]: 0 } },
    { ...base, cell_timeouts: { [cellA]: '20' } }, { ...base, cell_timeouts: { [cellA]: 1.5 } },
    { ...base, sectors: {} }, { ...base, sectors: [null] },
  ];
  const sector = { id: sectorA, name: 'LSM', cell_ids: [cellA], timeout_minutes: 10 };
  for (const invalidSector of [
    { ...sector, extra: true }, { ...sector, timeout_minutes: undefined },
    { ...sector, id: 'LSM' }, { ...sector, name: ' ' }, { ...sector, name: 'a'.repeat(81) },
    { ...sector, cell_ids: null }, { ...sector, cell_ids: [cellA, cellA] },
    { ...sector, cell_ids: [unknown] }, { ...sector, cell_ids: ['Corte'] },
    { ...sector, timeout_minutes: 0 }, { ...sector, timeout_minutes: 1441 },
    { ...sector, timeout_minutes: '10' }, { ...sector, timeout_minutes: 1.1 },
  ]) badPayloads.push({ ...base, sectors: [invalidSector] });
  badPayloads.push({ ...base, sectors: [sector, sector] });
  badPayloads.push({ ...base, sectors: [sector, { ...sector, id: sectorB }] });
  for (const payload of badPayloads) await rejects(db, admin, saveSql, [payload, 1], '22023', 'Invalid settings rejected atomically');
  await rejects(db, admin, saveSql, [base, null], '22023', 'Null expected version rejected');
  await rejects(db, admin, saveSql, [base, 0], '22023', 'Zero expected version rejected');
  await rejects(db, admin, saveSql, [base, 2], '40001', 'Stale version rejected');
  await transaction(db, operator, async () => {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: operator, user_metadata: { role: 'admin' } })]);
    await assert.rejects(db.query(saveSql, [base, 1]), error => error.code === '42501'); checks++;
  });
  ok((await db.query('select count(*)::int count from public.system_settings_audit')).rows[0].count === 0, 'Rejected/rolled back saves leave audit untouched');

  const boundaries = { ...base, default_timeout_minutes: 1, warning_seconds: 300,
    role_timeouts: { operator: 1, viewer: 1440, supervisor: 5, quality_manager: 10, manager: 20, admin: 30 },
    cell_timeouts: { [cellA]: 1440 }, sectors: [{ ...sector, timeout_minutes: null }] };
  await transaction(db, admin, async () => {
    const row = (await db.query(saveSql, [boundaries, 1])).rows[0];
    ok(row.sectors[0].timeout_minutes === null && row.warning_seconds === 300, 'Bounds and nullable sector inheritance accepted');
  });

  await db.query('begin');
  await actor(db, admin);
  const saved = (await db.query(saveSql, [valid, 1])).rows[0];
  await db.query('commit');
  ok(Number(saved.version) === 2 && saved.updated_by === admin && saved.sectors[0].name === 'LSM', 'Admin save normalizes name, increments version, records actor');
  const audit = await transaction(db, admin, () => db.query('select * from public.system_settings_audit'));
  ok(audit.rowCount === 1 && audit.rows[0].previous_settings.version === 1 && audit.rows[0].next_settings.version === 2 && audit.rows[0].changed_by === admin, 'Audit preserves before/after');
  for (const id of [operator, manager, inactive]) {
    ok((await transaction(db, id, () => db.query('select * from public.system_settings_audit'))).rowCount === 0, 'Non-admin audit reads denied by RLS');
  }
  await rejects(db, null, 'select * from public.system_settings_audit', [], '42501', 'Anonymous audit reads denied', 'anon');

  // Two independent connections hold the same loaded version. Exactly one wins.
  if (!wasm) {
  const first = await openClient(); const second = await openClient();
  await first.query('begin'); await second.query('begin');
  await actor(first, admin); await actor(second, secondAdmin);
  await first.query(saveSql, [{ ...base, default_timeout_minutes: 10 }, 2]);
  const racingSave = second.query(saveSql, [{ ...base, default_timeout_minutes: 20 }, 2]).then(
    result => ({ result }), error => ({ error }),
  );
  await first.query('commit');
  const loser = await racingSave;
  await second.query('rollback');
  ok(loser.error?.code === '40001', 'Concurrent second save fails version check after row lock releases');
  const final = (await db.query('select * from public.system_settings')).rows[0];
  ok(Number(final.version) === 3 && final.default_timeout_minutes === 10, 'Concurrent save never overwrites winner');
  ok((await db.query('select count(*)::int count from public.system_settings_audit')).rows[0].count === 2, 'Conflict produces no spurious audit record');
  } else {
    await rejects(db, secondAdmin, saveSql, [base, 1], '40001', 'Second administrator with an earlier version cannot overwrite saved settings');
    const final = (await db.query('select * from public.system_settings')).rows[0];
    ok(Number(final.version) === 2 && final.default_timeout_minutes === 45, 'Stale save leaves current settings unchanged');
  }

  const catalog = await db.query(`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('system_settings','system_settings_audit') and c.relrowsecurity) as rls_tables,
    has_function_privilege('anon','public.save_system_settings(jsonb,bigint)','execute') as anon_rpc,
    has_function_privilege('service_role','public.save_system_settings(jsonb,bigint)','execute') as service_rpc,
    has_table_privilege('authenticated','public.system_settings','update') as direct_update,
    has_table_privilege('service_role','public.system_settings','update') as service_update,
    (select proconfig from pg_proc where oid='public.save_system_settings(jsonb,bigint)'::regprocedure) as config`);
  ok(catalog.rows[0].rls_tables === 2 && !catalog.rows[0].anon_rpc && !catalog.rows[0].service_rpc && !catalog.rows[0].direct_update && !catalog.rows[0].service_update && catalog.rows[0].config.includes('search_path=""'), 'Security catalog: RLS, revoked default grants, fixed search_path');
  console.log(JSON.stringify({ ok: true, checks, postgres: version, engine: wasm ? 'PGlite WASM' : 'native', concurrent_connections: wasm ? 'SKIPPED: single-connection engine; stale-version rejection verified' : 'PASS', scope: 'isolated dependency fixture + new migration; no remote changes' }, null, 2));
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (cluster) await cluster.stop().catch(() => {});
  if (lite) await lite.close();
  await rm(temp, { recursive: true, force: true });
}

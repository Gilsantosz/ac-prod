/**
 * Disposable PostgreSQL test, with no remote URL or credentials accepted.
 * Requires native PostgreSQL 17 tools (initdb, pg_ctl, psql) on PATH.
 * node scripts/test_collection_snapshot_db.mjs
 *
 * The expensive legacy auditors and pg_cron are dependency fixtures. Only the
 * two baseline hashes are substituted in an in-memory migration copy, after
 * proving that the production migration refuses the fixture baseline. This
 * validates executable cache/ACL/TTL behavior, not production schema health.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(tmpdir(), 'acprod-snapshot-review-'));
const cluster = path.join(temp, 'data');
const migration = readFileSync(path.join(root,
  'supabase/migrations/20260913054000_collection_immediate_release_snapshot.sql'), 'utf8');
const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', temp, '-p', '55441', '-U', 'postgres', '-d', 'postgres', '-At'];
const command = (name, parameters, options = {}) => execFileSync(name, parameters,
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
const sql = (query) => command('psql', args, { input: query });
let started = false;
let checks = 0;
function test(query, label) {
  const result = sql(query).trim().split('\n').filter(Boolean).at(-1);
  assert.equal(result, 't', label);
  checks += 1;
}
const fixture = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA private AUTHORIZATION postgres;
CREATE SCHEMA vault AUTHORIZATION postgres;
CREATE SCHEMA cron AUTHORIZATION postgres;
CREATE TABLE private.collection_pipeline_flags (
  flag_name text PRIMARY KEY, enabled boolean NOT NULL,
  rollout_scope jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO private.collection_pipeline_flags VALUES
  ('collection_pipeline_v3_ingress',true,'{"all":true}',now());
CREATE TABLE private.fixture_health (ready boolean NOT NULL);
INSERT INTO private.fixture_health VALUES (true);
CREATE TABLE public.app_schema_releases (version text PRIMARY KEY, checksum text, notes text);
CREATE TABLE cron.fixture_jobs (name text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.fixture_jobs VALUES ($1,$2,$3) ON CONFLICT (name)
  DO UPDATE SET schedule=excluded.schedule, command=excluded.command RETURNING 1::bigint;
$$;
CREATE FUNCTION public.get_public_collection_runtime_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,private,vault,cron,pg_temp AS $$
 SELECT jsonb_build_object('ready',ready,'migration_version','v9.2.3',
  'release_version','20260901_acprod_collection_runtime_health_security_v9_2_3',
  'schema_flags',jsonb_build_object('fixture',ready)) FROM private.fixture_health;
$$;
CREATE FUNCTION public.get_public_collection_immediate_release() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,private,pg_temp AS $$
 SELECT jsonb_build_object('ready',
  (public.get_public_collection_runtime_health()->>'ready')::boolean,
  'gate_migration_version','20260913043419',
  'gate_release_version','20260913_acprod_collection_immediate_owner_gate_v1_1',
  'transport','immediate_v3');
$$;
REVOKE ALL ON FUNCTION public.get_public_collection_runtime_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_runtime_health() TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_public_collection_immediate_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_immediate_release() TO anon,authenticated;
`;

try {
  command('initdb', ['-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-locale']);
  // Empty listen_addresses and a unique Unix socket prevent remote access.
  command('pg_ctl', ['-D', cluster, '-l', path.join(temp, 'postgres.log'), '-o',
    `-h '' -p 55441 -k ${temp} -c max_connections=8`, 'start']);
  started = true;
  sql(fixture);
  assert.throws(() => sql(`BEGIN;\n${migration}\nCOMMIT;`),
    /COLLECTION_IMMEDIATE_DYNAMIC_GATE_BASELINE_CHANGED/);
  checks += 1;
  const originalImmediate = '6ff7ea833013958a8e54636969ec7d12';
  const originalRuntime = 'cef8706c65718a4cc2d8aa7b3d4b95e9';
  const fixtureImmediate = sql("select md5(pg_get_functiondef('public.get_public_collection_immediate_release()'::regprocedure))").trim();
  const fixtureRuntime = sql("select md5(pg_get_functiondef('public.get_public_collection_runtime_health()'::regprocedure))").trim();
  const testedMigration = migration.replaceAll(originalImmediate, fixtureImmediate)
    .replaceAll(originalRuntime, fixtureRuntime);
  sql(`BEGIN;\n${testedMigration}\nCOMMIT;`);
  const getters = [
    ['public.get_public_collection_runtime_health()', 'private.collection_runtime_health_snapshot_v1'],
    ['public.get_public_collection_immediate_release()', 'private.collection_immediate_release_snapshot_v1'],
  ];
  for (const [getter, table] of getters) {
    test(`set role anon; select ${getter} @> '{"ready":true,"snapshot_status":"fresh"}';`, 'Anon reads fresh snapshot');
    test(`begin; update ${table} set refreshed_at=now()-interval '4 minutes', expires_at=now()-interval '1 minute';
      select ${getter} @> '{"ready":false,"snapshot_status":"stale"}';`, 'Expired snapshot fails closed');
    test(`begin; delete from ${table}; select ${getter} @> '{"ready":false,"snapshot_status":"missing"}';`, 'Missing snapshot fails closed');
    test(`begin; update ${table} set audit_function_hash=repeat('0',32);
      select ${getter} @> '{"ready":false,"snapshot_status":"audit_hash_mismatch"}';`, 'Drifted auditor hash fails closed');
    test(`begin; update private.collection_pipeline_flags set enabled=false;
      select ${getter} @> '{"ready":false,"snapshot_status":"rollout_changed"}';`, 'Flag change invalidates immediately');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      test(`select not has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE');`, `${role} cannot access private cache`);
    }
  }
  for (const name of ['audit_collection_runtime_health_v1', 'audit_collection_immediate_release_v1',
    'refresh_collection_runtime_health_snapshot_v1', 'refresh_collection_immediate_release_snapshot_v1',
    'collection_pipeline_revision_v1']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      test(`select not has_function_privilege('${role}','private.${name}()','EXECUTE');`, `${role} cannot execute ${name}`);
    }
  }
  test("select not has_function_privilege('service_role','public.get_public_collection_immediate_release()','EXECUTE');", 'Immediate grant remains minimal');
  test(`begin; update private.fixture_health set ready=false;
    select private.refresh_collection_immediate_release_snapshot_v1();
    select public.get_public_collection_runtime_health() @> '{"ready":false,"snapshot_status":"audit_failed"}'
      and public.get_public_collection_immediate_release() @> '{"ready":false,"snapshot_status":"audit_failed"}';`,
  'Fresh failing runtime audit propagates to immediate gate within same refresh');
  test(`begin; update private.collection_pipeline_flags set updated_at=now();
    select private.refresh_collection_immediate_release_snapshot_v1();
    select public.get_public_collection_immediate_release() @> '{"ready":true,"snapshot_status":"fresh"}';`,
  'Refresh adopts new rollout revision');
  test(`begin;
    create or replace function private.audit_collection_runtime_health_v1() returns jsonb
    language sql stable security definer set search_path=pg_catalog,public,private,vault,cron,pg_temp
    as $$ select '{"ready":true,"migration_version":"v9.2.3","release_version":"20260901_acprod_collection_runtime_health_security_v9_2_3"}'::jsonb $$;
    select private.refresh_collection_immediate_release_snapshot_v1();
    select public.get_public_collection_runtime_health() @> '{"ready":false,"snapshot_status":"audit_hash_mismatch"}'
      and public.get_public_collection_immediate_release() @> '{"ready":false,"snapshot_status":"audit_failed"}';`,
  'Changing auditor body cannot publish a ready snapshot');
  test(`begin;
    create or replace function private.audit_collection_runtime_health_v1() returns jsonb
    language plpgsql stable security definer set search_path=pg_catalog,public,private,vault,cron,pg_temp
    as $$ begin raise exception 'AUDIT_MUST_NOT_RUN_ON_READ'; end $$;
    set local role anon;
    select public.get_public_collection_runtime_health() @> '{"ready":true}'
      and public.get_public_collection_immediate_release() @> '{"ready":true}';`,
  'Hot public reads never invoke the expensive auditors');
  sql(`BEGIN;\n${testedMigration}\nCOMMIT;`);
  test("select count(*)=1 from cron.fixture_jobs where schedule='* * * * *' and command='SELECT private.refresh_collection_immediate_release_snapshot_v1();';", 'Reapply retains exactly one cron job');
  console.log(JSON.stringify({ ok: true, checks, postgres: sql('select version()').trim(),
    scope: 'native PostgreSQL cache/ACL/TTL tests with fixture auditors and cron; no production modifications' }, null, 2));
} finally {
  if (started) command('pg_ctl', ['-D', cluster, '-m', 'fast', 'stop']);
  rmSync(temp, { recursive: true, force: true });
}

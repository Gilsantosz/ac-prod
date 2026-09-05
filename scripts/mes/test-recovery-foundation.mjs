import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { columnSql, quoteIdentifier, buildFoundation } from './build-recovery-foundation.mjs';
import { replay } from './local-pg17-replay.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidenceRoot = join(root, 'docs/audits/2026-09-04-mes-vnext');
const staging = JSON.parse(readFileSync(join(evidenceRoot, 'catalog-staging-schema-evidence.json'), 'utf8'));
const production = JSON.parse(readFileSync(join(evidenceRoot, 'catalog-production-schema-evidence.json'), 'utf8'));
const foundation = buildFoundation(production, staging);
const migration = readFileSync(join(root, 'supabase/recovery/staging/20260905003000_collection_schema_foundation.sql'), 'utf8');
assert.equal(migration, foundation.sql, 'Reviewed migration differs from its captured definitions.');

// This fixture reproduces table/column/PK shapes only. auth.users is an explicit
// synthetic FK anchor, not a Supabase Auth implementation or security acceptance.
const fixture = [
  'CREATE SCHEMA extensions;', 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions;',
  'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;', 'CREATE SCHEMA auth;',
  'CREATE TABLE auth.users (id uuid PRIMARY KEY);',
  'CREATE ROLE anon NOLOGIN;', 'CREATE ROLE authenticated NOLOGIN;', 'CREATE ROLE service_role NOLOGIN;',
  // Literal auth.uid definition captured from staging on 2026-09-05; no user data.
  `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
  $function$;`,
];
for (const o of staging.objects.filter(o => o.kind === 'relation' && o.definition.kind === 'r')) {
  fixture.push(`CREATE TABLE ${o.identity} (\n${o.definition.columns.map(columnSql).join(',\n')}\n);`);
}
for (const o of staging.objects.filter(o => o.kind === 'constraint' && ['p','u'].includes(o.definition.kind))) {
  fixture.push(`ALTER TABLE ${o.definition.relation} ADD CONSTRAINT ${quoteIdentifier(o.definition.name)} ${o.definition.definition};`);
}
fixture.push("INSERT INTO public.capacity_test_runs (id,name,environment,project_ref,created_by,synthetic_prefix) VALUES ('00000000-0000-4000-8000-000000000101','local-preservation','local','local-fixture','00000000-0000-4000-8000-000000000102','LOCAL_ONLY');");
const sentinel = "IF (SELECT count(*) FROM public.capacity_test_runs WHERE synthetic_prefix='LOCAL_ONLY') <> 1 THEN RAISE EXCEPTION 'Evidence row changed'; END IF;";
const acceptance = `DO $acceptance$ BEGIN
  ${sentinel}
  IF (SELECT count(*) FROM private.collection_pipeline_flags WHERE enabled=false) <> 4 THEN RAISE EXCEPTION 'Flags not disabled'; END IF;
  IF EXISTS (SELECT 1 FROM private.collection_pipeline_flags WHERE enabled) THEN RAISE EXCEPTION 'Flag activated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE format('%I.%I',n.nspname,c.relname) = ANY(ARRAY[${foundation.summary.new_tables.map(n => `'${n}'`).join(',')}]) AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'RLS absent'; END IF;
  IF has_table_privilege('anon','public.coletas_producao','SELECT') OR has_table_privilege('authenticated','public.coletas_producao','INSERT') THEN RAISE EXCEPTION 'Unexpected API grant'; END IF;
  IF (SELECT selection_sha256 FROM private.mes_recovery_journal WHERE recovery_key='collection_foundation_20260905') <> '${foundation.summary.selection_sha256}' THEN RAISE EXCEPTION 'Wrong recovery version'; END IF;
END $acceptance$;`;
const rollbackAcceptance = `DO $rollback$ BEGIN ${sentinel}
  IF to_regclass('public.coletas_producao') IS NOT NULL OR to_regclass('private.mes_recovery_journal') IS NOT NULL THEN RAISE EXCEPTION 'Partial DDL survived rollback'; END IF;
END $rollback$;`;
const fault = "DO $fault$ BEGIN RAISE EXCEPTION 'Injected rollback test' USING ERRCODE='P0001'; END $fault$;";
const directory = mkdtempSync(join(tmpdir(), 'acprod-foundation-tests-'));
const cases = [fixture.join('\n'), migration + fault, rollbackAcceptance, migration, acceptance, migration, acceptance];
const files = cases.map((sql, index) => {
  const path = join(directory, `${index}-fixture.sql`);
  writeFileSync(path, sql, { flag: 'wx', mode: 0o600 });
  return path;
});
const results = [];
for (let iteration = 0; iteration < 2; iteration++) {
  const result = replay({ pgBin: process.argv[2], files, expectedFailures: { 1: 'P0001', 5: '55000' } });
  results.push(result);
  if (result.decision !== 'REPLAY_PASS_ONLY') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    throw new Error('Recovery foundation integration failed.');
  }
}
process.stdout.write(`${JSON.stringify({ decision: 'STRUCTURAL_RECOVERY_TESTS_PASS',
  limitation: 'Synthetic table shapes only; full Supabase parity, Auth, RLS policy behavior and capacity remain unverified.',
  summary: foundation.summary, runs: results }, null, 2)}\n`);

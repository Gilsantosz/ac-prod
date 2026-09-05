import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { replay } from './local-pg17-replay.mjs';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(join(root, 'supabase/recovery/staging/20260905013000_collection_private_parsers.sql'), 'utf8');
const source = JSON.parse(readFileSync(join(root, 'docs/audits/2026-09-04-mes-vnext/catalog-production-schema-evidence.json'), 'utf8'));
const names = ['try_collection_bigint_v3','try_collection_timestamptz_v3','try_collection_uuid_v3'];
const selected = source.objects.filter(o => o.kind === 'routine' && names.includes(o.definition.name));
assert.equal(createHash('sha256').update(JSON.stringify(selected)).digest('hex'), 'f9e8bf58cac7e45785377be0d0e023b7223d4f6415bd7a1bab0d3e4c1d8b74e2');
assert.equal(selected.length, 3);
for (const object of selected) assert.ok(migration.includes(object.definition.definition), 'Parser body differs from captured v3 semantics.');

const fixture = `
CREATE SCHEMA private;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE TABLE private.mes_recovery_journal (recovery_key text PRIMARY KEY,target_ref text NOT NULL,selection_sha256 text NOT NULL,applied_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE private.collection_pipeline_flags(flag_name text PRIMARY KEY,enabled boolean NOT NULL);
INSERT INTO private.mes_recovery_journal VALUES ('collection_foundation_20260905','smnsihksrhzbkhcbdjfu','d740353826e364449dd765cf9d4589ca0c98623d0f453c13717d60281fee5ecc',clock_timestamp());
INSERT INTO private.collection_pipeline_flags VALUES ('collection_pipeline_v3_ingress',false),('collection_pipeline_v3_worker',false),('collection_pipeline_v3_projection',false),('collection_pipeline_v3_broadcast',false);
`;
const notApplied = `DO $test$ BEGIN
IF to_regprocedure('private.try_collection_uuid_v3(text)') IS NOT NULL OR (SELECT count(*) FROM private.mes_recovery_journal)<>1 THEN
RAISE EXCEPTION 'Partial recovery survived rollback'; END IF; END $test$;`;
const acceptance = `SET LOCAL timezone='UTC';
DO $test$ BEGIN
IF private.try_collection_uuid_v3('00000000-0000-4000-8000-000000000101') IS DISTINCT FROM '00000000-0000-4000-8000-000000000101'::uuid
OR private.try_collection_uuid_v3('invalid') IS NOT NULL OR private.try_collection_uuid_v3(' ') IS NOT NULL OR private.try_collection_uuid_v3(NULL) IS NOT NULL
THEN RAISE EXCEPTION 'UUID contract'; END IF;
IF private.try_collection_bigint_v3(' 42 ') IS DISTINCT FROM 42::bigint
OR private.try_collection_bigint_v3('-9223372036854775808') IS DISTINCT FROM '-9223372036854775808'::bigint
OR private.try_collection_bigint_v3('9223372036854775808') IS NOT NULL
OR private.try_collection_bigint_v3('invalid') IS NOT NULL OR private.try_collection_bigint_v3(' ') IS NOT NULL OR private.try_collection_bigint_v3(NULL) IS NOT NULL
THEN RAISE EXCEPTION 'Bigint contract'; END IF;
IF private.try_collection_timestamptz_v3('2026-09-04T12:00:00-03:00') IS DISTINCT FROM '2026-09-04T15:00:00Z'::timestamptz
OR private.try_collection_timestamptz_v3('not-a-timestamp') IS NOT NULL OR private.try_collection_timestamptz_v3('2026-02-31') IS NOT NULL
OR private.try_collection_timestamptz_v3(' ') IS NOT NULL OR private.try_collection_timestamptz_v3(NULL) IS NOT NULL
THEN RAISE EXCEPTION 'Timestamp contract'; END IF;
IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.prosecdef) THEN
RAISE EXCEPTION 'Unexpected privileged parser'; END IF;
IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN pg_roles r WHERE n.nspname='private' AND r.rolname IN ('anon','authenticated','service_role','authenticator') AND has_function_privilege(r.oid,p.oid,'EXECUTE')) THEN
RAISE EXCEPTION 'Unexpected API execution'; END IF;
IF EXISTS (SELECT 1 FROM private.collection_pipeline_flags WHERE enabled) OR (SELECT count(*) FROM private.mes_recovery_journal)<>2 THEN
RAISE EXCEPTION 'Recovery state mismatch'; END IF;
END $test$;`;
const fault = "DO $fault$ BEGIN RAISE EXCEPTION 'Injected failure' USING ERRCODE='P0001'; END $fault$;";
const wrong = "UPDATE private.mes_recovery_journal SET target_ref='wrong-local-fixture';";
const fix = "UPDATE private.mes_recovery_journal SET target_ref='smnsihksrhzbkhcbdjfu';";
const enable = "UPDATE private.collection_pipeline_flags SET enabled=true WHERE flag_name='collection_pipeline_v3_ingress';";
const disable = "UPDATE private.collection_pipeline_flags SET enabled=false;";
const sqls = [fixture, wrong, migration, notApplied, fix, enable, migration, notApplied, disable,
  migration + fault, notApplied, migration, acceptance, migration, acceptance];
const directory = mkdtempSync(join(tmpdir(), 'acprod-parser-tests-'));
const files = sqls.map((sql, index) => { const path=join(directory, `${index}-case.sql`); writeFileSync(path,sql,{flag:'wx',mode:0o600}); return path; });
const result = replay({pgBin:process.argv[2],files,expectedFailures:{2:'55000',6:'55000',9:'P0001',13:'55000'}});
process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
process.exitCode=result.decision==='REPLAY_PASS_ONLY'?0:1;

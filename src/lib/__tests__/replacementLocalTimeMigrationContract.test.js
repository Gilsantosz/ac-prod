import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readRepoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = readRepoFile(
  'supabase/migrations/20260913041209_fix_replacement_collection_local_time.sql',
);
const structuralAcceptance = readRepoFile(
  'supabase/tests/20260913_replacement_local_time_contract.sql',
);
const transactionalAcceptance = readRepoFile(
  'supabase/tests/replacement_station_collection_rollback.sql',
);

describe('replacement collection operator-local timestamp migration', () => {
  it('patches only the pinned deployed collector definition and fails closed on drift', () => {
    expect(migration).toContain(
      'public.collect_replacement_stage_v2(text,text,uuid,text,timestamptz,jsonb)',
    );
    expect(migration).toContain('pg_get_functiondef(function_row.oid)');
    expect(migration).toContain("md5(v_definition) <> '301bf930a759fa8f12a163d5d4479852'");
    expect(migration).toContain(
      "md5(v_patched_definition) <> '95f464192d89dc3e59906d75583e5cdb'",
    );
    expect(migration).toContain(
      "md5(v_definition) <> '95f464192d89dc3e59906d75583e5cdb'",
    );
    expect(migration).toContain('REPLACEMENT_LOCAL_TIME_PATCH_POINTS_CHANGED');
    expect(migration).toContain('REPLACEMENT_LOCAL_TIME_IDEMPOTENT_DEFINITION_CHANGED');
    expect(migration).toContain('EXECUTE v_patched_definition');
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/i);
  });

  it('uses the canonical operator timezone and Sao Paulo fallback for both ledgers', () => {
    expect(migration).toContain(
      "v_timezone := coalesce(nullif(v_operator.timezone, ''), 'America/Sao_Paulo')",
    );
    expect(migration).toContain('exception when invalid_parameter_value');
    expect(migration).toContain('v_local_now := v_now at time zone v_timezone');
    expect(migration.match(/v_local_now::date/g)).toHaveLength(2);
    expect(migration.match(/to_char\(v_local_now, 'HH24:MI'\)/g)).toHaveLength(2);
  });

  it('protects signature metadata, ACL and search_path across CREATE OR REPLACE', () => {
    for (const marker of [
      'proowner',
      'proacl',
      'proconfig',
      'prosecdef',
      'provolatile',
      'proparallel',
      'prorettype',
      'proargtypes',
      'v_before_acl_is_canonical',
      "pg_get_userbyid(v_before_owner) IS DISTINCT FROM 'postgres'",
      "grantee = to_regrole('authenticated')",
      "grantee = to_regrole('service_role')",
      'REPLACEMENT_LOCAL_TIME_IDEMPOTENT_METADATA_CHANGED',
      'REPLACEMENT_LOCAL_TIME_BASELINE_METADATA_CHANGED',
      'REPLACEMENT_LOCAL_TIME_FUNCTION_METADATA_CHANGED',
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it('ships rollback-only SQL acceptance for local day/hour and idempotent replay', () => {
    expect(structuralAcceptance).toContain("SET LOCAL TIME ZONE 'UTC'");
    expect(structuralAcceptance).toContain(
      "md5(v_definition) <> '95f464192d89dc3e59906d75583e5cdb'",
    );
    expect(structuralAcceptance).toContain('v_acl_is_canonical');
    expect(structuralAcceptance).toContain("has_function_privilege('anon'");
    expect(structuralAcceptance.trimEnd()).toMatch(
      /ROLLBACK;\s*SELECT 'REPLACEMENT_LOCAL_TIME_CONTRACT_OK' AS result;$/,
    );

    expect(transactionalAcceptance).toContain("SET LOCAL TIME ZONE 'UTC'");
    expect(transactionalAcceptance).toContain('AT TIME ZONE v_operator_timezone');
    expect(transactionalAcceptance).toContain("AT TIME ZONE 'UTC'");
    expect(transactionalAcceptance).toContain("v_replay->>'idempotent'");
    expect(transactionalAcceptance.trimEnd()).toMatch(
      /ROLLBACK;\s*SELECT 'REPLACEMENT_COLLECTION_ROLLBACK_OK' AS result;$/,
    );
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260913054000_collection_immediate_release_snapshot.sql',
), 'utf8');

const publicGetter = migration.match(
  /CREATE OR REPLACE FUNCTION public\.get_public_collection_immediate_release\(\)[\s\S]*?AS \$release\$([\s\S]*?)\$release\$;/,
)?.[1] || '';
const publicRuntimeGetter = migration.match(
  /CREATE OR REPLACE FUNCTION public\.get_public_collection_runtime_health\(\)[\s\S]*?AS \$runtime_health\$([\s\S]*?)\$runtime_health\$;/,
)?.[1] || '';

describe('collection immediate release snapshot migration', () => {
  it('preserva somente a baseline dinâmica aprovada em função privada', () => {
    expect(migration).toContain("md5(v_definition) <> '6ff7ea833013958a8e54636969ec7d12'");
    expect(migration).toContain('ALTER FUNCTION public.get_public_collection_immediate_release()');
    expect(migration).toContain('SET SCHEMA private');
    expect(migration).toContain('RENAME TO audit_collection_immediate_release_v1');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.audit_collection_immediate_release_v1()',
    );
    expect(migration).toContain("md5(v_definition) <> 'cef8706c65718a4cc2d8aa7b3d4b95e9'");
    expect(migration).toContain('ALTER FUNCTION public.get_public_collection_runtime_health()');
    expect(migration).toContain('RENAME TO audit_collection_runtime_health_v1');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION private.audit_collection_runtime_health_v1()',
    );
  });

  it('mantém payload, versões, hashes, revisão e TTL no singleton privado', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS private.collection_immediate_release_snapshot_v1',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS private.collection_runtime_health_snapshot_v1',
    );
    expect(migration).toContain('singleton boolean PRIMARY KEY DEFAULT true');
    expect(migration).toContain('expected_audit_function_hash text NOT NULL');
    expect(migration).toContain('rollout_revision text NOT NULL');
    expect(migration).toContain("expires_at <= refreshed_at + interval '3 minutes'");
    expect(migration).toContain(
      'REVOKE ALL ON TABLE private.collection_immediate_release_snapshot_v1',
    );
    expect(migration).toContain(
      'ALTER TABLE private.collection_runtime_health_snapshot_v1\n  ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE private.collection_immediate_release_snapshot_v1\n  ENABLE ROW LEVEL SECURITY',
    );
  });

  it('executa a auditoria pesada somente no refresher privado', () => {
    expect(migration).toContain(
      'v_payload := private.audit_collection_immediate_release_v1()',
    );
    expect(migration).toContain(
      "'private.audit_collection_immediate_release_v1()'::regprocedure",
    );
    expect(migration).toContain(
      'v_payload := private.audit_collection_runtime_health_v1()',
    );
    expect(publicGetter).not.toContain('pg_get_functiondef');
    expect(publicGetter).not.toContain('information_schema');
    expect(publicGetter).not.toContain('pg_policies');
    expect(publicGetter).not.toContain('cron.job');
    expect(publicGetter).not.toContain('vault.');
    expect(publicRuntimeGetter).not.toContain('pg_get_functiondef');
    expect(publicRuntimeGetter).not.toContain('information_schema');
    expect(publicRuntimeGetter).not.toContain('pg_policies');
    expect(publicRuntimeGetter).not.toContain('cron.job');
    expect(publicRuntimeGetter).not.toContain('vault.');
  });

  it('fecha o gate para snapshot ausente, expirado, divergente ou rollout alterado', () => {
    for (const state of [
      'missing',
      'stale',
      'source_hash_mismatch',
      'audit_hash_mismatch',
      'migration_version_mismatch',
      'release_version_mismatch',
      'rollout_changed',
      'audit_failed',
    ]) {
      expect(publicGetter).toContain(`'${state}'`);
    }
    expect(publicGetter).toContain("to_jsonb(evaluated.snapshot_state = 'fresh')");
    expect(publicRuntimeGetter).toContain("to_jsonb(evaluated.snapshot_state = 'fresh')");
    expect(publicRuntimeGetter).toContain("'health_source', 'runtime_catalog_snapshot'");
    expect(publicRuntimeGetter).toContain("'snapshot_used', true");
  });

  it('refresca a cada minuto e mantém ACL pública mínima', () => {
    expect(migration).toContain("'collection-immediate-release-snapshot-v1'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain(
      "'SELECT private.refresh_collection_immediate_release_snapshot_v1();'",
    );
    expect(migration).toContain(
      'PERFORM private.refresh_collection_runtime_health_snapshot_v1()',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_public_collection_immediate_release()',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_public_collection_immediate_release()',
    );
    expect(migration).toContain('TO anon, authenticated;');
    expect(migration).toContain('TO anon, authenticated, service_role;');
  });
});

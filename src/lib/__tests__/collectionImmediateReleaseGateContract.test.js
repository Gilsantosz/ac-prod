import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260913041141_collection_immediate_public_release_gate.sql',
), 'utf8');
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

describe('gate público do transporte imediato V3', () => {
  it('calcula a prontidão pelo catálogo, ACL, limite, decisão e rollout', () => {
    expect(migration).toContain('get_public_collection_immediate_release');
    expect(migration).toContain('ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)');
    expect(migration).toContain('collection_immediate_batch_limit_5');
    expect(migration).toContain('collection_immediate_definition_approved');
    expect(migration).toContain('90ffa0ee5c0f4b6b82c3a92a7d056bcf');
    expect(migration).toContain('private.process_collection_batch_v3');
    expect(migration).toContain('private.process_collection_projection_batch_v3');
    expect(migration).toContain("rollout.scope ->> 'all'");
    expect(migration).toContain("rollout.scope ->> 'immediate_rpc'");
    expect(migration).toContain("rollout.scope ->> 'immediate_max_events'");
    expect(migration).toContain("has_function_privilege('authenticated'");
    expect(migration).toContain("has_function_privilege('anon'");
    expect(migration).toContain("has_function_privilege('service_role'");
  });

  it('expõe somente o probe e mantém a função de coleta restrita', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_public_collection_immediate_release()',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_public_collection_immediate_release()',
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ingest_collection_batch_immediate_v3[\s\S]*TO anon/,
    );
  });

  it('obriga o deploy a comprovar o probe antes de gerar o build-info', () => {
    expect(workflow).toContain('get_public_collection_immediate_release');
    expect(workflow).toContain('IMMEDIATE_COLLECTION_RELEASE_OK');
    expect(workflow).toContain('collection_immediate_rpc_security');
    expect(workflow).toContain('collection_immediate_rollout_all');
    expect(workflow).toContain('needs: [database-release]');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260913041141_collection_immediate_public_release_gate.sql',
), 'utf8');
const ownerHardening = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260913043419_harden_collection_immediate_release_owner.sql',
), 'utf8');
const ownerGateLedger = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260913043729_normalize_collection_immediate_gate_ledger.sql',
), 'utf8');
const ownerAcceptance = readFileSync(resolve(
  process.cwd(),
  'supabase/tests/20260913_collection_immediate_owner_gate_contract.sql',
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

  it('endurece o probe por migração aditiva e exige o proprietário canônico', () => {
    expect(ownerHardening).toContain(
      'public.get_public_collection_immediate_release()',
    );
    expect(ownerHardening).toContain('2744ece1f4841eae43fc88ea8bf7bf0f');
    expect(ownerHardening).toContain('42a7a011b423cd0b624c3133326452da');
    expect(ownerHardening).toContain('90ffa0ee5c0f4b6b82c3a92a7d056bcf');
    expect(ownerHardening).toContain("'collection_immediate_rpc_owner'");
    expect(ownerHardening.match(
      /pg_get_userbyid\(function_row\.proowner\) = 'postgres'/g,
    )).toHaveLength(2);
    expect(ownerHardening).toContain('v_after_acl IS DISTINCT FROM v_before_acl');
    expect(ownerHardening).toContain('COLLECTION_IMMEDIATE_RELEASE_GATE_METADATA_CHANGED');
    expect(ownerHardening).toContain('COLLECTION_IMMEDIATE_RELEASE_GATE_BASELINE_CHANGED');
    expect(ownerHardening).toContain('COLLECTION_IMMEDIATE_RELEASE_GATE_POSTCONDITION_FAILED');
    expect(ownerHardening).toContain("'gate_migration_version', '20260913042100'");
    expect(ownerHardening).toContain(
      "'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1'",
    );
    expect(ownerHardening).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/i);
  });

  it('mantém um contrato SQL read-only para hash, ACL, flags e release marker', () => {
    expect(ownerAcceptance).toContain('6ff7ea833013958a8e54636969ec7d12');
    expect(ownerAcceptance).toContain('v_acl_is_canonical');
    expect(ownerAcceptance).toContain('collection_immediate_rpc_owner');
    expect(ownerAcceptance).toContain('20260913043419');
    expect(ownerAcceptance).toContain('20260913_acprod_collection_immediate_owner_gate_v1_1');
    expect(ownerAcceptance.trimEnd()).toMatch(
      /ROLLBACK;\s*SELECT 'COLLECTION_IMMEDIATE_OWNER_GATE_CONTRACT_OK' AS result;$/,
    );
  });

  it('alinha a versão pública ao ledger autoritativo sem reescrever a migração aplicada', () => {
    expect(ownerGateLedger).toContain('42a7a011b423cd0b624c3133326452da');
    expect(ownerGateLedger).toContain('6ff7ea833013958a8e54636969ec7d12');
    expect(ownerGateLedger).toContain("'gate_migration_version', '20260913043419'");
    expect(ownerGateLedger).toContain(
      "'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1_1'",
    );
    expect(ownerGateLedger).toContain('v_after_acl IS DISTINCT FROM v_before_acl');
    expect(ownerGateLedger).toContain('COLLECTION_IMMEDIATE_RELEASE_GATE_LEDGER_POSTCONDITION_FAILED');
    expect(ownerGateLedger).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\b/i);
  });

  it('obriga o deploy a comprovar o probe antes de gerar o build-info', () => {
    expect(workflow).toContain('get_public_collection_immediate_release');
    expect(workflow).toContain('IMMEDIATE_COLLECTION_RELEASE_OK');
    expect(workflow).toContain('collection_immediate_rpc_security');
    expect(workflow).toContain('collection_immediate_rpc_owner');
    expect(workflow).toContain('collection_immediate_rollout_all');
    expect(workflow).toContain(
      'REQUIRED_IMMEDIATE_GATE_MIGRATION_VERSION: "20260913043419"',
    );
    expect(workflow).toContain(
      'REQUIRED_IMMEDIATE_GATE_RELEASE_VERSION: "20260913_acprod_collection_immediate_owner_gate_v1_1"',
    );
    expect(workflow).toContain("payload.get('gate_migration_version', '')");
    expect(workflow).toContain("payload.get('gate_release_version', '')");
    expect(workflow).toContain(
      '"collection_immediate_gate_migration_version": "${REQUIRED_IMMEDIATE_GATE_MIGRATION_VERSION}"',
    );
    expect(workflow).toContain(
      '"collection_immediate_gate_release_version": "${REQUIRED_IMMEDIATE_GATE_RELEASE_VERSION}"',
    );
    expect(workflow).toContain('needs: [database-release]');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260906122148_collection_v3_low_latency_cycles.sql',
), 'utf8');
const structuralMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260906123339_collection_v3_structural_hardening.sql',
), 'utf8');
const runtimeHealthCompatibilityMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260906125900_collection_runtime_health_rls_initplan_compat.sql',
), 'utf8');
const loadTest = readFileSync(resolve(
  process.cwd(),
  'tests/load/collection-fabric-v3.js',
), 'utf8');
const localQueue = readFileSync(resolve(
  process.cwd(),
  'src/lib/collectionEventQueue.js',
), 'utf8');

describe('Collection Fabric V3 low-latency database contract', () => {
  it('acknowledges local capture after one blocking IndexedDB write', () => {
    const start = localQueue.indexOf('export async function enqueueCollectionEvent');
    const end = localQueue.indexOf('/**\n * Retorna estatísticas', start);
    const enqueue = localQueue.slice(start, end);

    expect(enqueue.match(/await dbPut\(event\)/g)).toHaveLength(1);
    expect(enqueue).toContain('collection_state: COLLECTION_STATES.PENDING_DATABASE');
    expect(enqueue).toContain('void dbPatchEnqueueDuration');
    expect(enqueue.indexOf('await dbPut(event)')).toBeLessThan(
      enqueue.indexOf('notifyChange()'),
    );
  });

  it('replaces the global single-flight bottleneck with bounded distributed slots', () => {
    expect(migration).toContain('private.collection_worker_slots_v3');
    expect(migration).toContain('PRIMARY KEY (worker_kind, slot_number)');
    expect(migration).toContain('p_max_slots integer DEFAULT 4');
    expect(migration).toContain("rollout_scope ->> 'max_workers'");
    expect(migration).toContain('v_default_slots := 8');
    expect(migration).toContain('v_default_slots := 4');
    expect(migration).toContain('BETWEEN 1 AND 16');
  });

  it('keeps each claim and process batch inside one short transactional RPC', () => {
    expect(migration).toContain('public.run_collection_worker_cycle_v3');
    expect(migration).toContain('public.verify_collection_worker_cron_secret(p_secret)');
    expect(migration).toContain('public.claim_collection_batch_v3(p_worker_id, v_limit)');
    expect(migration).toContain('public.process_collection_batch_v3(p_worker_id, v_items)');
    expect(migration).toContain('public.claim_collection_projection_batch_v3(p_worker_id, v_limit)');
    expect(migration).toContain('public.process_collection_projection_batch_v3(p_worker_id, v_items)');
    expect(migration).toContain('v_release_when_idle := v_claimed < v_limit');
  });

  it('indexes all case-insensitive piece resolution paths', () => {
    expect(migration).toContain('production_pieces_piece_uid_upper_v3_idx');
    expect(migration).toContain('ON public.production_pieces (upper(piece_uid)) INCLUDE (id)');
    expect(migration).toContain('production_pieces_traceability_upper_v3_idx');
    expect(migration).toContain('ON public.production_pieces (upper(traceability_code)) INCLUDE (id)');
    expect(migration).toContain('production_tags_value_upper_active_v3_idx');
    expect(migration).toContain('WHERE active IS TRUE AND piece_id IS NOT NULL');
  });

  it('separates the relaxed test gate from the unchanged production SLO', () => {
    expect(migration).toContain("('production', true, 2, 250, 800, 2000, 500, 2, 0.01, 0.01)");
    expect(migration).toContain("('test', false, 5, 1500, 1500, 5000, 2000, 5, 0.01, 0.01)");
    expect(migration).toContain('public.set_collection_slo_profile_v3');
    expect(migration).toContain('get_collection_runtime_health_raw_v3');
    expect(migration).toContain("'worker_model', 'bounded-horizontal-slots'");
    expect(loadTest).toContain("__ENV.K6_SLO_PROFILE || 'production'");
    expect(loadTest).toContain('ingressP95Ms: 250');
    expect(loadTest).toContain('ingressP95Ms: 1500');
    expect(loadTest).toContain("fail('K6_SLO_PROFILE deve ser production ou test.')");
  });

  it('keeps worker control RPCs private to service_role', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.run_collection_worker_cycle_v3(text, text, text, text, integer)',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.run_collection_worker_cycle_v3(text, text, text, text, integer)\n  TO service_role',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.handoff_collection_worker_v3(text, text, integer)\n  TO service_role',
    );
  });

  it('turns structural audit findings into fail-closed health checks', () => {
    expect(structuralMigration).toContain(
      'ALTER COLUMN function_name TYPE text',
    );
    expect(structuralMigration).toContain(
      'idx_collection_projection_outbox_reading_v3',
    );
    expect(structuralMigration).toContain(
      'WITH CHECK (auth_user_id = (SELECT auth.uid()))',
    );
    expect(structuralMigration).toContain(
      'USING (auth_user_id = (SELECT auth.uid()))',
    );
    expect(structuralMigration).toContain(
      'FROM PUBLIC, anon, authenticated',
    );
    expect(structuralMigration).toContain("'structural_checks'");
    expect(structuralMigration).toContain("'{structural_ready}'");
  });

  it('keeps the legacy release gate compatible with the optimized RLS initplan', () => {
    expect(runtimeHealthCompatibilityMigration).toContain(
      'get_public_collection_runtime_health_pre_initplan_v3',
    );
    expect(runtimeHealthCompatibilityMigration).toContain(
      "'(auth_user_id=(selectauth.uid()asuid))'",
    );
    expect(runtimeHealthCompatibilityMigration).toContain(
      "'collection_runtime_inbox_rls', coalesce(v_inbox_rls, false)",
    );
    expect(runtimeHealthCompatibilityMigration).toContain(
      "'collection_sync_async_base_ready', v_async_base_ready",
    );
    expect(runtimeHealthCompatibilityMigration).toContain(
      "WHERE flag.value <> 'true'::jsonb",
    );
    expect(runtimeHealthCompatibilityMigration).not.toContain(
      "jsonb_set(v_health, '{ready}', 'true'::jsonb",
    );
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const patch = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260906223310_collection_capacity_backend.sql'), 'utf8');
const worker = readFileSync(resolve(process.cwd(), 'supabase/functions/project-collection-v3/index.ts'), 'utf8');
const safeUpdatePatch = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260906224341_collection_capacity_safeupdate.sql'), 'utf8');
const slotsPatch = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260906224745_collection_capacity_nonblocking_slots.sql'), 'utf8');
const routePatch = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260906225452_collection_capacity_route_precedence.sql'), 'utf8');

describe('Collection V3 capacity regression contracts', () => {
  it('uses explicit routes before legacy flags and invalidates only derived caches safely', () => {
    expect(routePatch).toContain('case when piece.has_explicit_route then');
    expect(routePatch).toContain('else public.piece_requires_routing_step(');
    expect(routePatch).toContain('WHERE batch_id IS NOT NULL');
    expect(routePatch).toContain('COLLECTION_ROUTE_PRECEDENCE_QUERY_SHAPE_CHANGED');
    expect(routePatch).not.toMatch(/UPDATE\s+public\.production_pieces|DISABLE\s+ROW\s+LEVEL/i);
  });

  it('defers the shared PCP update only inside the authorized V3 decision transaction', () => {
    expect(patch).toContain("coalesce(auth.role(), '') = 'service_role'");
    expect(patch).toContain("set_config('acprod.collection_v3_decision', 'on', true)");
    expect(patch.match(/set_config\('acprod.collection_v3_decision', v_previous, true\)/g)).toHaveLength(2);
    expect(patch).toContain('PERFORM public.refresh_pcp_batch_progress(OLD.pcp_import_batch_id)');
    expect(patch).toContain('REVOKE ALL ON FUNCTION public.process_collection_batch_v3');
  });

  it('coalesces lifecycle state by scope and never passes an operator UUID as reading UUID', () => {
    expect(patch).toContain('SELECT DISTINCT ON (lot_id, cell_name, step_code, machine_id)');
    expect(patch).toContain('SELECT DISTINCT lot_id FROM pg_temp.collection_v3_projection_success');
    expect(patch).toContain('refresh_collection_lot_state(v_item.lot_id, NULL::uuid)');
    expect(patch).toContain('SET lot_state_version = lot.state_version');
    expect(patch).toContain('outbox_created_at DESC, client_event_id DESC');
    expect(patch).toContain('coalesce(result.idempotent_replay, false) IS FALSE');
  });

  it('keeps final broadcasts after consolidation and fails closed on schema drift', () => {
    expect(patch.indexOf('Enqueue broadcasts only after')).toBeGreaterThan(patch.indexOf('PERFORM public.recalculate_cell_lot_state'));
    expect(patch).toContain('COLLECTION_V3_CAPACITY_PROJECTOR_LIFECYCLE_SHAPE_CHANGED');
    expect(patch).toContain('COLLECTION_V3_CAPACITY_PROJECTOR_BROADCAST_SHAPE_CHANGED');
    expect(patch).toContain('COLLECTION_V3_CAPACITY_CYCLE_SHAPE_CHANGED');
    expect(patch.indexOf('Timestamp the COMPLETED projection')).toBeGreaterThan(patch.indexOf('PERFORM public.refresh_pcp_batch_progress(v_item.pcp_import_batch_id)'));
    expect(patch).toContain('UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now');
    expect(patch).toContain("result.value || jsonb_build_object('projected_at', v_now)");
  });

  it('bounds projection transactions without loosening timeouts or SLOs', () => {
    expect(patch).toContain('v_limit := least(v_limit, 5)');
    expect(worker).toContain('const MAX_BATCH_SIZE = 5');
    expect(worker).toContain('const MAX_RUN_DURATION_MS = 12000');
    expect(worker).toContain('handoffRequired = leaseRetained');
    expect(worker).toContain('database_code: failure.databaseCode');
    expect(patch).not.toMatch(/ALTER\s+ROLE|set_config\('statement_timeout'|SET\s+(?:LOCAL\s+)?statement_timeout/i);
  });

  it('shares route progress only in the service-role projector transaction', () => {
    expect(patch).toContain('VOLATILE SECURITY INVOKER SET search_path');
    expect(patch).toContain('private.get_lot_route_stage_progress_cached_capacity');
    expect(patch).toContain('batch_id uuid PRIMARY KEY, progress jsonb NOT NULL');
    expect(patch).toContain('COLLECTION_V3_PROJECTION_CACHE_CONTEXT_REQUIRED');
    expect(patch.match(/set_config\('acprod.collection_v3_projection_cache', v_previous, true\)/g)).toHaveLength(2);
    expect(patch).toContain('COLLECTION_V3_CAPACITY_BATCH_SNAPSHOT_REQUIRED');
    expect(patch).not.toContain('ALTER FUNCTION public.get_lot_route_stage_progress');
  });

  it('works with PostgREST safe-update protection and reports fixed diagnostic labels only', () => {
    expect(safeUpdatePatch).toContain('WHERE outbox_id IS NOT NULL');
    expect(safeUpdatePatch).not.toMatch(/safeupdate\.enabled.*(?:off|false)/i);
    expect(worker).toContain('SAFEUPDATE_UPDATE_WITHOUT_WHERE');
    expect(worker).toContain('SAFEUPDATE_DELETE_WITHOUT_WHERE');
    expect(worker).toContain('database_reason: failure.databaseReason');
    expect(worker).not.toContain('error.message');
  });

  it('never waits for another worker owner or occupied slot before trying the next slot', () => {
    expect(slotsPatch).toContain('pg_try_advisory_xact_lock');
    expect(slotsPatch).not.toMatch(/\bpg_advisory_xact_lock\(/);
    expect(slotsPatch).toContain('AND expires_at > v_now');
    expect(slotsPatch).toContain("EXCEPTION WHEN SQLSTATE 'ZV301'");
    expect(slotsPatch).toContain('AND slot_number = v_slot AND lease_owner = v_owner');
    expect(slotsPatch).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(slotsPatch.indexOf('acprod:v3:worker-owner:')).toBeLessThan(slotsPatch.indexOf('acprod:v3:worker-slot:'));
  });
});

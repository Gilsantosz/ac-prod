import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260830150210_security_audit_remediation.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

describe('security audit database remediation', () => {
  it('replaces global production reads with cell-scoped policies', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS po_select_all_auth');
    expect(migration).toContain('DROP POLICY IF EXISTS lots_select_all_auth');
    expect(migration).toContain('DROP POLICY IF EXISTS prod_lot_items_write');
    expect(migration).toContain('DROP POLICY IF EXISTS prod_routes_manage');
    expect(migration).toContain('DROP POLICY IF EXISTS prod_tags_write');
    expect(migration).toContain('USING (public.can_access_production_order(id))');
    expect(migration).toContain('USING (public.can_access_production_lot(id))');
    expect(migration).not.toMatch(/CREATE POLICY[^;]+FOR SELECT[^;]+USING\s*\(true\)/is);
  });

  it('enforces shipping permission and lot scope inside the RPC', () => {
    expect(migration).toMatch(/release_cover_shipment[\s\S]+has_permission\('manage_shipping'\)/);
    expect(migration).toMatch(/release_cover_shipment[\s\S]+NOT public\.can_access_production_lot\(lot\.id\)/);
  });

  it('closes direct operator writes and scopes management RPCs', () => {
    expect(migration).toContain('public.can_manage_operator_scope(p_operator_id, v_cell_ids)');
    expect(migration).toContain('public.can_manage_operator_scope(p_operator_id, NULL)');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.admin_upsert_operator\(uuid, jsonb\)[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.operator_cell_assignments FROM authenticated');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.operator_machine_assignments FROM authenticated');
  });

  it('enforces alert permission and cell scope inside the RPC', () => {
    expect(migration).toMatch(/resolve_mes_alert[\s\S]+has_permission\('resolve_mes_alerts'\)/);
    expect(migration).toMatch(/resolve_mes_alert[\s\S]+profile_can_access_cell\(v_alert\.cell\)/);
    expect(migration).toContain('REVOKE UPDATE ON TABLE public.alert_logs FROM authenticated');
  });
});

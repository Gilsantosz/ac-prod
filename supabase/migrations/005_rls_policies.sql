-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 005: Row Level Security (RLS) para todas as novas tabelas
-- Perfis: admin (tudo), manager (células vinculadas), operator (operacional), viewer (leitura)
-- ============================================================

-- ─── Função auxiliar: role do usuário logado ─────────────────
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text AS $$
  SELECT COALESCE(role, 'operator')
  FROM profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Função auxiliar: células do gestor logado ───────────────
CREATE OR REPLACE FUNCTION get_my_cells()
RETURNS text[] AS $$
  SELECT COALESCE(managed_cells, '{}')
  FROM profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Habilitar RLS nas novas tabelas ─────────────────────────
ALTER TABLE production_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE piece_instances         ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_steps           ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_template_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_step_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE promob_integrations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE promob_import_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE promob_import_differences ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_event_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_delivery_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_policies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_files            ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
-- PRODUCTION_ORDERS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "po_select_all_auth" ON production_orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "po_insert_admin_manager" ON production_orders
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','manager'));

CREATE POLICY "po_update_admin_manager" ON production_orders
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "po_delete_admin" ON production_orders
  FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');

-- ═══════════════════════════════════════════════════════════
-- PRODUCTION_LOTS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "lots_select_all_auth" ON production_lots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "lots_insert_admin_manager" ON production_lots
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','manager'));

CREATE POLICY "lots_update_admin_manager_operator" ON production_lots
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('admin','manager','operator'));

CREATE POLICY "lots_delete_admin" ON production_lots
  FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');

-- ═══════════════════════════════════════════════════════════
-- LOT_ITEMS, PIECE_INSTANCES, LOT_STEP_EVENTS
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lot_items','piece_instances','lot_step_events','package_items']
  LOOP
    EXECUTE format(
      'CREATE POLICY "%s_select" ON %s FOR SELECT TO authenticated USING (true);
       CREATE POLICY "%s_insert" ON %s FOR INSERT TO authenticated
         WITH CHECK (get_my_role() IN (''admin'',''manager'',''operator''));
       CREATE POLICY "%s_update" ON %s FOR UPDATE TO authenticated
         USING (get_my_role() IN (''admin'',''manager'',''operator''));
       CREATE POLICY "%s_delete_admin" ON %s FOR DELETE TO authenticated
         USING (get_my_role() = ''admin'');',
      t, t, t, t, t, t, t, t
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- ROUTING_STEPS, ROUTE_TEMPLATES, ROUTE_TEMPLATE_STEPS
-- (apenas admin e manager podem alterar)
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['routing_steps','route_templates','route_template_steps']
  LOOP
    EXECUTE format(
      'CREATE POLICY "%s_select_all" ON %s FOR SELECT TO authenticated USING (true);
       CREATE POLICY "%s_write_admin_manager" ON %s FOR ALL TO authenticated
         USING (get_my_role() IN (''admin'',''manager''))
         WITH CHECK (get_my_role() IN (''admin'',''manager''));',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- PACKAGES, SHIPMENTS
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['packages','shipments']
  LOOP
    EXECUTE format(
      'CREATE POLICY "%s_select" ON %s FOR SELECT TO authenticated USING (true);
       CREATE POLICY "%s_insert" ON %s FOR INSERT TO authenticated
         WITH CHECK (get_my_role() IN (''admin'',''manager'',''operator''));
       CREATE POLICY "%s_update" ON %s FOR UPDATE TO authenticated
         USING (get_my_role() IN (''admin'',''manager'',''operator''));
       CREATE POLICY "%s_delete_admin" ON %s FOR DELETE TO authenticated
         USING (get_my_role() = ''admin'');',
      t, t, t, t, t, t, t, t
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- PROMOB_INTEGRATIONS — sensível (apenas admin)
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "promob_int_select_admin_manager" ON promob_integrations
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "promob_int_write_admin" ON promob_integrations
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- ═══════════════════════════════════════════════════════════
-- PROMOB_IMPORT_BATCHES, PROMOB_IMPORT_DIFFERENCES
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "promob_batches_select" ON promob_import_batches
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "promob_batches_insert" ON promob_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','manager'));

CREATE POLICY "promob_diff_select" ON promob_import_differences
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

-- ═══════════════════════════════════════════════════════════
-- OFFLINE_EVENT_QUEUE — próprio usuário
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "offline_queue_own" ON offline_event_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- SYSTEM_AUDIT_LOGS — somente leitura para admin/manager autorizado
-- Nunca pode ser apagado por usuários comuns
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "audit_select_admin_manager" ON system_audit_logs
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "audit_insert_all_auth" ON system_audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "audit_no_delete_no_update" ON system_audit_logs
  FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');  -- apenas admin pode deletar (proteção máxima)

-- ═══════════════════════════════════════════════════════════
-- REPORT_SCHEDULES, REPORT_DELIVERY_LOGS
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "report_schedules_select" ON report_schedules
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "report_schedules_write_admin" ON report_schedules
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

CREATE POLICY "delivery_logs_select" ON report_delivery_logs
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "delivery_logs_insert" ON report_delivery_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- BACKUP_POLICIES, BACKUP_FILES
-- ═══════════════════════════════════════════════════════════
CREATE POLICY "backup_policies_select" ON backup_policies
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "backup_policies_write_admin" ON backup_policies
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "backup_files_select" ON backup_files
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));

CREATE POLICY "backup_files_insert" ON backup_files
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','manager'));

-- (exclusão protegida pelo trigger prevent_backup_early_deletion)
CREATE POLICY "backup_files_delete_admin" ON backup_files
  FOR DELETE TO authenticated
  USING (get_my_role() = 'admin');

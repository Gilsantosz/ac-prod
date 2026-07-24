-- Leo Flow — acesso granular por página e isolamento operacional por célula.

-- Preserva compatibilidade com perfis existentes, separando visualização e edição.
UPDATE public.profiles
SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object(
  'view_collection', COALESCE(permissions -> 'view_collection', permissions -> 'traceability_collect', 'false'::jsonb),
  'view_joinery', COALESCE(permissions -> 'view_joinery', permissions -> 'view_traceability', 'false'::jsonb),
  'manage_joinery', COALESCE(permissions -> 'manage_joinery', permissions -> 'traceability_collect', 'false'::jsonb),
  'view_oee', COALESCE(permissions -> 'view_oee', permissions -> 'view_dashboards', 'false'::jsonb),
  'manage_lot_integrity', COALESCE(permissions -> 'manage_lot_integrity', permissions -> 'view_traceability', 'false'::jsonb),
  'view_manual_production', COALESCE(permissions -> 'view_manual_production', permissions -> 'register_manual_production', 'false'::jsonb),
  'view_routes', COALESCE(permissions -> 'view_routes', permissions -> 'manage_routes', 'false'::jsonb),
  'view_packaging', COALESCE(permissions -> 'view_packaging', permissions -> 'manage_packaging', 'false'::jsonb),
  'view_shipping', COALESCE(permissions -> 'view_shipping', permissions -> 'manage_shipping', 'false'::jsonb),
  'resolve_mes_alerts', COALESCE(permissions -> 'resolve_mes_alerts', permissions -> 'view_mes_alerts', 'false'::jsonb),
  'view_daily_summary', COALESCE(permissions -> 'view_daily_summary', permissions -> 'view_dashboards', 'false'::jsonb),
  'view_occurrences', COALESCE(permissions -> 'view_occurrences', permissions -> 'manage_occurrences', 'false'::jsonb),
  'view_ai', COALESCE(permissions -> 'view_ai', permissions -> 'ai_operations', 'false'::jsonb),
  'view_automations', COALESCE(permissions -> 'view_automations', permissions -> 'manage_automations', 'false'::jsonb),
  'view_gamification', COALESCE(permissions -> 'view_gamification', permissions -> 'view_dashboards', 'false'::jsonb),
  'view_users', COALESCE(permissions -> 'view_users', permissions -> 'manage_users', 'false'::jsonb),
  'view_operators', COALESCE(permissions -> 'view_operators', permissions -> 'manage_operators', 'false'::jsonb),
  'view_cells', COALESCE(permissions -> 'view_cells', permissions -> 'manage_cells', 'false'::jsonb),
  'view_backups', COALESCE(permissions -> 'view_backups', 'false'::jsonb),
  'manage_backups', COALESCE(permissions -> 'manage_backups', 'false'::jsonb),
  'view_integrity_logs', COALESCE(permissions -> 'view_integrity_logs', permissions -> 'manage_operators', 'false'::jsonb)
);

UPDATE public.profiles
SET managed_cells = ARRAY[cell],
    access_scope = jsonb_set(
      COALESCE(access_scope, '{}'::jsonb),
      '{cells}',
      to_jsonb(ARRAY[cell]),
      true
    )
WHERE role = 'operator'
  AND COALESCE(array_length(managed_cells, 1), 0) = 0
  AND NULLIF(btrim(cell), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.profile_can_access_cell(p_cell text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_cell text;
  v_managed_cells text[];
  v_active boolean;
BEGIN
  IF auth.uid() IS NULL OR NULLIF(btrim(p_cell), '') IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, cell, managed_cells, active
  INTO v_role, v_cell, v_managed_cells, v_active
  FROM public.profiles
  WHERE id = auth.uid();

  IF COALESCE(v_active, false) = false THEN
    RETURN false;
  END IF;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  v_managed_cells := COALESCE(v_managed_cells, '{}'::text[]);
  IF array_length(v_managed_cells, 1) IS NULL AND NULLIF(btrim(v_cell), '') IS NOT NULL THEN
    v_managed_cells := ARRAY[v_cell];
  END IF;

  IF v_role = 'operator' THEN
    RETURN p_cell = ANY(v_managed_cells);
  END IF;

  -- Gestores, supervisores e visualizadores sem escopo explícito mantêm visão global.
  RETURN array_length(v_managed_cells, 1) IS NULL OR p_cell = ANY(v_managed_cells);
END;
$$;

REVOKE ALL ON FUNCTION public.profile_can_access_cell(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_can_access_cell(text) TO authenticated, service_role;

-- Células: operadores só descobrem as células autorizadas; escrita exige permissão.
DROP POLICY IF EXISTS cells_select_auth ON public.cells;
DROP POLICY IF EXISTS cells_authenticated_read ON public.cells;
DROP POLICY IF EXISTS cells_write_admin_manager ON public.cells;
DROP POLICY IF EXISTS cells_admin_write ON public.cells;

CREATE POLICY cells_scoped_read ON public.cells
  FOR SELECT TO authenticated
  USING (
    public.profile_can_access_cell(name)
    OR public.has_permission('view_cells')
    OR public.has_permission('manage_cells')
  );

CREATE POLICY cells_permission_write ON public.cells
  FOR ALL TO authenticated
  USING (public.has_permission('manage_cells'))
  WITH CHECK (public.has_permission('manage_cells'));

-- Produção e KPIs: leitura e mutação limitadas à célula do perfil.
DROP POLICY IF EXISTS production_entries_read ON public.production_entries;
DROP POLICY IF EXISTS production_entries_insert ON public.production_entries;
DROP POLICY IF EXISTS production_entries_update ON public.production_entries;
DROP POLICY IF EXISTS production_entries_delete ON public.production_entries;

CREATE POLICY production_entries_scoped_read ON public.production_entries
  FOR SELECT TO authenticated
  USING (public.profile_can_access_cell(cell));

CREATE POLICY production_entries_scoped_insert ON public.production_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_can_access_cell(cell)
    AND (
      public.has_permission('register_production')
      OR public.has_permission('register_manual_production')
      OR public.has_permission('traceability_collect')
    )
    AND (created_by = auth.uid() OR public.get_my_role() IN ('admin', 'manager'))
  );

CREATE POLICY production_entries_scoped_update ON public.production_entries
  FOR UPDATE TO authenticated
  USING (
    public.profile_can_access_cell(cell)
    AND (
      public.has_permission('register_production')
      OR public.has_permission('register_manual_production')
    )
  )
  WITH CHECK (
    public.profile_can_access_cell(cell)
    AND (
      public.has_permission('register_production')
      OR public.has_permission('register_manual_production')
    )
  );

CREATE POLICY production_entries_scoped_delete ON public.production_entries
  FOR DELETE TO authenticated
  USING (
    public.profile_can_access_cell(cell)
    AND public.get_my_role() IN ('admin', 'manager')
  );

-- Ledger permanente das coletas: histórico e inserções seguem o mesmo escopo.
DROP POLICY IF EXISTS collection_events_select ON public.production_collection_events;
DROP POLICY IF EXISTS collection_events_insert ON public.production_collection_events;
DROP POLICY IF EXISTS collection_events_update ON public.production_collection_events;

CREATE POLICY collection_events_scoped_read ON public.production_collection_events
  FOR SELECT TO authenticated
  USING (public.profile_can_access_cell(cell_name));

CREATE POLICY collection_events_scoped_insert ON public.production_collection_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_can_access_cell(cell_name)
    AND public.has_permission('traceability_collect')
  );

CREATE POLICY collection_events_scoped_update ON public.production_collection_events
  FOR UPDATE TO authenticated
  USING (
    public.profile_can_access_cell(cell_name)
    AND (
      public.has_permission('traceability_collect')
      OR public.get_my_role() IN ('admin', 'manager', 'supervisor')
    )
  )
  WITH CHECK (
    public.profile_can_access_cell(cell_name)
    AND (
      public.has_permission('traceability_collect')
      OR public.get_my_role() IN ('admin', 'manager', 'supervisor')
    )
  );

-- Ocorrências também fazem parte do escopo produtivo da célula.
DROP POLICY IF EXISTS occurrences_select_auth ON public.occurrences;
DROP POLICY IF EXISTS occurrences_insert_auth ON public.occurrences;
DROP POLICY IF EXISTS occurrences_update_auth ON public.occurrences;
DROP POLICY IF EXISTS occurrences_delete_admin ON public.occurrences;

CREATE POLICY occurrences_scoped_read ON public.occurrences
  FOR SELECT TO authenticated
  USING (
    public.profile_can_access_cell(cell)
    AND (
      public.has_permission('view_occurrences')
      OR public.has_permission('manage_occurrences')
    )
  );

CREATE POLICY occurrences_scoped_insert ON public.occurrences
  FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_can_access_cell(cell)
    AND public.has_permission('manage_occurrences')
  );

CREATE POLICY occurrences_scoped_update ON public.occurrences
  FOR UPDATE TO authenticated
  USING (public.profile_can_access_cell(cell) AND public.has_permission('manage_occurrences'))
  WITH CHECK (public.profile_can_access_cell(cell) AND public.has_permission('manage_occurrences'));

CREATE POLICY occurrences_scoped_delete ON public.occurrences
  FOR DELETE TO authenticated
  USING (
    public.profile_can_access_cell(cell)
    AND public.get_my_role() IN ('admin', 'manager')
  );

-- Cadastros de operadores e seus vínculos deixam de ser visíveis globalmente.
DROP POLICY IF EXISTS operators_select_auth ON public.operators;
DROP POLICY IF EXISTS operators_insert_auth ON public.operators;
DROP POLICY IF EXISTS operators_update_auth ON public.operators;
DROP POLICY IF EXISTS operators_delete_admin ON public.operators;

CREATE POLICY operators_authorized_read ON public.operators
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.has_permission('view_operators')
    OR public.has_permission('manage_operators')
  );

CREATE POLICY operators_permission_write ON public.operators
  FOR ALL TO authenticated
  USING (public.has_permission('manage_operators'))
  WITH CHECK (public.has_permission('manage_operators'));

DROP POLICY IF EXISTS policy_authenticated_select_cell_assignments ON public.operator_cell_assignments;
DROP POLICY IF EXISTS policy_select_own_cell_assignments ON public.operator_cell_assignments;
CREATE POLICY operator_cell_assignments_authorized_read ON public.operator_cell_assignments
  FOR SELECT TO authenticated
  USING (
    public.has_permission('view_operators')
    OR public.has_permission('manage_operators')
    OR EXISTS (
      SELECT 1
      FROM public.operators o
      WHERE o.id = operator_id
        AND o.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS policy_authenticated_select_machine_assignments ON public.operator_machine_assignments;
DROP POLICY IF EXISTS policy_select_own_machine_assignments ON public.operator_machine_assignments;
CREATE POLICY operator_machine_assignments_authorized_read ON public.operator_machine_assignments
  FOR SELECT TO authenticated
  USING (
    public.has_permission('view_operators')
    OR public.has_permission('manage_operators')
    OR EXISTS (
      SELECT 1
      FROM public.operators o
      WHERE o.id = operator_id
        AND o.profile_id = auth.uid()
    )
  );

-- AC.Prod2 / Leo Flow
-- Remediação dos achados da auditoria de segurança de 2026-08-30.
--
-- 1. restringe leitura operacional ao escopo de células do perfil;
-- 2. exige manage_shipping e escopo na expedição de capas;
-- 3. impede IDOR nas RPCs de operadores e fecha escrita direta equivalente;
-- 4. exige resolve_mes_alerts e escopo de célula para resolver alertas;
-- 5. endurece a leitura/escrita direta de alert_logs.

BEGIN;

-- ─── Helpers de escopo produtivo ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_profile_has_global_cell_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT
      profile.active IS DISTINCT FROM false
      AND (
        profile.role = 'admin'
        OR (
          profile.role IS DISTINCT FROM 'operator'
          AND COALESCE(array_length(profile.managed_cells, 1), 0) = 0
          AND NULLIF(btrim(profile.cell), '') IS NULL
        )
      )
    FROM public.profiles profile
    WHERE profile.id = (SELECT auth.uid())
  ), false);
$$;

REVOKE ALL ON FUNCTION public.current_profile_has_global_cell_access()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_has_global_cell_access()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_production_lot(p_lot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;

  IF public.current_profile_has_global_cell_access() THEN
    RETURN true;
  END IF;

  SELECT COALESCE(lot.production_order_id, lot.order_id)
  INTO v_order_id
  FROM public.production_lots lot
  WHERE lot.id = p_lot_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN
    EXISTS (
      SELECT 1
      FROM public.production_lots lot
      WHERE lot.id = p_lot_id
        AND public.profile_can_access_cell(lot.current_cell)
    )
    OR EXISTS (
      SELECT 1
      FROM public.production_lot_items item
      WHERE item.lot_id = p_lot_id
        AND public.profile_can_access_cell(item.current_cell)
    )
    OR EXISTS (
      SELECT 1
      FROM public.production_routes route
      WHERE route.lot_id = p_lot_id
        AND public.profile_can_access_cell(route.cell_name)
    )
    OR EXISTS (
      SELECT 1
      FROM public.production_stage_readings reading
      WHERE reading.lot_id = p_lot_id
        AND public.profile_can_access_cell(reading.cell_name)
    )
    OR EXISTS (
      SELECT 1
      FROM public.production_collection_events event
      WHERE event.lot_id = p_lot_id
        AND public.profile_can_access_cell(event.cell_name)
    )
    OR EXISTS (
      SELECT 1
      FROM public.production_entries entry
      WHERE entry.production_order_id = v_order_id
        AND public.profile_can_access_cell(entry.cell)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_production_lot(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_production_lot(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_production_order(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (
      public.current_profile_has_global_cell_access()
      OR EXISTS (
        SELECT 1
        FROM public.production_entries entry
        WHERE entry.production_order_id = p_order_id
          AND public.profile_can_access_cell(entry.cell)
      )
      OR EXISTS (
        SELECT 1
        FROM public.production_lots lot
        WHERE COALESCE(lot.production_order_id, lot.order_id) = p_order_id
          AND public.can_access_production_lot(lot.id)
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_production_order(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_production_order(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_production_order_item(
  p_order_id uuid,
  p_lot_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (
      public.current_profile_has_global_cell_access()
      OR (p_lot_id IS NOT NULL AND public.can_access_production_lot(p_lot_id))
      OR public.can_access_production_order(p_order_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_production_order_item(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_production_order_item(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_production_piece(p_piece_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.production_pieces piece
    WHERE piece.id = p_piece_id
      AND (SELECT auth.uid()) IS NOT NULL
      AND (
        public.current_profile_has_global_cell_access()
        OR (
          piece.lot_id IS NOT NULL
          AND public.can_access_production_lot(piece.lot_id)
        )
        OR (
          piece.production_order_id IS NOT NULL
          AND public.can_access_production_order(piece.production_order_id)
        )
        OR EXISTS (
          SELECT 1
          FROM public.production_stage_readings reading
          WHERE reading.piece_id = piece.id
            AND public.profile_can_access_cell(reading.cell_name)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_production_piece(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_production_piece(uuid)
  TO authenticated, service_role;

-- Remove as políticas globais confirmadas no catálogo implantado.
DROP POLICY IF EXISTS po_select_all_auth ON public.production_orders;
DROP POLICY IF EXISTS lots_select_all_auth ON public.production_lots;
DROP POLICY IF EXISTS production_order_items_select ON public.production_order_items;
DROP POLICY IF EXISTS prod_lot_items_select ON public.production_lot_items;
DROP POLICY IF EXISTS prod_routes_select ON public.production_routes;
DROP POLICY IF EXISTS prod_tags_select ON public.production_tags;
DROP POLICY IF EXISTS stage_readings_select ON public.production_stage_readings;
DROP POLICY IF EXISTS pieces_select ON public.production_pieces;

DROP POLICY IF EXISTS production_orders_scoped_read ON public.production_orders;
CREATE POLICY production_orders_scoped_read
ON public.production_orders FOR SELECT TO authenticated
USING (public.can_access_production_order(id));

DROP POLICY IF EXISTS production_lots_scoped_read ON public.production_lots;
CREATE POLICY production_lots_scoped_read
ON public.production_lots FOR SELECT TO authenticated
USING (public.can_access_production_lot(id));

DROP POLICY IF EXISTS production_order_items_scoped_read ON public.production_order_items;
CREATE POLICY production_order_items_scoped_read
ON public.production_order_items FOR SELECT TO authenticated
USING (public.can_access_production_order_item(production_order_id, lot_id));

DROP POLICY IF EXISTS production_lot_items_scoped_read ON public.production_lot_items;
CREATE POLICY production_lot_items_scoped_read
ON public.production_lot_items FOR SELECT TO authenticated
USING (
  public.current_profile_has_global_cell_access()
  OR public.profile_can_access_cell(current_cell)
  OR (NULLIF(btrim(current_cell), '') IS NULL AND public.can_access_production_lot(lot_id))
);

DROP POLICY IF EXISTS production_routes_scoped_read ON public.production_routes;
CREATE POLICY production_routes_scoped_read
ON public.production_routes FOR SELECT TO authenticated
USING (
  public.current_profile_has_global_cell_access()
  OR public.profile_can_access_cell(cell_name)
);

DROP POLICY IF EXISTS production_tags_scoped_read ON public.production_tags;
CREATE POLICY production_tags_scoped_read
ON public.production_tags FOR SELECT TO authenticated
USING (
  public.current_profile_has_global_cell_access()
  OR (piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
  OR EXISTS (
    SELECT 1
    FROM public.production_lot_items item
    WHERE item.id = production_tags.item_id
      AND (
        public.profile_can_access_cell(item.current_cell)
        OR (
          NULLIF(btrim(item.current_cell), '') IS NULL
          AND public.can_access_production_lot(item.lot_id)
        )
      )
  )
  OR (item_id IS NULL AND public.can_access_production_lot(lot_id))
);

DROP POLICY IF EXISTS production_stage_readings_scoped_read ON public.production_stage_readings;
CREATE POLICY production_stage_readings_scoped_read
ON public.production_stage_readings FOR SELECT TO authenticated
USING (
  public.current_profile_has_global_cell_access()
  OR public.profile_can_access_cell(cell_name)
  OR (
    NULLIF(btrim(cell_name), '') IS NULL
    AND piece_id IS NOT NULL
    AND public.can_access_production_piece(piece_id)
  )
  OR (
    NULLIF(btrim(cell_name), '') IS NULL
    AND piece_id IS NULL
    AND public.can_access_production_lot(lot_id)
  )
);

DROP POLICY IF EXISTS production_pieces_scoped_read ON public.production_pieces;
CREATE POLICY production_pieces_scoped_read
ON public.production_pieces FOR SELECT TO authenticated
USING (public.can_access_production_piece(id));

-- Políticas FOR ALL antigas também participavam do SELECT por serem
-- permissivas. Elas são separadas por comando para não reabrir a leitura.
DROP POLICY IF EXISTS production_order_items_write ON public.production_order_items;
CREATE POLICY production_order_items_scoped_insert
ON public.production_order_items FOR INSERT TO authenticated
WITH CHECK (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_pcp')
  )
  AND public.can_access_production_order_item(production_order_id, lot_id)
);
CREATE POLICY production_order_items_scoped_update
ON public.production_order_items FOR UPDATE TO authenticated
USING (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_pcp')
  )
  AND public.can_access_production_order_item(production_order_id, lot_id)
)
WITH CHECK (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_pcp')
  )
  AND public.can_access_production_order_item(production_order_id, lot_id)
);
CREATE POLICY production_order_items_scoped_delete
ON public.production_order_items FOR DELETE TO authenticated
USING (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_pcp')
  )
  AND public.can_access_production_order_item(production_order_id, lot_id)
);

DROP POLICY IF EXISTS prod_lot_items_write ON public.production_lot_items;
CREATE POLICY production_lot_items_scoped_insert
ON public.production_lot_items FOR INSERT TO authenticated
WITH CHECK (
  public.get_my_role() IN ('admin', 'manager', 'operator')
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(current_cell)
    OR (NULLIF(btrim(current_cell), '') IS NULL AND public.can_access_production_lot(lot_id))
  )
);
CREATE POLICY production_lot_items_scoped_update
ON public.production_lot_items FOR UPDATE TO authenticated
USING (
  public.get_my_role() IN ('admin', 'manager', 'operator')
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(current_cell)
    OR (NULLIF(btrim(current_cell), '') IS NULL AND public.can_access_production_lot(lot_id))
  )
)
WITH CHECK (
  public.get_my_role() IN ('admin', 'manager', 'operator')
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(current_cell)
    OR (NULLIF(btrim(current_cell), '') IS NULL AND public.can_access_production_lot(lot_id))
  )
);
CREATE POLICY production_lot_items_scoped_delete
ON public.production_lot_items FOR DELETE TO authenticated
USING (
  public.get_my_role() IN ('admin', 'manager')
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(current_cell)
    OR (NULLIF(btrim(current_cell), '') IS NULL AND public.can_access_production_lot(lot_id))
  )
);

DROP POLICY IF EXISTS prod_routes_manage ON public.production_routes;
CREATE POLICY production_routes_scoped_insert
ON public.production_routes FOR INSERT TO authenticated
WITH CHECK (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_routes')
  )
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(cell_name)
  )
);
CREATE POLICY production_routes_scoped_update
ON public.production_routes FOR UPDATE TO authenticated
USING (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_routes')
  )
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(cell_name)
  )
)
WITH CHECK (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_routes')
  )
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(cell_name)
  )
);
CREATE POLICY production_routes_scoped_delete
ON public.production_routes FOR DELETE TO authenticated
USING (
  (
    public.get_my_role() IN ('admin', 'manager')
    OR public.has_permission('manage_routes')
  )
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(cell_name)
  )
);

DROP POLICY IF EXISTS prod_tags_write ON public.production_tags;
CREATE POLICY production_tags_scoped_insert
ON public.production_tags FOR INSERT TO authenticated
WITH CHECK (
  public.get_my_role() IN ('admin', 'manager', 'operator')
  AND (
    public.current_profile_has_global_cell_access()
    OR (piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
    OR (piece_id IS NULL AND public.can_access_production_lot(lot_id))
  )
);
CREATE POLICY production_tags_scoped_update
ON public.production_tags FOR UPDATE TO authenticated
USING (
  public.get_my_role() IN ('admin', 'manager', 'operator')
  AND (
    public.current_profile_has_global_cell_access()
    OR (piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
    OR (piece_id IS NULL AND public.can_access_production_lot(lot_id))
  )
)
WITH CHECK (
  public.get_my_role() IN ('admin', 'manager', 'operator')
  AND (
    public.current_profile_has_global_cell_access()
    OR (piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
    OR (piece_id IS NULL AND public.can_access_production_lot(lot_id))
  )
);
CREATE POLICY production_tags_scoped_delete
ON public.production_tags FOR DELETE TO authenticated
USING (
  public.get_my_role() IN ('admin', 'manager')
  AND (
    public.current_profile_has_global_cell_access()
    OR (piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
    OR (piece_id IS NULL AND public.can_access_production_lot(lot_id))
  )
);

-- ─── Expedição autorizada no servidor ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_cover_shipment(
  p_cover_id uuid,
  p_carrier text,
  p_vehicle text,
  p_driver text,
  p_tracking_code text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cover public.customer_covers%ROWTYPE;
  v_shipment_id uuid;
  v_lot record;
  v_operator uuid := (SELECT auth.uid());
BEGIN
  IF v_operator IS NULL OR NOT public.has_permission('manage_shipping') THEN
    RAISE EXCEPTION 'SHIPPING_PERMISSION_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'A expedição exige um perfil ativo com manage_shipping.';
  END IF;

  SELECT * INTO v_cover
  FROM public.customer_covers
  WHERE id = p_cover_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Capa de cliente não encontrada.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.production_lots lot
    WHERE lot.customer_cover_id = p_cover_id
      AND NOT public.can_access_production_lot(lot.id)
  ) THEN
    RAISE EXCEPTION 'SHIPPING_CELL_SCOPE_REQUIRED'
      USING ERRCODE = '42501',
            HINT = 'A capa contém lote fora das células autorizadas.';
  END IF;

  INSERT INTO public.shipments (
    customer_cover_id,
    shipment_code,
    carrier,
    vehicle,
    driver,
    tracking_code,
    status,
    notes,
    shipped_by,
    shipped_at
  ) VALUES (
    p_cover_id,
    'SHIP-' || v_cover.cover_code,
    p_carrier,
    p_vehicle,
    p_driver,
    p_tracking_code,
    'shipped',
    p_notes,
    v_operator,
    now()
  )
  RETURNING id INTO v_shipment_id;

  UPDATE public.customer_covers
  SET status = 'shipped',
      shipped_at = now(),
      shipped_by = v_operator
  WHERE id = p_cover_id;

  FOR v_lot IN
    SELECT id, lot_code
    FROM public.production_lots
    WHERE customer_cover_id = p_cover_id
  LOOP
    PERFORM public.update_production_lot_status_safely(v_lot.id, 'shipped');

    INSERT INTO public.lot_step_events (
      lot_id,
      step_code,
      event_type,
      notes,
      quantity
    ) VALUES (
      v_lot.id,
      'shipping',
      'finish',
      'Expedido via Capa ' || v_cover.cover_code,
      0
    );
  END LOOP;

  UPDATE public.production_pieces
  SET current_stage = 'Expedição',
      status = 'completed'
  WHERE lot_id IN (
    SELECT id
    FROM public.production_lots
    WHERE customer_cover_id = p_cover_id
  );

  INSERT INTO public.customer_cover_events (
    cover_id,
    event_type,
    shipment_id,
    operator_id,
    metadata
  ) VALUES (
    p_cover_id,
    'shipped',
    v_shipment_id,
    v_operator,
    jsonb_build_object('carrier', p_carrier, 'vehicle', p_vehicle, 'driver', p_driver)
  );

  RETURN jsonb_build_object('success', true, 'shipment_id', v_shipment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.release_cover_shipment(uuid, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_cover_shipment(uuid, text, text, text, text, text)
  TO authenticated, service_role;

-- ─── Escopo de operadores e bloqueio do bypass PostgREST ───────────────────

CREATE OR REPLACE FUNCTION public.can_manage_operator_scope(
  p_operator_id uuid,
  p_requested_cell_ids uuid[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_primary_cell text;
  v_target_has_assignments boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_operators() THEN
    RETURN false;
  END IF;

  SELECT profile.role
  INTO v_role
  FROM public.profiles profile
  WHERE profile.id = (SELECT auth.uid())
    AND profile.active IS DISTINCT FROM false;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  IF p_requested_cell_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(p_requested_cell_ids) requested(cell_id)
    LEFT JOIN public.cells cell ON cell.id = requested.cell_id AND cell.active IS TRUE
    WHERE cell.id IS NULL
       OR NOT public.profile_can_access_cell(cell.name)
  ) THEN
    RETURN false;
  END IF;

  IF p_operator_id IS NULL THEN
    RETURN true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.operators operator WHERE operator.id = p_operator_id) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.operator_cell_assignments assignment
    WHERE assignment.operator_id = p_operator_id
      AND assignment.active IS TRUE
  )
  INTO v_target_has_assignments;

  IF v_target_has_assignments THEN
    RETURN NOT EXISTS (
      SELECT 1
      FROM public.operator_cell_assignments assignment
      JOIN public.cells cell ON cell.id = assignment.cell_id
      WHERE assignment.operator_id = p_operator_id
        AND assignment.active IS TRUE
        AND NOT public.profile_can_access_cell(cell.name)
    );
  END IF;

  SELECT operator.primary_cell
  INTO v_primary_cell
  FROM public.operators operator
  WHERE operator.id = p_operator_id;

  RETURN public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(v_primary_cell);
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_operator_scope(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_operator_scope(uuid, uuid[])
  TO service_role;

-- A implementação base deixa de ser um endpoint chamável diretamente.
REVOKE ALL ON FUNCTION public.admin_upsert_operator(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_operator(uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_operator_v2(
  p_operator_id uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_operator_id uuid;
  v_replacement_enabled boolean;
  v_cell_ids uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_operators() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para gerenciar colaboradores.');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value::uuid), ARRAY[]::uuid[])
  INTO v_cell_ids
  FROM jsonb_array_elements_text(COALESCE(p_data -> 'cell_ids', '[]'::jsonb));

  IF p_operator_id IS NOT NULL THEN
    PERFORM 1
    FROM public.operators operator
    WHERE operator.id = p_operator_id
    FOR UPDATE;
  END IF;

  IF NOT public.can_manage_operator_scope(p_operator_id, v_cell_ids) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para gerenciar colaboradores neste escopo.');
  END IF;

  v_result := public.admin_upsert_operator(p_operator_id, COALESCE(p_data, '{}'::jsonb));
  IF COALESCE((v_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_operator_id := NULLIF(v_result #>> '{operator,id}', '')::uuid;
  IF v_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'O cadastro não retornou um colaborador válido.');
  END IF;

  IF COALESCE(p_data, '{}'::jsonb) ? 'replacement_enabled' THEN
    v_replacement_enabled := COALESCE((p_data ->> 'replacement_enabled')::boolean, false);
    UPDATE public.operators
    SET replacement_enabled = v_replacement_enabled
    WHERE id = v_operator_id;
  ELSE
    SELECT operator.replacement_enabled
    INTO v_replacement_enabled
    FROM public.operators operator
    WHERE operator.id = v_operator_id;
  END IF;

  RETURN jsonb_set(
    v_result,
    '{operator,replacement_enabled}',
    to_jsonb(COALESCE(v_replacement_enabled, false)),
    true
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Um vínculo informado possui formato inválido.');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_operator_v2(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_operator_v2(uuid, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_unlock_operator(p_operator_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM public.operators operator
  WHERE operator.id = p_operator_id
  FOR UPDATE;

  IF NOT FOUND
    OR (SELECT auth.uid()) IS NULL
    OR NOT public.can_manage_operator_scope(p_operator_id, NULL)
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sem permissão para gerenciar colaboradores neste escopo.');
  END IF;

  UPDATE public.operators
  SET failed_login_count = 0,
      locked_until = NULL
  WHERE id = p_operator_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlock_operator(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unlock_operator(uuid)
  TO authenticated, service_role;

-- Somente as RPCs SECURITY DEFINER podem alterar operadores e vínculos. A
-- atualização textual abaixo permanece para a cascata controlada de renome de
-- células; os IDs/credenciais continuam indisponíveis para escrita direta.
DROP POLICY IF EXISTS operators_permission_write ON public.operators;
DROP POLICY IF EXISTS operators_cell_reference_sync ON public.operators;
CREATE POLICY operators_cell_reference_sync
ON public.operators FOR UPDATE TO authenticated
USING (public.has_permission('manage_cells'))
WITH CHECK (public.has_permission('manage_cells'));

REVOKE INSERT, UPDATE, DELETE ON TABLE public.operators FROM authenticated;
GRANT UPDATE (primary_cell, cells) ON TABLE public.operators TO authenticated;

DROP POLICY IF EXISTS policy_admin_manage_cell_assignments ON public.operator_cell_assignments;
DROP POLICY IF EXISTS policy_admin_manage_machine_assignments ON public.operator_machine_assignments;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.operator_cell_assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.operator_machine_assignments FROM authenticated;

-- ─── Alertas MES: permissão e célula no banco ───────────────────────────────

DROP POLICY IF EXISTS alert_logs_read ON public.alert_logs;
DROP POLICY IF EXISTS alert_logs_update ON public.alert_logs;
DROP POLICY IF EXISTS alert_logs_scoped_read ON public.alert_logs;
CREATE POLICY alert_logs_scoped_read
ON public.alert_logs FOR SELECT TO authenticated
USING (
  (
    public.has_permission('view_mes_alerts')
    OR public.has_permission('resolve_mes_alerts')
  )
  AND (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(cell)
  )
);

REVOKE UPDATE ON TABLE public.alert_logs FROM authenticated;

CREATE OR REPLACE FUNCTION public.resolve_mes_alert(
  p_alert_id uuid,
  p_resolution_note text
)
RETURNS public.alert_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_alert public.alert_logs%ROWTYPE;
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR NOT public.has_permission('resolve_mes_alerts') THEN
    RAISE EXCEPTION 'MES_ALERT_RESOLUTION_PERMISSION_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_alert
  FROM public.alert_logs
  WHERE id = p_alert_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alerta não localizado ou fora do escopo.'
      USING ERRCODE = 'P0012';
  END IF;

  IF NOT (
    public.current_profile_has_global_cell_access()
    OR public.profile_can_access_cell(v_alert.cell)
  ) THEN
    RAISE EXCEPTION 'Alerta não localizado ou fora do escopo.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.alert_logs
  SET resolved = true,
      resolved_at = now(),
      resolved_by = v_user_id,
      resolution_source = 'manual',
      resolution_note = p_resolution_note,
      updated_at = now()
  WHERE id = p_alert_id
  RETURNING * INTO v_alert;

  RETURN v_alert;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_mes_alert(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_mes_alert(uuid, text)
  TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- AC.Prod MES — vínculo canônico ordem de reposição → peça reprovada → lote
-- Evita que cards e modal reutilizem dados de outra ordem do mesmo lote geral.
-- ============================================================================

BEGIN;

-- Atualiza os snapshots das ordens existentes sem alterar original_piece_id.
WITH canonical AS (
  SELECT
    ro.id AS replacement_order_id,
    p.lot_id,
    COALESCE(p.production_order_id, l.production_order_id, l.order_id) AS production_order_id,
    COALESCE(NULLIF(p.lot_code, ''), NULLIF(l.lot_code, ''), NULLIF(ro.lot_code, '')) AS lot_code,
    COALESCE(NULLIF(l.general_lot_code, ''), NULLIF(ro.general_lot_code, '')) AS general_lot_code,
    COALESCE(
      NULLIF(p.order_number, ''),
      NULLIF(po.order_number, ''),
      NULLIF(po.order_code, ''),
      NULLIF(l.order_number, ''),
      NULLIF(ro.order_number, '')
    ) AS order_number,
    COALESCE(
      NULLIF(p.customer_name, ''),
      NULLIF(po.customer_name, ''),
      NULLIF(l.customer_name, ''),
      NULLIF(ro.customer_name, '')
    ) AS customer_name,
    COALESCE(
      NULLIF(p.environment_name, ''),
      NULLIF(p.environment, ''),
      NULLIF(ro.environment_name, '')
    ) AS environment_name
  FROM public.replacement_orders ro
  JOIN public.production_pieces p ON p.id = ro.original_piece_id
  LEFT JOIN public.production_lots l ON l.id = p.lot_id
  LEFT JOIN public.production_orders po
    ON po.id = COALESCE(p.production_order_id, l.production_order_id, l.order_id)
)
UPDATE public.replacement_orders ro
SET
  lot_id = c.lot_id,
  production_order_id = c.production_order_id,
  lot_code = c.lot_code,
  general_lot_code = c.general_lot_code,
  order_number = c.order_number,
  customer_name = c.customer_name,
  environment_name = c.environment_name,
  updated_at = now()
FROM canonical c
WHERE ro.id = c.replacement_order_id;

CREATE OR REPLACE FUNCTION public.get_replacement_order_context(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.replacement_orders%ROWTYPE;
  v_original public.production_pieces%ROWTYPE;
  v_replacement public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_production_order public.production_orders%ROWTYPE;
  v_production_order_id uuid;
  v_lot_code text;
  v_general_lot_code text;
  v_order_number text;
  v_customer_name text;
  v_environment_name text;
  v_barcode text;
  v_route text[];
  v_order_json jsonb;
  v_original_json jsonb;
  v_replacement_json jsonb;
BEGIN
  SELECT * INTO v_order
  FROM public.replacement_orders
  WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Ordem de reposição não encontrada.';
  END IF;

  SELECT * INTO v_original
  FROM public.production_pieces
  WHERE id = v_order.original_piece_id;

  IF v_original.id IS NULL THEN
    RAISE EXCEPTION 'A ordem % não possui peça original válida.', COALESCE(v_order.replacement_code, v_order.id::text);
  END IF;

  IF v_order.replacement_piece_id IS NOT NULL THEN
    SELECT * INTO v_replacement
    FROM public.production_pieces
    WHERE id = v_order.replacement_piece_id;
  END IF;

  IF v_original.lot_id IS NOT NULL THEN
    SELECT * INTO v_lot
    FROM public.production_lots
    WHERE id = v_original.lot_id;
  END IF;

  v_production_order_id := COALESCE(
    v_original.production_order_id,
    v_lot.production_order_id,
    v_lot.order_id,
    v_order.production_order_id
  );

  IF v_production_order_id IS NOT NULL THEN
    SELECT * INTO v_production_order
    FROM public.production_orders
    WHERE id = v_production_order_id;
  END IF;

  v_lot_code := COALESCE(
    NULLIF(v_original.lot_code, ''),
    NULLIF(v_lot.lot_code, ''),
    NULLIF(v_order.lot_code, '')
  );
  v_general_lot_code := COALESCE(
    NULLIF(v_lot.general_lot_code, ''),
    NULLIF(v_order.general_lot_code, '')
  );
  v_order_number := COALESCE(
    NULLIF(v_original.order_number, ''),
    NULLIF(v_production_order.order_number, ''),
    NULLIF(v_production_order.order_code, ''),
    NULLIF(v_lot.order_number, ''),
    NULLIF(v_order.order_number, '')
  );
  v_customer_name := COALESCE(
    NULLIF(v_original.customer_name, ''),
    NULLIF(v_production_order.customer_name, ''),
    NULLIF(v_lot.customer_name, ''),
    NULLIF(v_order.customer_name, '')
  );
  v_environment_name := COALESCE(
    NULLIF(v_original.environment_name, ''),
    NULLIF(v_original.environment, ''),
    NULLIF(v_order.environment_name, '')
  );
  v_barcode := COALESCE(
    NULLIF(v_order.replacement_barcode, ''),
    NULLIF(v_original.traceability_code, ''),
    NULLIF(v_original.piece_uid, ''),
    NULLIF(v_original.piece_code, '')
  );
  v_route := COALESCE(v_original.route_steps, '{}'::text[]);

  v_order_json := to_jsonb(v_order) || jsonb_build_object(
    'lot_id', v_original.lot_id,
    'production_order_id', v_production_order_id,
    'lot_code', v_lot_code,
    'general_lot_code', v_general_lot_code,
    'order_number', v_order_number,
    'customer_name', v_customer_name,
    'environment_name', v_environment_name
  );

  v_original_json := to_jsonb(v_original) || jsonb_build_object(
    'lot_code', v_lot_code,
    'general_lot_code', v_general_lot_code,
    'order_number', v_order_number,
    'customer_name', v_customer_name,
    'environment_name', v_environment_name,
    'lot', CASE WHEN v_lot.id IS NULL THEN NULL ELSE to_jsonb(v_lot) END,
    'production_order', CASE WHEN v_production_order.id IS NULL THEN NULL ELSE to_jsonb(v_production_order) END
  );

  v_replacement_json := CASE
    WHEN v_replacement.id IS NULL THEN NULL
    ELSE to_jsonb(v_replacement) || jsonb_build_object(
      'lot_code', v_lot_code,
      'general_lot_code', v_general_lot_code,
      'order_number', v_order_number,
      'customer_name', v_customer_name,
      'environment_name', v_environment_name
    )
  END;

  RETURN jsonb_build_object(
    'order', v_order_json,
    'original_piece', v_original_json,
    'replacement_piece', v_replacement_json,
    'replacement_code', v_order.replacement_code,
    'barcode', v_barcode,
    'route_steps', to_jsonb(v_route),
    'integrity', jsonb_build_object(
      'order_id', v_order.id,
      'original_piece_id', v_order.original_piece_id,
      'resolved_piece_id', v_original.id,
      'piece_link_valid', v_order.original_piece_id = v_original.id,
      'lot_link_valid', v_order.lot_id IS NULL OR v_order.lot_id = v_original.lot_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_replacement_approval_cells(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_context jsonb;
  v_order public.replacement_orders%ROWTYPE;
  v_original public.production_pieces%ROWTYPE;
  v_route text[];
  v_cells jsonb;
BEGIN
  v_context := public.get_replacement_order_context(p_order_id);

  SELECT * INTO v_order
  FROM public.replacement_orders
  WHERE id = p_order_id;

  SELECT * INTO v_original
  FROM public.production_pieces
  WHERE id = v_order.original_piece_id;

  v_route := COALESCE(v_original.route_steps, '{}'::text[]);
  IF cardinality(v_route) = 0 THEN
    v_route := ARRAY[]::text[];
    IF COALESCE(v_original.requires_cut, false) THEN v_route := array_append(v_route, 'cut'); END IF;
    IF COALESCE(v_original.requires_edge, false) THEN v_route := array_append(v_route, 'edge'); END IF;
    IF COALESCE(v_original.requires_cnc, false) THEN v_route := array_append(v_route, 'cnc'); END IF;
    IF COALESCE(v_original.requires_joinery, false) THEN v_route := array_append(v_route, 'joinery'); END IF;
    IF COALESCE(v_original.requires_separation, false) THEN v_route := array_append(v_route, 'separation'); END IF;
    IF COALESCE(v_original.requires_packaging, false) THEN v_route := array_append(v_route, 'packaging'); END IF;
  END IF;

  WITH route AS (
    SELECT
      r.ordinality,
      r.raw_step,
      public.normalize_replacement_step_code(r.raw_step) AS step_code
    FROM unnest(v_route) WITH ORDINALITY AS r(raw_step, ordinality)
  ), eligible AS (
    SELECT
      route.ordinality,
      c.id AS cell_id,
      c.name AS cell_name,
      route.step_code,
      COALESCE(rs.name, route.raw_step, c.name) AS step_name,
      (
        public.normalize_replacement_step_code(v_order.rejection_stage) = route.step_code
        OR lower(trim(COALESCE(v_order.origin_cell_name, ''))) = lower(trim(c.name))
      ) AS is_rejection_stage
    FROM route
    LEFT JOIN public.routing_steps rs ON rs.code = route.step_code
    JOIN public.cells c
      ON c.active IS TRUE
     AND public.replacement_cell_matches_step(c.name, route.step_code)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'selection_key', eligible.cell_id::text || ':' || eligible.step_code,
        'cell_id', eligible.cell_id,
        'cell_name', eligible.cell_name,
        'step_code', eligible.step_code,
        'step_name', eligible.step_name,
        'is_rejection_stage', eligible.is_rejection_stage
      ) ORDER BY eligible.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_cells
  FROM eligible;

  RETURN v_context || jsonb_build_object(
    'route_steps', to_jsonb(v_route),
    'cells', v_cells
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_replacement_order_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_replacement_approval_cells(uuid) TO authenticated;

COMMIT;

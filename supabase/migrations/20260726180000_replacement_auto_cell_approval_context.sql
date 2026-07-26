-- ============================================================================
-- AC.Prod MES — aprovação de reposição com retorno à fila e baixas automáticas
-- ============================================================================

BEGIN;

ALTER TABLE public.replacement_orders
  ADD COLUMN IF NOT EXISTS replacement_barcode text,
  ADD COLUMN IF NOT EXISTS approved_cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_entry_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.production_stage_readings
  DROP CONSTRAINT IF EXISTS production_stage_readings_event_type_check;

ALTER TABLE public.production_stage_readings
  ADD CONSTRAINT production_stage_readings_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'approved_scan'::text,
    'rejected_scan'::text,
    'wrong_step'::text,
    'duplicated_scan'::text,
    'manual_adjustment'::text,
    'rfid_bulk_read'::text,
    'replacement_approval'::text
  ]));

CREATE OR REPLACE FUNCTION public.normalize_replacement_step_code(p_value text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text := lower(trim(COALESCE(p_value, '')));
  v_code text;
BEGIN
  IF v_value = '' THEN RETURN NULL; END IF;

  SELECT rs.code
  INTO v_code
  FROM public.routing_steps rs
  WHERE lower(rs.code) = v_value OR lower(rs.name) = v_value
  ORDER BY rs.sequence NULLS LAST
  LIMIT 1;

  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  RETURN CASE
    WHEN v_value IN ('corte', 'cut') THEN 'cut'
    WHEN v_value IN ('borda', 'bordo', 'edge') THEN 'edge'
    WHEN v_value IN ('usinagem', 'cnc') THEN 'cnc'
    WHEN v_value IN ('furação', 'furacao', 'drill') THEN 'drill'
    WHEN v_value IN ('marcenaria', 'joinery') THEN 'joinery'
    WHEN v_value IN ('separação', 'separacao', 'separation') THEN 'separation'
    WHEN v_value IN ('embalagem', 'packaging') THEN 'packaging'
    WHEN v_value IN ('expedição', 'expedicao', 'shipping') THEN 'shipping'
    ELSE regexp_replace(v_value, '[^a-z0-9_]+', '_', 'g')
  END;
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
  v_order public.replacement_orders%ROWTYPE;
  v_original public.production_pieces%ROWTYPE;
  v_route text[];
  v_cells jsonb;
  v_barcode text;
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
    RAISE EXCEPTION 'Peça original não encontrada.';
  END IF;

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

  v_barcode := COALESCE(
    NULLIF(v_order.replacement_barcode, ''),
    NULLIF(v_original.traceability_code, ''),
    NULLIF(v_original.piece_uid, ''),
    NULLIF(v_original.piece_code, '')
  );

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
      (public.normalize_replacement_step_code(v_order.rejection_stage) = route.step_code
        OR lower(trim(COALESCE(v_order.origin_cell_name, ''))) = lower(trim(c.name))) AS is_rejection_stage
    FROM route
    LEFT JOIN public.routing_steps rs ON rs.code = route.step_code
    JOIN public.cells c
      ON c.active IS TRUE
     AND (
       lower(trim(c.name)) = lower(trim(COALESCE(rs.name, route.raw_step)))
       OR (route.step_code = 'cut' AND lower(c.name) = 'corte')
       OR (route.step_code = 'edge' AND lower(c.name) IN ('borda', 'bordo'))
       OR (route.step_code IN ('cnc', 'drill', 'canal', 'maranello', 'portajoias', 'sorrento', 'usi_especial', 'rasgo_freggio') AND lower(c.name) = 'usinagem')
       OR (route.step_code = 'joinery' AND lower(c.name) = 'marcenaria')
       OR (route.step_code = 'packaging' AND lower(c.name) = 'embalagem')
       OR (route.step_code = 'shipping' AND lower(c.name) = 'expedição')
     )
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

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'replacement_code', v_order.replacement_code,
    'barcode', v_barcode,
    'route_steps', to_jsonb(v_route),
    'cells', v_cells
  );
END;
$$;


COMMIT;

-- MIGRATION 055
-- Hotfix da função criada na migration 054: production_pieces não possui requires_shipping.
-- Também consolida o cálculo de peças elegíveis em uma única CTE para evitar duplicidade.

CREATE OR REPLACE FUNCTION public.piece_requires_routing_step(
  p_step_code text,
  p_route_steps text[],
  p_requires_cut boolean,
  p_requires_edge boolean,
  p_requires_cnc boolean,
  p_requires_joinery boolean,
  p_requires_separation boolean,
  p_requires_packaging boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN cardinality(COALESCE(p_route_steps, ARRAY[]::text[])) > 0
      THEN p_step_code = ANY(p_route_steps)
    WHEN p_step_code = 'cut' THEN COALESCE(p_requires_cut, true)
    WHEN p_step_code = 'edge' THEN COALESCE(p_requires_edge, false)
    WHEN p_step_code IN ('cnc', 'drill') THEN COALESCE(p_requires_cnc, false)
    WHEN p_step_code = 'joinery' THEN COALESCE(p_requires_joinery, false)
    WHEN p_step_code = 'separation' THEN COALESCE(p_requires_separation, true)
    WHEN p_step_code = 'packaging' THEN COALESCE(p_requires_packaging, true)
    WHEN p_step_code = 'shipping' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot_v2(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_pcp_import_batch_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_code text;
  v_expected bigint := 0;
  v_approved_cumulative bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_active_lots bigint := 0;
  v_active_batches bigint := 0;
  v_shift_total_reads bigint := 0;
  v_shift_approved_events bigint := 0;
  v_shift_unique_completions bigint := 0;
  v_shift_rejected bigint := 0;
  v_shift_blocked bigint := 0;
  v_shift_duplicated bigint := 0;
  v_shift_errors bigint := 0;
  v_active_general_lots jsonb := '[]'::jsonb;
BEGIN
  SELECT step.code
  INTO v_step_code
  FROM public.routing_steps step
  WHERE lower(step.code) = lower(p_cell_name)
     OR lower(step.name) = lower(p_cell_name)
     OR (lower(p_cell_name) IN ('borda', 'bordo') AND step.code = 'edge')
     OR (lower(p_cell_name) IN ('usinagem', 'cnc') AND step.code = 'cnc')
     OR (lower(p_cell_name) IN ('furação', 'furacao', 'drill') AND step.code = 'drill')
     OR (lower(p_cell_name) IN ('corte', 'cut') AND step.code = 'cut')
     OR (lower(p_cell_name) IN ('marcenaria', 'joinery') AND step.code = 'joinery')
     OR (lower(p_cell_name) IN ('separação', 'separacao', 'separation') AND step.code = 'separation')
     OR (lower(p_cell_name) IN ('embalagem', 'packaging') AND step.code = 'packaging')
     OR (lower(p_cell_name) IN ('expedição', 'expedicao', 'shipping') AND step.code = 'shipping')
  ORDER BY step.sequence NULLS LAST
  LIMIT 1;

  v_step_code := COALESCE(v_step_code, lower(trim(p_cell_name)));

  WITH eligible_pieces AS (
    SELECT
      piece.id,
      piece.lot_id,
      piece.status,
      piece.rework_status,
      piece.replacement_status,
      piece.is_replacement,
      COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id) AS effective_batch_id
    FROM public.production_pieces piece
    JOIN public.production_lots lot ON lot.id = piece.lot_id
    LEFT JOIN public.promob_import_batches batch
      ON batch.id = COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id)
    WHERE COALESCE(piece.is_active, true) IS TRUE
      AND piece.status NOT IN ('cancelled', 'replaced', 'shipped')
      AND lot.status NOT IN ('closed', 'shipped', 'cancelled')
      AND (
        (
          COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id) IS NOT NULL
          AND batch.id IS NOT NULL
          AND batch.status NOT IN ('cancelled', 'error', 'failed_validation', 'duplicated')
        )
        OR (
          COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id) IS NULL
          AND COALESCE(piece.source_origin, 'manual') IN ('manual', 'rework')
        )
      )
      AND (p_pcp_import_batch_id IS NULL OR COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id) = p_pcp_import_batch_id)
      AND (p_lot_id IS NULL OR piece.lot_id = p_lot_id)
      AND public.piece_requires_routing_step(
        v_step_code,
        piece.route_steps,
        piece.requires_cut,
        piece.requires_edge,
        piece.requires_cnc,
        piece.requires_joinery,
        piece.requires_separation,
        piece.requires_packaging
      )
  )
  SELECT
    count(DISTINCT eligible.id),
    count(DISTINCT eligible.id) FILTER (
      WHERE eligible.status IN ('rework', 'rework_pending', 'rework_in_progress')
         OR eligible.rework_status IN ('pending', 'in_progress')
    ),
    count(DISTINCT eligible.id) FILTER (
      WHERE eligible.is_replacement IS TRUE
         OR eligible.status IN ('replacement_requested', 'replacement_in_production')
         OR eligible.replacement_status IN ('requested', 'in_production')
    ),
    count(DISTINCT eligible.lot_id),
    count(DISTINCT eligible.effective_batch_id),
    count(DISTINCT fact.piece_id)
  INTO
    v_expected,
    v_rework,
    v_replacement,
    v_active_lots,
    v_active_batches,
    v_approved_cumulative
  FROM eligible_pieces eligible
  LEFT JOIN public.collection_stage_facts fact
    ON fact.piece_id = eligible.id
   AND fact.step_code_canonico = v_step_code;

  v_pending := GREATEST(v_expected - v_approved_cumulative, 0);

  SELECT
    count(*),
    count(*) FILTER (WHERE event.status = 'synced' AND event.result_status = 'approved'),
    count(*) FILTER (WHERE event.result_status = 'rejected'),
    count(*) FILTER (WHERE event.result_status = 'blocked'),
    count(*) FILTER (WHERE event.result_status = 'duplicated'),
    count(*) FILTER (WHERE event.status = 'error')
  INTO
    v_shift_total_reads,
    v_shift_approved_events,
    v_shift_rejected,
    v_shift_blocked,
    v_shift_duplicated,
    v_shift_errors
  FROM public.production_collection_events event
  WHERE lower(COALESCE(event.cell_name, '')) = lower(p_cell_name)
    AND (p_workstation_id IS NULL OR event.machine_id = p_workstation_id)
    AND (p_shift IS NULL OR event.shift = p_shift)
    AND (p_date_from IS NULL OR COALESCE(event.created_at_client, event.last_attempt_at, event.created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(event.created_at_client, event.last_attempt_at, event.created_at) < p_date_to)
    AND (p_pcp_import_batch_id IS NULL OR event.pcp_import_batch_id = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR event.lot_id = p_lot_id);

  SELECT count(DISTINCT reading.piece_id)
  INTO v_shift_unique_completions
  FROM public.production_stage_readings reading
  WHERE reading.step_name = v_step_code
    AND reading.status = 'approved'
    AND (p_workstation_id IS NULL OR reading.machine_id = p_workstation_id)
    AND (p_shift IS NULL OR reading.shift = p_shift)
    AND (p_date_from IS NULL OR reading.created_at >= p_date_from)
    AND (p_date_to IS NULL OR reading.created_at < p_date_to)
    AND (p_pcp_import_batch_id IS NULL OR reading.piece_id IN (
      SELECT piece.id
      FROM public.production_pieces piece
      WHERE piece.pcp_import_batch_id = p_pcp_import_batch_id
    ))
    AND (p_lot_id IS NULL OR reading.lot_id = p_lot_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(active_batch)), '[]'::jsonb)
  INTO v_active_general_lots
  FROM (
    SELECT batch.id, batch.general_lot_code, batch.progress_percent
    FROM public.promob_import_batches batch
    WHERE batch.status NOT IN ('cancelled', 'error', 'failed_validation', 'duplicated')
      AND EXISTS (
        SELECT 1
        FROM public.production_pieces piece
        JOIN public.production_lots lot ON lot.id = piece.lot_id
        WHERE COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id) = batch.id
          AND COALESCE(piece.is_active, true) IS TRUE
          AND piece.status NOT IN ('cancelled', 'replaced', 'shipped')
          AND lot.status NOT IN ('closed', 'shipped', 'cancelled')
      )
    ORDER BY batch.created_at DESC
    LIMIT 15
  ) active_batch;

  RETURN jsonb_build_object(
    'total', v_shift_total_reads,
    'approved', v_approved_cumulative,
    'rejected', v_shift_rejected,
    'blocked', v_shift_blocked + v_shift_duplicated,
    'expected', v_expected,
    'pending', v_pending,
    'rework', v_rework,
    'replacement', v_replacement,
    'active_lots', v_active_lots,
    'active_pcp_batches', v_active_batches,
    'step_code', v_step_code,
    'integrity', jsonb_build_object(
      'scope', 'cumulative_active_lots',
      'expected', v_expected,
      'approved', v_approved_cumulative,
      'pending', v_pending,
      'rework', v_rework,
      'replacement', v_replacement
    ),
    'shift_activity', jsonb_build_object(
      'scope', 'current_shift',
      'total_reads', v_shift_total_reads,
      'approved_events', v_shift_approved_events,
      'unique_completions', v_shift_unique_completions,
      'approved_unique_stage_completions', v_shift_unique_completions,
      'rejected', v_shift_rejected,
      'blocked', v_shift_blocked + v_shift_duplicated,
      'duplicated', v_shift_duplicated,
      'errors', v_shift_errors
    ),
    'active_general_lots', v_active_general_lots
  );
END;
$$;

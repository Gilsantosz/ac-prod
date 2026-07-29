-- Reconcilia os KPIs da coleta com baixas manuais por volume e alinha a
-- permissão de persistência de metas com os perfis aceitos pelo frontend.

CREATE OR REPLACE FUNCTION public.can_manage_production_goals()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND COALESCE(profile.active, true) IS TRUE
      AND (
        lower(COALESCE(profile.role, '')) IN ('admin', 'manager', 'gestor', 'supervisor')
        OR lower(COALESCE(profile.permissions ->> 'manage_goals', 'false')) IN ('true', '1', 'yes')
        OR lower(COALESCE(profile.permissions ->> 'manage_cells', 'false')) IN ('true', '1', 'yes')
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_manage_production_goals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_production_goals() TO authenticated;

DROP POLICY IF EXISTS production_daily_goals_write ON public.production_daily_goals;
CREATE POLICY production_daily_goals_write
  ON public.production_daily_goals
  FOR ALL
  TO authenticated
  USING (public.can_manage_production_goals())
  WITH CHECK (public.can_manage_production_goals());

CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot_v2(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL::uuid,
  p_shift text DEFAULT NULL::text,
  p_date_from timestamptz DEFAULT NULL::timestamptz,
  p_date_to timestamptz DEFAULT NULL::timestamptz,
  p_pcp_import_batch_id uuid DEFAULT NULL::uuid,
  p_lot_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_step_code text;
  v_expected bigint := 0;
  v_traceable_approved_cumulative bigint := 0;
  v_manual_approved_cumulative bigint := 0;
  v_approved_cumulative bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_active_lots bigint := 0;
  v_active_batches bigint := 0;
  v_shift_total_reads bigint := 0;
  v_shift_approved_events bigint := 0;
  v_shift_unique_completions bigint := 0;
  v_shift_manual_quantity bigint := 0;
  v_produced_this_shift bigint := 0;
  v_shift_rejected bigint := 0;
  v_shift_blocked bigint := 0;
  v_shift_duplicated bigint := 0;
  v_shift_errors bigint := 0;
  v_active_general_lots jsonb := '[]'::jsonb;
BEGIN
  v_step_code := COALESCE(
    public.resolve_production_stage_for_cell(NULL, p_cell_name),
    '__unmapped_cell__'
  );

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
      AND (
        p_pcp_import_batch_id IS NULL
        OR COALESCE(piece.pcp_import_batch_id, lot.pcp_import_batch_id) = p_pcp_import_batch_id
      )
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
  ),
  progress_by_batch AS (
    SELECT
      eligible.effective_batch_id,
      count(DISTINCT eligible.id)::bigint AS expected,
      count(DISTINCT eligible.id) FILTER (
        WHERE eligible.status IN ('rework', 'rework_pending', 'rework_in_progress')
           OR eligible.rework_status IN ('pending', 'in_progress')
      )::bigint AS rework,
      count(DISTINCT eligible.id) FILTER (
        WHERE eligible.is_replacement IS TRUE
           OR eligible.status IN ('replacement_requested', 'replacement_in_production')
           OR eligible.replacement_status IN ('requested', 'in_production')
      )::bigint AS replacement,
      count(DISTINCT eligible.lot_id)::bigint AS active_lots,
      count(DISTINCT fact.piece_id)::bigint AS traceable_approved,
      CASE
        WHEN p_lot_id IS NOT NULL OR eligible.effective_batch_id IS NULL THEN 0::bigint
        ELSE COALESCE(manual.quantity, 0)::bigint
      END AS manual_quantity
    FROM eligible_pieces eligible
    LEFT JOIN public.collection_stage_facts fact
      ON fact.piece_id = eligible.id
     AND fact.step_code_canonico = v_step_code
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(record.quantity), 0)::bigint AS quantity
      FROM public.manual_production_records record
      WHERE record.pcp_import_batch_id = eligible.effective_batch_id
        AND record.stage_code = v_step_code
        AND record.status = 'approved'
    ) manual ON true
    GROUP BY eligible.effective_batch_id, manual.quantity
  )
  SELECT
    COALESCE(sum(progress.expected), 0)::bigint,
    COALESCE(sum(progress.rework), 0)::bigint,
    COALESCE(sum(progress.replacement), 0)::bigint,
    COALESCE(sum(progress.active_lots), 0)::bigint,
    count(*) FILTER (WHERE progress.effective_batch_id IS NOT NULL)::bigint,
    COALESCE(sum(progress.traceable_approved), 0)::bigint,
    COALESCE(sum(
      LEAST(
        GREATEST(progress.expected - progress.traceable_approved, 0),
        progress.manual_quantity
      )
    ), 0)::bigint,
    COALESCE(sum(
      LEAST(
        progress.expected,
        progress.traceable_approved + progress.manual_quantity
      )
    ), 0)::bigint
  INTO
    v_expected,
    v_rework,
    v_replacement,
    v_active_lots,
    v_active_batches,
    v_traceable_approved_cumulative,
    v_manual_approved_cumulative,
    v_approved_cumulative
  FROM progress_by_batch progress;

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
    AND (
      p_date_from IS NULL
      OR COALESCE(event.created_at_client, event.last_attempt_at, event.created_at) >= p_date_from
    )
    AND (
      p_date_to IS NULL
      OR COALESCE(event.created_at_client, event.last_attempt_at, event.created_at) < p_date_to
    )
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
    AND (
      p_pcp_import_batch_id IS NULL
      OR reading.piece_id IN (
        SELECT piece.id
        FROM public.production_pieces piece
        WHERE piece.pcp_import_batch_id = p_pcp_import_batch_id
      )
    )
    AND (p_lot_id IS NULL OR reading.lot_id = p_lot_id);

  IF p_lot_id IS NULL THEN
    SELECT COALESCE(sum(record.quantity), 0)::bigint
    INTO v_shift_manual_quantity
    FROM public.manual_production_records record
    JOIN public.promob_import_batches batch
      ON batch.id = record.pcp_import_batch_id
    WHERE lower(COALESCE(record.cell_name, '')) = lower(p_cell_name)
      AND record.stage_code = v_step_code
      AND record.status = 'approved'
      AND (p_shift IS NULL OR record.shift = p_shift)
      AND (p_date_from IS NULL OR record.created_at >= p_date_from)
      AND (p_date_to IS NULL OR record.created_at < p_date_to)
      AND (
        p_pcp_import_batch_id IS NULL
        OR record.pcp_import_batch_id = p_pcp_import_batch_id
      )
      AND batch.status NOT IN ('cancelled', 'error', 'failed_validation', 'duplicated');
  END IF;

  v_produced_this_shift := v_shift_unique_completions + v_shift_manual_quantity;

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
    'produced_this_shift', v_produced_this_shift,
    'approved', v_approved_cumulative,
    'traceable_approved', v_traceable_approved_cumulative,
    'manual_approved', v_manual_approved_cumulative,
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
      'traceable_approved', v_traceable_approved_cumulative,
      'manual_approved', v_manual_approved_cumulative,
      'pending', v_pending,
      'rework', v_rework,
      'replacement', v_replacement
    ),
    'shift_activity', jsonb_build_object(
      'scope', 'current_shift',
      'total_reads', v_shift_total_reads,
      'approved_events', v_shift_approved_events,
      'unique_completions', v_shift_unique_completions,
      'manual_quantity', v_shift_manual_quantity,
      'produced_quantity', v_produced_this_shift,
      'approved_unique_stage_completions', v_shift_unique_completions,
      'rejected', v_shift_rejected,
      'blocked', v_shift_blocked + v_shift_duplicated,
      'duplicated', v_shift_duplicated,
      'errors', v_shift_errors
    ),
    'traceability', jsonb_build_object(
      'full_quantity', v_traceable_approved_cumulative,
      'limited_quantity', v_manual_approved_cumulative
    ),
    'active_general_lots', v_active_general_lots
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) IS
  'Snapshot da coleta reconciliado por lote: soma leituras individualizadas e baixas manuais agregadas sem criar rastreabilidade sintética.';

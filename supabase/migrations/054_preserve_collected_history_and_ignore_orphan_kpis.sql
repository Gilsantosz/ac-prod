-- MIGRATION 054
-- Corrige a integridade dos KPIs e estabelece a regra de cancelamento/exclusão de lotes PCP:
-- 1) importação sem qualquer coleta produtiva pode ser removida integralmente;
-- 2) importação com coleta é cancelada, mas todo o histórico produtivo é preservado;
-- 3) peças importadas sem vínculo com um lote PCP ativo não entram nos KPIs.

CREATE OR REPLACE FUNCTION public.delete_promob_import_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.promob_import_batches%ROWTYPE;
  v_lot_ids uuid[] := ARRAY[]::uuid[];
  v_piece_ids uuid[] := ARRAY[]::uuid[];
  v_order_ids uuid[] := ARRAY[]::uuid[];
  v_has_production boolean := false;
  v_deleted_pieces integer := 0;
  v_deleted_lots integer := 0;
  v_deleted_orders integer := 0;
  v_preserved_readings integer := 0;
  v_preserved_events integer := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'ID da importação não pode ser nulo.';
  END IF;

  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND profile.active IS TRUE
      AND profile.role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Somente administradores ou gestores podem excluir/cancelar lotes PCP.';
  END IF;

  SELECT *
  INTO v_batch
  FROM public.promob_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importação PCP não encontrada: %', p_batch_id;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lot.id), ARRAY[]::uuid[])
  INTO v_lot_ids
  FROM public.production_lots lot
  WHERE lot.pcp_import_batch_id = p_batch_id
     OR (v_batch.generated_op_id IS NOT NULL AND (
          lot.order_id = v_batch.generated_op_id
          OR lot.production_order_id = v_batch.generated_op_id
        ));

  SELECT COALESCE(array_agg(DISTINCT piece.id), ARRAY[]::uuid[])
  INTO v_piece_ids
  FROM public.production_pieces piece
  WHERE piece.pcp_import_batch_id = p_batch_id
     OR piece.lot_id = ANY(v_lot_ids)
     OR (v_batch.generated_op_id IS NOT NULL AND piece.production_order_id = v_batch.generated_op_id);

  SELECT COALESCE(array_agg(DISTINCT order_id), ARRAY[]::uuid[])
  INTO v_order_ids
  FROM (
    SELECT v_batch.generated_op_id AS order_id
    WHERE v_batch.generated_op_id IS NOT NULL
    UNION
    SELECT lot.order_id
    FROM public.production_lots lot
    WHERE lot.id = ANY(v_lot_ids) AND lot.order_id IS NOT NULL
    UNION
    SELECT lot.production_order_id
    FROM public.production_lots lot
    WHERE lot.id = ANY(v_lot_ids) AND lot.production_order_id IS NOT NULL
    UNION
    SELECT piece.production_order_id
    FROM public.production_pieces piece
    WHERE piece.id = ANY(v_piece_ids) AND piece.production_order_id IS NOT NULL
  ) linked_orders;

  -- Eventos do tipo "note" criados durante a importação não representam início produtivo.
  v_has_production :=
    EXISTS (
      SELECT 1 FROM public.production_stage_readings reading
      WHERE reading.piece_id = ANY(v_piece_ids)
         OR reading.lot_id = ANY(v_lot_ids)
         OR reading.production_order_id = ANY(v_order_ids)
    )
    OR EXISTS (
      SELECT 1 FROM public.production_collection_events event
      WHERE event.pcp_import_batch_id = p_batch_id
         OR event.piece_id = ANY(v_piece_ids)
         OR event.lot_id = ANY(v_lot_ids)
         OR event.production_order_id = ANY(v_order_ids)
    )
    OR EXISTS (
      SELECT 1 FROM public.production_entries entry
      WHERE entry.pcp_import_batch_id = p_batch_id
         OR entry.lot_id = ANY(v_lot_ids)
         OR entry.production_order_id = ANY(v_order_ids)
         OR entry.order_id = ANY(v_order_ids)
    )
    OR EXISTS (
      SELECT 1 FROM public.production_events event
      WHERE event.event_type <> 'note'
        AND (
          event.piece_id = ANY(v_piece_ids)
          OR event.lot_id = ANY(v_lot_ids)
          OR event.production_order_id = ANY(v_order_ids)
        )
    );

  IF v_has_production THEN
    SELECT count(*) INTO v_preserved_readings
    FROM public.production_stage_readings reading
    WHERE reading.piece_id = ANY(v_piece_ids)
       OR reading.lot_id = ANY(v_lot_ids)
       OR reading.production_order_id = ANY(v_order_ids);

    SELECT count(*) INTO v_preserved_events
    FROM public.production_collection_events event
    WHERE event.pcp_import_batch_id = p_batch_id
       OR event.piece_id = ANY(v_piece_ids)
       OR event.lot_id = ANY(v_lot_ids)
       OR event.production_order_id = ANY(v_order_ids);

    UPDATE public.promob_import_batches
    SET status = 'cancelled',
        notes = concat_ws(
          E'\n',
          NULLIF(notes, ''),
          '[CANCELAMENTO] Produção já iniciada; histórico de coletas preservado em ' || now()::text
        )
    WHERE id = p_batch_id;

    UPDATE public.production_lots
    SET status = 'cancelled',
        current_status = 'cancelled',
        updated_at = now()
    WHERE id = ANY(v_lot_ids);

    UPDATE public.production_orders
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = ANY(v_order_ids);

    -- Peças já lidas permanecem com seu estado histórico; peças nunca lidas são canceladas.
    UPDATE public.production_pieces piece
    SET status = CASE
          WHEN EXISTS (
            SELECT 1 FROM public.production_stage_readings reading WHERE reading.piece_id = piece.id
          ) OR EXISTS (
            SELECT 1 FROM public.production_collection_events event WHERE event.piece_id = piece.id
          ) THEN piece.status
          ELSE 'cancelled'
        END,
        is_active = false,
        updated_at = now()
    WHERE piece.id = ANY(v_piece_ids);

    UPDATE public.production_lot_items
    SET status = 'cancelled',
        updated_at = now()
    WHERE lot_id = ANY(v_lot_ids)
      AND status NOT IN ('completed', 'cancelled');

    UPDATE public.production_tags
    SET active = false,
        updated_at = now()
    WHERE lot_id = ANY(v_lot_ids)
       OR piece_id = ANY(v_piece_ids);

    -- Contadores são projeções derivadas e não constituem histórico de rastreabilidade.
    DELETE FROM public.production_realtime_counters
    WHERE lot_id = ANY(v_lot_ids);

    RETURN jsonb_build_object(
      'success', true,
      'mode', 'cancelled_preserving_history',
      'had_production', true,
      'batch_id', p_batch_id,
      'cancelled_lots', cardinality(v_lot_ids),
      'preserved_pieces', cardinality(v_piece_ids),
      'preserved_readings', v_preserved_readings,
      'preserved_collection_events', v_preserved_events
    );
  END IF;

  -- Nenhuma coleta ocorreu: exclusão completa e atômica.
  DELETE FROM public.quality_nonconformities
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.occurrences
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids)
     OR order_id = ANY(v_order_ids);

  DELETE FROM public.production_collection_events
  WHERE pcp_import_batch_id = p_batch_id
     OR piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_entries
  WHERE pcp_import_batch_id = p_batch_id
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids)
     OR order_id = ANY(v_order_ids);

  DELETE FROM public.production_events
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_stage_readings
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_search_index
  WHERE entity_id = ANY(v_piece_ids)
     OR entity_id = ANY(v_lot_ids)
     OR entity_id = ANY(v_order_ids);

  DELETE FROM public.backup_files
  WHERE import_batch_id = p_batch_id
     OR lot_id = ANY(v_lot_ids)
     OR order_id = ANY(v_order_ids);

  DELETE FROM public.production_pieces
  WHERE id = ANY(v_piece_ids);
  GET DIAGNOSTICS v_deleted_pieces = ROW_COUNT;

  DELETE FROM public.production_lots
  WHERE id = ANY(v_lot_ids);
  GET DIAGNOSTICS v_deleted_lots = ROW_COUNT;

  DELETE FROM public.production_orders
  WHERE id = ANY(v_order_ids);
  GET DIAGNOSTICS v_deleted_orders = ROW_COUNT;

  DELETE FROM public.promob_import_batches
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'hard_deleted',
    'had_production', false,
    'batch_id', p_batch_id,
    'deleted_pieces', v_deleted_pieces,
    'deleted_lots', v_deleted_lots,
    'deleted_orders', v_deleted_orders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_promob_import_batch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_promob_import_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_promob_import_batch(uuid) TO authenticated;

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
    SELECT piece.*,
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
      AND CASE
        WHEN cardinality(COALESCE(piece.route_steps, ARRAY[]::text[])) > 0
          THEN v_step_code = ANY(piece.route_steps)
        WHEN v_step_code = 'cut' THEN COALESCE(piece.requires_cut, true)
        WHEN v_step_code = 'edge' THEN COALESCE(piece.requires_edge, false)
        WHEN v_step_code IN ('cnc', 'drill') THEN COALESCE(piece.requires_cnc, false)
        WHEN v_step_code = 'joinery' THEN COALESCE(piece.requires_joinery, false)
        WHEN v_step_code = 'separation' THEN COALESCE(piece.requires_separation, true)
        WHEN v_step_code = 'packaging' THEN COALESCE(piece.requires_packaging, true)
        WHEN v_step_code = 'shipping' THEN COALESCE(piece.requires_shipping, true)
        ELSE false
      END
  )
  SELECT
    count(*),
    count(*) FILTER (
      WHERE status IN ('rework', 'rework_pending', 'rework_in_progress')
         OR rework_status IN ('pending', 'in_progress')
    ),
    count(*) FILTER (
      WHERE is_replacement IS TRUE
         OR status IN ('replacement_requested', 'replacement_in_production')
         OR replacement_status IN ('requested', 'in_production')
    ),
    count(DISTINCT lot_id),
    count(DISTINCT effective_batch_id)
  INTO v_expected, v_rework, v_replacement, v_active_lots, v_active_batches
  FROM eligible_pieces;

  WITH eligible_pieces AS (
    SELECT piece.id
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
      AND CASE
        WHEN cardinality(COALESCE(piece.route_steps, ARRAY[]::text[])) > 0
          THEN v_step_code = ANY(piece.route_steps)
        WHEN v_step_code = 'cut' THEN COALESCE(piece.requires_cut, true)
        WHEN v_step_code = 'edge' THEN COALESCE(piece.requires_edge, false)
        WHEN v_step_code IN ('cnc', 'drill') THEN COALESCE(piece.requires_cnc, false)
        WHEN v_step_code = 'joinery' THEN COALESCE(piece.requires_joinery, false)
        WHEN v_step_code = 'separation' THEN COALESCE(piece.requires_separation, true)
        WHEN v_step_code = 'packaging' THEN COALESCE(piece.requires_packaging, true)
        WHEN v_step_code = 'shipping' THEN COALESCE(piece.requires_shipping, true)
        ELSE false
      END
  )
  SELECT count(DISTINCT fact.piece_id)
  INTO v_approved_cumulative
  FROM public.collection_stage_facts fact
  JOIN eligible_pieces eligible ON eligible.id = fact.piece_id
  WHERE fact.step_code_canonico = v_step_code;

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
      SELECT piece.id FROM public.production_pieces piece WHERE piece.pcp_import_batch_id = p_pcp_import_batch_id
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

CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_collection_cell_snapshot_v2(
    p_cell_name,
    p_workstation_id,
    p_shift,
    p_date_from,
    p_date_to,
    NULL::uuid,
    NULL::uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid,
  p_shift text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_pcp_import_batch_id uuid,
  p_lot_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_collection_cell_snapshot_v2(
    p_cell_name,
    p_workstation_id,
    p_shift,
    p_date_from,
    p_date_to,
    p_pcp_import_batch_id,
    p_lot_id
  );
$$;

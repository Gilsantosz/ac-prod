-- ─── MIGRATION 053: Exclusão Atômica de Lotes PCP e Reconciliação de KPIs ───

-- 1. Função RPC para deleção em cascata completa e atômica de lotes de importação PCP
CREATE OR REPLACE FUNCTION public.delete_promob_import_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op_ids uuid[];
  v_order_codes text[];
  v_lot_ids uuid[];
  v_piece_ids uuid[];
  v_deleted_pieces int := 0;
  v_deleted_lots int := 0;
  v_deleted_orders int := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'ID do lote de importação não pode ser nulo.';
  END IF;

  -- 1. Coletar IDs de OPs e Códigos de Pedidos associados
  SELECT array_agg(DISTINCT generated_op_id) FILTER (WHERE generated_op_id IS NOT NULL),
         array_agg(DISTINCT order_code) FILTER (WHERE order_code IS NOT NULL AND order_code <> '')
  INTO v_op_ids, v_order_codes
  FROM public.promob_import_batches
  WHERE id = p_batch_id;

  -- 2. Identificar todos os lotes associados (por pcp_import_batch_id ou por ordem de produção)
  SELECT array_agg(DISTINCT id) INTO v_lot_ids
  FROM public.production_lots
  WHERE pcp_import_batch_id = p_batch_id
     OR (v_op_ids IS NOT NULL AND order_id = ANY(v_op_ids));

  -- 3. Identificar todas as peças associadas
  SELECT array_agg(DISTINCT id) INTO v_piece_ids
  FROM public.production_pieces
  WHERE pcp_import_batch_id = p_batch_id
     OR (v_lot_ids IS NOT NULL AND lot_id = ANY(v_lot_ids))
     OR (v_op_ids IS NOT NULL AND production_order_id = ANY(v_op_ids));

  -- 4. Excluir leituras e eventos de rastreabilidade
  IF v_piece_ids IS NOT NULL AND array_length(v_piece_ids, 1) > 0 THEN
    DELETE FROM public.production_stage_readings WHERE piece_id = ANY(v_piece_ids);
    DELETE FROM public.collection_stage_facts WHERE piece_id = ANY(v_piece_ids);
    DELETE FROM public.production_collection_events WHERE piece_id = ANY(v_piece_ids);
    DELETE FROM public.production_events WHERE piece_id = ANY(v_piece_ids);
  END IF;

  IF v_lot_ids IS NOT NULL AND array_length(v_lot_ids, 1) > 0 THEN
    DELETE FROM public.production_stage_readings WHERE lot_id = ANY(v_lot_ids);
    DELETE FROM public.collection_stage_facts WHERE lot_id = ANY(v_lot_ids);
    DELETE FROM public.production_collection_events WHERE lot_id = ANY(v_lot_ids);
    DELETE FROM public.production_events WHERE lot_id = ANY(v_lot_ids);
  END IF;

  DELETE FROM public.production_collection_events WHERE pcp_import_batch_id = p_batch_id;

  -- 5. Excluir peças
  IF v_piece_ids IS NOT NULL AND array_length(v_piece_ids, 1) > 0 THEN
    DELETE FROM public.production_pieces WHERE id = ANY(v_piece_ids);
    v_deleted_pieces := array_length(v_piece_ids, 1);
  END IF;
  DELETE FROM public.production_pieces WHERE pcp_import_batch_id = p_batch_id;

  -- 6. Excluir lotes
  IF v_lot_ids IS NOT NULL AND array_length(v_lot_ids, 1) > 0 THEN
    DELETE FROM public.production_lots WHERE id = ANY(v_lot_ids);
    v_deleted_lots := array_length(v_lot_ids, 1);
  END IF;
  DELETE FROM public.production_lots WHERE pcp_import_batch_id = p_batch_id;

  -- 7. Excluir ordens de produção
  IF v_op_ids IS NOT NULL AND array_length(v_op_ids, 1) > 0 THEN
    DELETE FROM public.production_orders WHERE id = ANY(v_op_ids);
    v_deleted_orders := array_length(v_op_ids, 1);
  END IF;

  IF v_order_codes IS NOT NULL AND array_length(v_order_codes, 1) > 0 THEN
    DELETE FROM public.production_orders WHERE order_code = ANY(v_order_codes);
  END IF;

  -- 8. Excluir registros auxiliares e a própria importação
  DELETE FROM public.backup_files WHERE import_batch_id = p_batch_id;
  DELETE FROM public.promob_import_rows WHERE import_batch_id = p_batch_id;
  DELETE FROM public.pcp_import_logs WHERE import_batch_id = p_batch_id;
  DELETE FROM public.promob_import_batches WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'deleted_pieces', v_deleted_pieces,
    'deleted_lots', v_deleted_lots,
    'deleted_orders', v_deleted_orders
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_promob_import_batch(uuid) TO anon, authenticated, service_role;

-- 2. Atualizar get_collection_cell_snapshot_v2 para garantir reconciliação exata de lotes ativos e peças em andamento.
CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot_v2(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL::uuid,
  p_shift text DEFAULT NULL::text,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_pcp_import_batch_id uuid DEFAULT NULL::uuid,
  p_lot_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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

  v_active_general_lots jsonb;
BEGIN
  -- 1. Normalizar o código da etapa
  SELECT code INTO v_step_code
  FROM public.routing_steps
  WHERE lower(code) = lower(p_cell_name)
     OR lower(name) = lower(p_cell_name)
     OR (p_cell_name IN ('Borda', 'Bordo') AND code = 'edge')
     OR (p_cell_name = 'Usinagem' AND code = 'cnc')
     OR (p_cell_name = 'Furação' AND code = 'drill')
     OR (p_cell_name = 'Corte' AND code = 'cut')
     OR (p_cell_name = 'Marcenaria' AND code = 'joinery')
  ORDER BY sequence NULLS LAST
  LIMIT 1;
  v_step_code := COALESCE(v_step_code, lower(p_cell_name));

  -- 2. Calcular Integridade Acumulada da Célula (PREVISTO, APROVADO, PENDENTE, RETRABALHO, REPOSIÇÃO)
  SELECT 
    count(p.id),
    count(*) FILTER (
      WHERE p.status IN ('rework_pending','rework_in_progress') OR p.rework_status = 'in_progress'
    ),
    count(*) FILTER (
      WHERE p.status IN ('replacement_requested','replacement_in_production') OR p.replacement_status = 'in_production'
    ),
    count(DISTINCT p.lot_id),
    count(DISTINCT COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id))
  INTO v_expected, v_rework, v_replacement, v_active_lots, v_active_batches
  FROM public.production_pieces p
  JOIN public.production_lots l ON l.id = p.lot_id
  WHERE (
      v_step_code = ANY(COALESCE(p.route_steps, '{}'::text[]))
      OR cardinality(COALESCE(p.route_steps, '{}'::text[])) = 0
      OR (v_step_code = 'cut' AND COALESCE(p.requires_cut, true))
      OR (v_step_code = 'edge' AND p.requires_edge)
      OR (v_step_code = 'cnc' AND p.requires_cnc)
      OR (v_step_code = 'joinery' AND p.requires_joinery)
    )
    AND p.status NOT IN ('cancelled','replaced','shipped')
    AND l.status NOT IN ('closed','shipped','cancelled')
    AND (
      COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id) IS NULL 
      OR COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id) IN (
        SELECT id FROM public.promob_import_batches WHERE status <> 'closed'
      )
    )
    AND (p_pcp_import_batch_id IS NULL OR COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id) = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR p.lot_id = p_lot_id);

  SELECT count(DISTINCT p.id)
  INTO v_approved_cumulative
  FROM public.production_pieces p
  JOIN public.production_lots l ON l.id = p.lot_id
  JOIN public.collection_stage_facts f ON f.piece_id = p.id
  WHERE f.step_code_canonico = v_step_code
    AND p.status NOT IN ('cancelled','replaced','shipped')
    AND l.status NOT IN ('closed','shipped','cancelled')
    AND (
      COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id) IS NULL 
      OR COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id) IN (
        SELECT id FROM public.promob_import_batches WHERE status <> 'closed'
      )
    )
    AND (p_pcp_import_batch_id IS NULL OR COALESCE(p.pcp_import_batch_id, l.pcp_import_batch_id) = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR p.lot_id = p_lot_id);

  v_pending := GREATEST(v_expected - v_approved_cumulative, 0);

  -- 3. Calcular Atividade do Turno Efetivo (America/Sao_Paulo)
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'synced' AND result_status = 'approved'),
    count(*) FILTER (WHERE result_status = 'rejected'),
    count(*) FILTER (WHERE result_status = 'blocked'),
    count(*) FILTER (WHERE result_status = 'duplicated'),
    count(*) FILTER (WHERE status = 'error')
  INTO v_shift_total_reads, v_shift_approved_events, v_shift_rejected, v_shift_blocked, v_shift_duplicated, v_shift_errors
  FROM public.production_collection_events
  WHERE lower(COALESCE(cell_name, '')) = lower(p_cell_name)
    AND (p_workstation_id IS NULL OR machine_id = p_workstation_id)
    AND (p_shift IS NULL OR shift = p_shift)
    AND (p_date_from IS NULL OR COALESCE(created_at_client, last_attempt_at, created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(created_at_client, last_attempt_at, created_at) < p_date_to)
    AND (p_pcp_import_batch_id IS NULL OR pcp_import_batch_id = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR lot_id = p_lot_id);

  SELECT count(DISTINCT piece_id)
  INTO v_shift_unique_completions
  FROM public.production_stage_readings reading
  WHERE reading.step_name = v_step_code
    AND reading.status = 'approved'
    AND (p_workstation_id IS NULL OR reading.machine_id = p_workstation_id)
    AND (p_shift IS NULL OR reading.shift = p_shift)
    AND (p_date_from IS NULL OR reading.created_at >= p_date_from)
    AND (p_date_to IS NULL OR reading.created_at < p_date_to)
    AND (p_pcp_import_batch_id IS NULL OR piece_id IN (SELECT id FROM public.production_pieces WHERE pcp_import_batch_id = p_pcp_import_batch_id))
    AND (p_lot_id IS NULL OR lot_id = p_lot_id);

  -- 4. Listar Lotes Gerais Ativos
  SELECT json_agg(b) INTO v_active_general_lots
  FROM (
    SELECT id, general_lot_code, progress_percent
    FROM public.promob_import_batches
    WHERE status <> 'closed'
    ORDER BY created_at DESC
    LIMIT 15
  ) b;

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
      'rejected', v_shift_rejected,
      'blocked', v_shift_blocked + v_shift_duplicated,
      'duplicated', v_shift_duplicated,
      'errors', v_shift_errors
    ),
    'active_general_lots', COALESCE(v_active_general_lots, '[]'::jsonb)
  );
END;
$$;

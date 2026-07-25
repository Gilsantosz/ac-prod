-- ============================================================
-- AC.Prod MES — Fluxo Automático de Reposição para Peças Reprovadas
-- Migration 20260725140000 — Atualização de register_quality_rejection
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_quality_rejection(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_piece_id uuid;
  v_piece record;
  v_traceability_code text;
  v_reason text;
  v_notes text;
  v_disposition text;
  v_defect_id uuid;
  v_defect record;
  v_severity text;
  v_cell_name text;
  v_cell_id uuid;
  v_machine_id uuid;
  v_operator_id uuid;
  v_operator_name text;
  v_client_event_id uuid;
  v_reading_id uuid;
  v_occurrence_id uuid;
  v_nc_id uuid;
  v_nc_code text;
  v_replacement_order_id uuid := NULL;
  v_rework_order_id uuid := NULL;
  v_existing_repl_id uuid := NULL;
BEGIN
  -- Extrair parâmetros
  v_traceability_code := p_payload->>'traceability_code';
  v_reason            := COALESCE(p_payload->>'reason', 'Defeito detectado na coleta');
  v_notes             := p_payload->>'notes';
  v_disposition       := COALESCE(p_payload->>'disposition', 'scrap');
  v_cell_name         := p_payload->>'cell_name';
  v_operator_name     := p_payload->>'operator_name';
  
  IF p_payload->>'defect_id' IS NOT NULL AND p_payload->>'defect_id' != '' THEN
    v_defect_id := (p_payload->>'defect_id')::uuid;
  END IF;
  IF p_payload->>'cell_id' IS NOT NULL AND p_payload->>'cell_id' != '' THEN
    v_cell_id := (p_payload->>'cell_id')::uuid;
  END IF;
  IF p_payload->>'machine_id' IS NOT NULL AND p_payload->>'machine_id' != '' THEN
    v_machine_id := (p_payload->>'machine_id')::uuid;
  END IF;
  IF p_payload->>'operator_id' IS NOT NULL AND p_payload->>'operator_id' != '' THEN
    v_operator_id := (p_payload->>'operator_id')::uuid;
  END IF;
  IF p_payload->>'client_event_id' IS NOT NULL AND p_payload->>'client_event_id' != '' THEN
    v_client_event_id := (p_payload->>'client_event_id')::uuid;
    -- Verificação de Idempotência
    SELECT id INTO v_nc_id FROM public.quality_nonconformities WHERE client_event_id = v_client_event_id;
    IF v_nc_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'nonconformity_id', v_nc_id);
    END IF;
  END IF;

  -- Localizar peça
  IF p_payload->>'piece_id' IS NOT NULL AND p_payload->>'piece_id' != '' THEN
    v_piece_id := (p_payload->>'piece_id')::uuid;
    SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece_id;
  ELSE
    SELECT * INTO v_piece FROM public.production_pieces WHERE piece_uid = v_traceability_code OR traceability_code = v_traceability_code LIMIT 1;
    IF v_piece IS NOT NULL THEN
      v_piece_id := v_piece.id;
    END IF;
  END IF;

  -- Obter severidade do catálogo se disponível
  IF v_defect_id IS NOT NULL THEN
    SELECT * INTO v_defect FROM public.quality_defect_catalog WHERE id = v_defect_id;
    v_severity := COALESCE(p_payload->>'severity', v_defect.default_severity, 'medium');
  ELSE
    v_severity := COALESCE(p_payload->>'severity', 'medium');
  END IF;

  -- 1. Registrar leitura de reprovação em production_stage_readings
  INSERT INTO public.production_stage_readings (
    piece_id, piece_code, tag_value, raw_value, cell_name, machine_id,
    operator_id, operator_name, status, rejection_reason, notes,
    lot_id, production_order_id, step_name, created_by
  ) VALUES (
    v_piece_id,
    COALESCE(v_piece.piece_code, v_traceability_code),
    v_traceability_code,
    v_traceability_code,
    v_cell_name,
    v_machine_id,
    v_operator_id,
    v_operator_name,
    'rejected',
    v_reason,
    v_notes,
    v_piece.lot_id,
    v_piece.production_order_id,
    COALESCE(v_piece.current_stage, 'Coleta'),
    v_user_id
  ) RETURNING id INTO v_reading_id;

  -- 2. Criar registro em occurrences
  INSERT INTO public.occurrences (
    date, shift, cell, reason, downtime, operator, notes,
    created_by, lot_id, production_order_id, stage_reading_id,
    severity, status, occurrence_type, cell_id, machine_id, operator_id, client_event_id
  ) VALUES (
    CURRENT_DATE,
    COALESCE(p_payload->>'shift', '1'),
    COALESCE(v_cell_name, 'Geral'),
    v_reason,
    0,
    v_operator_name,
    v_notes,
    v_user_id,
    v_piece.lot_id,
    v_piece.production_order_id,
    v_reading_id,
    v_severity,
    'open',
    'quality',
    v_cell_id,
    v_machine_id,
    v_operator_id,
    v_client_event_id
  ) RETURNING id INTO v_occurrence_id;

  -- 3. Atualizar estado da peça original para reprovada ou bloqueada (continua 'rejected' no histórico!)
  IF v_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = CASE WHEN v_disposition = 'hold' THEN 'blocked' ELSE 'rejected' END,
        updated_at = now()
    WHERE id = v_piece_id;
  END IF;

  -- 4. Gerar código único para Não Conformidade (NC-AAAA-0000X)
  v_nc_code := 'NC-' || to_char(now(), 'YYYY') || '-' || lpad(floor(random() * 89999 + 10000)::text, 5, '0');

  -- 5. Criar registro em quality_nonconformities
  INSERT INTO public.quality_nonconformities (
    nc_code, piece_id, reading_id, occurrence_id, defect_id, defect_code,
    defect_name, quantity, severity, disposition, status, lot_id, lot_code,
    production_order_id, order_number, customer_name, environment_name,
    cell_id, cell_name, stage_name, machine_id, operator_id, operator_name,
    notes, client_event_id, created_by
  ) VALUES (
    v_nc_code,
    v_piece_id,
    v_reading_id,
    v_occurrence_id,
    v_defect_id,
    COALESCE(v_defect.code, 'DEF-GEN'),
    COALESCE(v_defect.name, v_reason),
    1,
    v_severity,
    v_disposition,
    'open',
    v_piece.lot_id,
    v_piece.lot_code,
    v_piece.production_order_id,
    v_piece.order_number,
    v_piece.customer_name,
    v_piece.environment_name,
    v_cell_id,
    v_cell_name,
    v_piece.current_stage,
    v_machine_id,
    v_operator_id,
    v_operator_name,
    v_notes,
    v_client_event_id,
    v_user_id
  ) RETURNING id INTO v_nc_id;

  -- 6. Garantir entrada na tabela replacement_orders para visualização no módulo /reposicao
  IF v_piece_id IS NOT NULL THEN
    SELECT id INTO v_existing_repl_id
    FROM public.replacement_orders
    WHERE original_piece_id = v_piece_id AND status NOT IN ('completed', 'cancelled');

    IF v_existing_repl_id IS NULL THEN
      INSERT INTO public.replacement_orders (
        replacement_code,
        original_piece_id,
        reason,
        priority,
        lot_id,
        production_order_id,
        status,
        created_by,
        defect_id,
        defect_name,
        origin_cell_id,
        origin_cell_name,
        rejection_stage,
        lot_code,
        order_number,
        customer_name,
        environment_name,
        operator_id,
        operator_name,
        requester_id,
        notes
      ) VALUES (
        'REP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 8999 + 1000)::text, 4, '0'),
        v_piece_id,
        v_reason,
        CASE WHEN v_severity = 'critical' THEN 'critical' WHEN v_severity = 'high' THEN 'high' ELSE 'normal' END,
        v_piece.lot_id,
        v_piece.production_order_id,
        'requested',
        v_user_id,
        v_defect_id,
        COALESCE(v_defect.name, v_reason),
        v_cell_id,
        v_cell_name,
        v_piece.current_stage,
        v_piece.lot_code,
        v_piece.order_number,
        v_piece.customer_name,
        v_piece.environment_name,
        v_operator_id,
        v_operator_name,
        v_user_id,
        v_notes
      ) RETURNING id INTO v_replacement_order_id;
    ELSE
      v_replacement_order_id := v_existing_repl_id;
    END IF;

    -- Vincular a ordem de reposição à NC
    UPDATE public.quality_nonconformities
    SET related_replacement_id = v_replacement_order_id
    WHERE id = v_nc_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'nonconformity_id', v_nc_id,
    'nc_code', v_nc_code,
    'occurrence_id', v_occurrence_id,
    'reading_id', v_reading_id,
    'replacement_order_id', v_replacement_order_id
  );
END;
$$;

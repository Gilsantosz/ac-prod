BEGIN;

CREATE OR REPLACE FUNCTION public.approve_piece_replacement(
  p_order_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.replacement_orders%ROWTYPE;
  v_original public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_production_order public.production_orders%ROWTYPE;
  v_production_order_id uuid;
  v_replacement_piece_id uuid;
  v_replacement_uid text;
  v_internal_traceability text;
  v_barcode text;
  v_priority text := NULLIF(p_payload->>'priority', '');
  v_notes text := NULLIF(trim(p_payload->>'notes'), '');
  v_selected_cells jsonb := COALESCE(p_payload->'selected_cells', '[]'::jsonb);
  v_selected jsonb;
  v_approved_cells jsonb := '[]'::jsonb;
  v_route text[];
  v_route_codes text[] := '{}'::text[];
  v_completed_steps text[] := '{}'::text[];
  v_route_value text;
  v_step_code text;
  v_next_step text;
  v_cell public.cells%ROWTYPE;
  v_client_event_id text;
  v_entry_id uuid;
  v_reading_id uuid;
  v_operator_name text;
  v_shift text := COALESCE(NULLIF(p_payload->>'shift', ''), 'Reposição');
  v_entry_count integer := 0;
  v_order_status text;
  v_piece_status text;
BEGIN
  IF jsonb_typeof(v_selected_cells) <> 'array' THEN
    RAISE EXCEPTION 'selected_cells deve ser uma lista.';
  END IF;

  SELECT * INTO v_order
  FROM public.replacement_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Ordem de reposição não encontrada.';
  END IF;

  IF v_order.replacement_piece_id IS NOT NULL
     AND v_order.status IN ('approved', 'released', 'in_production', 'completed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'replacement_piece_id', v_order.replacement_piece_id,
      'replacement_barcode', v_order.replacement_barcode,
      'automatic_entries', v_order.approval_entry_count,
      'approved_cells', v_order.approved_cells
    );
  END IF;

  IF v_order.status NOT IN ('requested', 'under_review') THEN
    RAISE EXCEPTION 'Status atual inválido para aprovação: %', v_order.status;
  END IF;

  SELECT * INTO v_original
  FROM public.production_pieces
  WHERE id = v_order.original_piece_id
  FOR UPDATE;

  IF v_original.id IS NULL THEN
    RAISE EXCEPTION 'Peça original não encontrada.';
  END IF;
  IF v_original.lot_id IS NULL THEN
    RAISE EXCEPTION 'A peça original não possui lote vinculado.';
  END IF;

  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_original.lot_id;
  v_production_order_id := COALESCE(v_original.production_order_id, v_lot.production_order_id, v_lot.order_id);
  SELECT * INTO v_production_order
  FROM public.production_orders
  WHERE id = v_production_order_id;

  v_barcode := COALESCE(
    NULLIF(v_order.replacement_barcode, ''),
    NULLIF(v_original.traceability_code, ''),
    NULLIF(v_original.piece_uid, ''),
    NULLIF(v_original.piece_code, '')
  );
  IF v_barcode IS NULL THEN
    RAISE EXCEPTION 'A peça original não possui código de barras rastreável.';
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

  FOREACH v_route_value IN ARRAY v_route LOOP
    v_step_code := public.normalize_replacement_step_code(v_route_value);
    IF v_step_code IS NOT NULL AND NOT (v_step_code = ANY(v_route_codes)) THEN
      v_route_codes := array_append(v_route_codes, v_step_code);
    END IF;
  END LOOP;

  IF cardinality(v_route_codes) = 0 THEN
    v_route_codes := ARRAY['cut'];
    v_route := ARRAY['cut'];
  END IF;

  v_replacement_uid := v_barcode || '.REP.' || upper(substr(replace(v_order.id::text, '-', ''), 1, 8));
  v_internal_traceability := v_replacement_uid;

  INSERT INTO public.production_pieces (
    piece_uid, piece_code, traceability_code, piece_name, description,
    production_order_id, lot_id, lot_item_id, item_id,
    legacy_lot_item_id, legacy_production_lot_item_id,
    sequence_number, total_in_lot, is_active,
    module_name, environment, environment_name,
    material, thickness, color, width, height, length, grain_direction,
    edge_front, edge_back, edge_left, edge_right,
    requires_cut, requires_edge, requires_cnc, requires_joinery,
    requires_separation, requires_packaging,
    current_stage, status, source_origin, is_rework, original_piece_id,
    is_replacement, production_status, replacement_status,
    route_template_id, route_steps, completed_steps,
    lot_code, order_number, customer_name, pcp_import_batch_id, created_by
  ) VALUES (
    v_replacement_uid, v_barcode, v_internal_traceability,
    v_original.piece_name, v_original.description,
    v_production_order_id, v_original.lot_id,
    v_original.lot_item_id, v_original.item_id,
    v_original.legacy_lot_item_id, v_original.legacy_production_lot_item_id,
    v_original.sequence_number, v_original.total_in_lot, true,
    v_original.module_name, v_original.environment, v_original.environment_name,
    v_original.material, v_original.thickness, v_original.color,
    v_original.width, v_original.height, v_original.length, v_original.grain_direction,
    v_original.edge_front, v_original.edge_back, v_original.edge_left, v_original.edge_right,
    v_original.requires_cut, v_original.requires_edge, v_original.requires_cnc,
    v_original.requires_joinery, v_original.requires_separation, v_original.requires_packaging,
    v_route_codes[1], 'in_progress', 'rework', true, v_original.id,
    true, 'approved', 'in_production',
    v_original.route_template_id, v_route, '{}'::text[],
    COALESCE(v_original.lot_code, v_order.lot_code, v_lot.lot_code),
    COALESCE(v_original.order_number, v_order.order_number, v_production_order.order_number, v_production_order.order_code),
    COALESCE(v_original.customer_name, v_order.customer_name, v_production_order.customer_name),
    v_original.pcp_import_batch_id, v_user_id
  )
  RETURNING id INTO v_replacement_piece_id;

  -- O mesmo código físico passa a resolver a peça substituta. A peça original
  -- continua preservada para auditoria e mantém seus snapshots históricos.
  UPDATE public.production_tags
  SET active = false, updated_at = now()
  WHERE upper(tag_value) = upper(v_barcode)
    AND active IS TRUE;

  INSERT INTO public.production_tags (
    lot_id, item_id, piece_id, tag_value, tag_type, tag_format,
    barcode_value, active, created_at, updated_at
  ) VALUES (
    v_original.lot_id,
    COALESCE(v_original.legacy_production_lot_item_id, v_original.lot_item_id),
    v_replacement_piece_id,
    v_barcode,
    'barcode',
    'custom',
    v_barcode,
    true,
    now(),
    now()
  );

  v_operator_name := COALESCE(
    NULLIF(p_payload->>'operator_name', ''),
    NULLIF(v_order.operator_name, ''),
    'Aprovação de reposição'
  );

  FOR v_selected IN
    SELECT value FROM jsonb_array_elements(v_selected_cells)
  LOOP
    v_step_code := public.normalize_replacement_step_code(v_selected->>'step_code');

    SELECT * INTO v_cell
    FROM public.cells
    WHERE id = NULLIF(v_selected->>'cell_id', '')::uuid
      AND active IS TRUE;

    IF v_cell.id IS NULL THEN
      RAISE EXCEPTION 'Célula selecionada não existe ou está inativa.';
    END IF;

    v_step_code := COALESCE(v_step_code, public.normalize_replacement_step_code(v_cell.name));
    IF NOT (v_step_code = ANY(v_route_codes)) THEN
      RAISE EXCEPTION 'A etapa % da célula % não pertence à rota da peça.', v_step_code, v_cell.name;
    END IF;
    IF NOT public.replacement_cell_matches_step(v_cell.name, v_step_code) THEN
      RAISE EXCEPTION 'A célula % não corresponde à etapa %.', v_cell.name, v_step_code;
    END IF;

    IF v_step_code = ANY(v_completed_steps) THEN
      CONTINUE;
    END IF;

    v_client_event_id := 'replacement:' || v_order.id::text || ':' || v_step_code;

    IF EXISTS (
      SELECT 1 FROM public.production_collection_events
      WHERE client_event_id = v_client_event_id
    ) THEN
      v_completed_steps := array_append(v_completed_steps, v_step_code);
      CONTINUE;
    END IF;

    INSERT INTO public.production_entries (
      date, shift, cell, hour, produced, target, scrap, downtime,
      operator, operator_id, operator_name_snapshot, notes,
      order_id, production_order_id, lot_id,
      order_number, lot_code, customer_name, environment_name,
      product_code, product_name, product_description,
      step_code, process_step, operation_name,
      entry_mode, source, approval_status, client_event_id,
      is_rework, rework_reason, pcp_import_batch_id,
      unit_of_measure, metric_unit, metric_unit_label, metric_name,
      created_by, created_at
    ) VALUES (
      current_date, v_shift, v_cell.name, to_char(now(), 'HH24:MI'),
      1, 0, 0, 0,
      v_operator_name, v_order.operator_id, v_operator_name,
      'Baixa por reposição — ' || COALESCE(v_order.replacement_code, v_order.id::text)
        || ' — Código ' || v_barcode,
      v_production_order_id, v_production_order_id,
      v_original.lot_id,
      COALESCE(v_order.order_number, v_original.order_number, v_production_order.order_number, v_production_order.order_code),
      COALESCE(v_order.lot_code, v_original.lot_code, v_lot.lot_code),
      COALESCE(v_order.customer_name, v_original.customer_name, v_production_order.customer_name),
      COALESCE(v_order.environment_name, v_original.environment_name, v_original.environment),
      v_barcode, v_original.piece_name, v_original.description,
      v_step_code, v_step_code, v_step_code,
      'automatic_replacement', 'replacement_approval', 'valid', v_client_event_id,
      true, v_order.reason, v_original.pcp_import_batch_id,
      'pecas', 'pieces', 'Peças', 'Baixa por reposição',
      v_user_id, now()
    )
    RETURNING id INTO v_entry_id;

    INSERT INTO public.production_stage_readings (
      client_event_id, tag_value, tag_type, reader_type,
      station_name, cell_name, operator, operator_name_snapshot,
      user_id, operator_id, shift, date, hour,
      item_id, piece_id, lot_id, production_order_id,
      step_name, operation_name, quantity, status, event_type,
      notes, lot_code, order_number, customer_name, environment_name,
      piece_code, production_entry_id, production_cycle,
      entry_type, traceability_type, is_manual, unit_of_measure,
      general_lot_code, created_at
    ) VALUES (
      v_client_event_id, v_barcode, 'barcode', 'api',
      'Aprovação de Reposição', v_cell.name, v_operator_name, v_operator_name,
      v_user_id, v_order.operator_id, v_shift, current_date, to_char(now(), 'HH24:MI'),
      COALESCE(v_original.legacy_production_lot_item_id, v_original.lot_item_id),
      v_replacement_piece_id, v_original.lot_id, v_production_order_id,
      v_step_code, v_step_code, 1, 'approved', 'replacement_approval',
      'Baixa por reposição — ' || COALESCE(v_order.replacement_code, v_order.id::text),
      COALESCE(v_order.lot_code, v_original.lot_code, v_lot.lot_code),
      COALESCE(v_order.order_number, v_original.order_number, v_production_order.order_number, v_production_order.order_code),
      COALESCE(v_order.customer_name, v_original.customer_name, v_production_order.customer_name),
      COALESCE(v_order.environment_name, v_original.environment_name, v_original.environment),
      v_barcode, v_entry_id, 1,
      'baixa_reposicao', 'unitaria', false, 'pecas',
      v_order.general_lot_code, now()
    )
    RETURNING id INTO v_reading_id;

    INSERT INTO public.production_collection_events (
      client_event_id, raw_value, normalized_value, reader_type,
      operator_id, operator_name, operator_name_snapshot, cell_id, cell_name,
      shift, shift_snapshot, date, hour, status, result_status,
      reading_id, production_entry_id, lot_id, production_order_id,
      payload, result_payload, created_at_client, processed_at,
      registration, operation_name, lot_code, order_number,
      customer_name, environment_name, piece_code, piece_id,
      station_name, station_name_snapshot, pcp_import_batch_id,
      entry_type, traceability_type, is_manual, unit_of_measure,
      general_lot_code, created_at, updated_at
    ) VALUES (
      v_client_event_id, v_barcode, v_barcode, 'api',
      v_order.operator_id, v_operator_name, v_operator_name,
      v_cell.id, v_cell.name,
      v_shift, v_shift, current_date, to_char(now(), 'HH24:MI'),
      'synced', 'approved',
      v_reading_id, v_entry_id, v_original.lot_id, v_production_order_id,
      jsonb_build_object(
        'source', 'replacement_approval',
        'replacement_order_id', v_order.id,
        'replacement_code', v_order.replacement_code,
        'barcode', v_barcode,
        'cell_id', v_cell.id,
        'cell_name', v_cell.name,
        'step_code', v_step_code
      ),
      jsonb_build_object(
        'success', true,
        'status', 'approved',
        'message', 'Baixa por reposição',
        'entry_type', 'baixa_reposicao',
        'source', 'replacement_approval',
        'replacement_order_id', v_order.id,
        'replacement_code', v_order.replacement_code,
        'replacement_piece_id', v_replacement_piece_id,
        'barcode', v_barcode,
        'cell_id', v_cell.id,
        'cell_name', v_cell.name,
        'step_code', v_step_code
      ),
      now(), now(),
      'REPOSIÇÃO', v_step_code,
      COALESCE(v_order.lot_code, v_original.lot_code, v_lot.lot_code),
      COALESCE(v_order.order_number, v_original.order_number, v_production_order.order_number, v_production_order.order_code),
      COALESCE(v_order.customer_name, v_original.customer_name, v_production_order.customer_name),
      COALESCE(v_order.environment_name, v_original.environment_name, v_original.environment),
      v_barcode, v_replacement_piece_id,
      'Aprovação de Reposição', 'Aprovação de Reposição', v_original.pcp_import_batch_id,
      'baixa_reposicao', 'unitaria', false, 'pecas',
      v_order.general_lot_code, now(), now()
    );

    v_completed_steps := array_append(v_completed_steps, v_step_code);
    v_entry_count := v_entry_count + 1;
    v_approved_cells := v_approved_cells || jsonb_build_array(jsonb_build_object(
      'cell_id', v_cell.id,
      'cell_name', v_cell.name,
      'step_code', v_step_code,
      'step_name', COALESCE(v_selected->>'step_name', v_cell.name),
      'client_event_id', v_client_event_id,
      'reading_id', v_reading_id,
      'production_entry_id', v_entry_id,
      'approved_at', now()
    ));
  END LOOP;

  v_next_step := NULL;
  FOREACH v_route_value IN ARRAY v_route_codes LOOP
    IF NOT (v_route_value = ANY(v_completed_steps)) THEN
      v_next_step := v_route_value;
      EXIT;
    END IF;
  END LOOP;

  v_piece_status := CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_progress' END;
  v_order_status := CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_production' END;

  UPDATE public.production_pieces
  SET completed_steps = v_completed_steps,
      current_stage = COALESCE(v_next_step, 'Concluída'),
      status = v_piece_status,
      production_status = CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'approved' END,
      replacement_status = CASE WHEN v_next_step IS NULL THEN 'replaced' ELSE 'in_production' END,
      updated_at = now()
  WHERE id = v_replacement_piece_id;

  UPDATE public.production_pieces
  SET replacement_status = CASE WHEN v_next_step IS NULL THEN 'replaced' ELSE 'in_production' END,
      status = CASE WHEN v_next_step IS NULL THEN 'replaced' ELSE status END,
      updated_at = now()
  WHERE id = v_original.id;

  UPDATE public.replacement_orders
  SET status = v_order_status,
      replacement_piece_id = v_replacement_piece_id,
      replacement_barcode = v_barcode,
      approver_id = v_user_id,
      approved_at = now(),
      released_at = CASE WHEN v_next_step IS NULL THEN released_at ELSE COALESCE(released_at, now()) END,
      completed_at = CASE WHEN v_next_step IS NULL THEN now() ELSE completed_at END,
      priority = COALESCE(v_priority, priority),
      notes = COALESCE(v_notes, notes),
      approved_cells = v_approved_cells,
      approval_entry_count = v_entry_count,
      updated_at = now()
  WHERE id = p_order_id;

  IF v_next_step IS NULL THEN
    UPDATE public.quality_nonconformities
    SET status = 'closed', closed_at = now(), closed_by = v_user_id
    WHERE related_replacement_id = p_order_id
      AND status <> 'closed';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', v_order_status,
    'replacement_piece_id', v_replacement_piece_id,
    'replacement_uid', v_replacement_uid,
    'replacement_barcode', v_barcode,
    'automatic_entries', v_entry_count,
    'approved_cells', v_approved_cells,
    'completed_steps', to_jsonb(v_completed_steps),
    'next_step', v_next_step,
    'message', CASE
      WHEN v_entry_count > 0 THEN 'Reposição aprovada com baixas automáticas.'
      ELSE 'Reposição aprovada e devolvida à fila produtiva.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_replacement_approval_cells(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replacement_cell_matches_step(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_piece_replacement(uuid, jsonb) TO authenticated;

COMMIT;

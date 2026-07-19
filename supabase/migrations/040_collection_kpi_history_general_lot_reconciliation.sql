-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 040: Correção de KPIs, Rastreabilidade e Reconciliação de Lote Geral
-- ============================================================

-- ─── 1. View Canônica de Fatos Produtivos Aprovados ───────────────────
CREATE OR REPLACE VIEW public.collection_stage_facts AS
SELECT 
  sr.id AS reading_id,
  sr.piece_id,
  sr.lot_id,
  p.pcp_import_batch_id,
  sr.step_name AS step_code_canonico,
  sr.quantity,
  sr.status,
  sr.created_at AS read_at,
  sr.cell_name,
  sr.machine_id,
  sr.operator_id,
  sr.operator,
  sr.shift,
  sr.created_at AS created_at_client,
  sr.created_at,
  p.traceability_code AS piece_code,
  l.lot_code,
  COALESCE(sr.production_cycle, 1) AS production_cycle
FROM public.production_stage_readings sr
JOIN public.production_pieces p ON p.id = sr.piece_id
JOIN public.production_lots l ON l.id = sr.lot_id
WHERE sr.status = 'approved';

-- ─── 2. Redesenho de process_production_reading com Sessão e Integrações ───
CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session_token text := NULLIF(TRIM(p_payload->>'operatorSessionToken'), '');
  v_client_event_id text := NULLIF(TRIM(p_payload->>'client_event_id'), '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'raw_value', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), NULLIF(p_payload->>'reader_type', ''), 'keyboard_barcode');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', p_payload->>'cell_name', '')), '');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', p_payload->>'station_name', '')), '');
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', p_payload->>'step_name', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_shift text := NULLIF(TRIM(COALESCE(p_payload->>'shift', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour', ''), to_char(now(), 'HH24:MI'));
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_created_at_client timestamptz := COALESCE(
    NULLIF(p_payload->>'createdAtClient', '')::timestamptz,
    NULLIF(p_payload->>'created_at_client', '')::timestamptz,
    now()
  );
  v_device_id text := NULLIF(TRIM(COALESCE(p_payload->>'deviceId', p_payload->>'device_id', '')), '');
  v_enqueue_duration_ms numeric := COALESCE(NULLIF(p_payload->>'enqueue_duration_ms', '')::numeric, 0);

  v_token_hash text;
  v_session public.operator_sessions%ROWTYPE;
  v_op public.operators%ROWTYPE;
  v_event public.production_collection_events%ROWTYPE;
  v_piece public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_order public.production_orders%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_existing_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_result jsonb;
  v_val_res jsonb;
  v_target_step_code text;
  v_from_stage text;
  v_new_completed_steps text[];
  v_next_step text;
  v_found_next boolean := false;
  v_total_pieces bigint := 0;
  v_completed_pieces bigint := 0;
  v_total_steps bigint := 0;
  v_completed_steps_count bigint := 0;
  v_lot_progress numeric(5,2) := 0;
  v_general_lot_progress_percent numeric(5,2) := 0;
  i integer;
BEGIN
  -- Validar permissão de banco comum
  IF auth.uid() IS NULL OR public.get_my_role() NOT IN ('admin','manager','supervisor','operator') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'forbidden',
      'message', 'Usuário sem permissão para coleta produtiva.'
    );
  END IF;

  -- 1. Validar e Derivar dados da Sessão do Operador no Servidor
  IF v_session_token IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'unauthenticated',
      'message', 'Sessão operacional necessária para realizar baixa.'
    );
  END IF;

  v_token_hash := encode(digest(v_session_token, 'sha256'), 'hex');
  
  SELECT * INTO v_session FROM public.operator_sessions
  WHERE token_hash = v_token_hash AND ended_at IS NULL AND revoked_at IS NULL AND expires_at > now();

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'session_expired',
      'message', 'Sessão de operador expirada, inválida ou revogada.'
    );
  END IF;

  SELECT * INTO v_op FROM public.operators WHERE id = v_session.operator_id;

  v_client_event_id := COALESCE(v_client_event_id, gen_random_uuid()::text);
  
  -- Sincronizar dados do payload com a sessão derivada do servidor
  v_cell := v_session.cell_name_snapshot;
  v_station := v_session.station_name_snapshot;
  v_operator := v_op.name;
  v_shift := v_session.shift_snapshot;

  -- 2. Claim atômico do evento de coleta
  INSERT INTO public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type,
    operator_id, operator_name, registration, cell_name, shift, date, hour,
    status, created_at_client, payload, machine_id, machine_name, station_name,
    device_id, enqueue_duration_ms, sync_started_at, attempt_count, last_attempt_at,
    operator_session_id, cell_id, operator_registration_snapshot, machine_name_snapshot,
    station_name_snapshot, shift_snapshot
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_op.id, v_op.name, v_op.registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload, v_session.machine_id, v_session.machine_name_snapshot, v_session.station_name_snapshot,
    v_device_id, v_enqueue_duration_ms, now(), 1, now(),
    v_session.id, v_session.cell_id, public.mask_registration(v_op.registration), v_session.machine_name_snapshot,
    v_session.station_name_snapshot, v_session.shift_snapshot
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT * INTO v_event
    FROM public.production_collection_events
    WHERE client_event_id = v_client_event_id;

    UPDATE public.production_collection_events
    SET attempt_count = attempt_count + 1,
        last_attempt_at = now()
    WHERE id = v_event.id;

    IF v_event.result_payload IS NOT NULL AND v_event.result_payload <> '{}'::jsonb
       AND v_event.status IN ('synced', 'ignored', 'error') THEN
      RETURN v_event.result_payload;
    END IF;

    IF v_event.status = 'synced' THEN
      SELECT * INTO v_reading FROM public.production_stage_readings WHERE id = v_event.reading_id;
      SELECT * INTO v_piece FROM public.production_pieces WHERE id = COALESCE(v_event.piece_id, v_reading.piece_id);
      SELECT * INTO v_lot FROM public.production_lots WHERE id = COALESCE(v_event.lot_id, v_reading.lot_id, v_piece.lot_id);
      SELECT * INTO v_order FROM public.production_orders WHERE id = v_lot.production_order_id;
      
      SELECT progress_percent INTO v_general_lot_progress_percent
      FROM public.promob_import_batches
      WHERE id = v_piece.pcp_import_batch_id;

      v_result := jsonb_build_object(
        'success', true,
        'status', 'approved',
        'alert_level', 'green',
        'message', 'Leitura já processada anteriormente.',
        'lot', to_jsonb(v_lot),
        'order', to_jsonb(v_order),
        'item', to_jsonb(v_piece),
        'reading', to_jsonb(v_reading),
        'lot_progress_percent', v_lot.progress_percent,
        'client_lot_progress', jsonb_build_object(
          'lot_id', v_lot.id,
          'lot_code', v_lot.lot_code,
          'progress_percent', v_lot.progress_percent
        ),
        'general_lot_progress', jsonb_build_object(
          'pcp_import_batch_id', v_piece.pcp_import_batch_id,
          'progress_percent', COALESCE(v_general_lot_progress_percent, 0.0)
        )
      );
      UPDATE public.production_collection_events SET result_payload = v_result WHERE id = v_event.id;
      RETURN v_result;
    END IF;

    IF v_event.status = 'ignored' THEN
      v_result := jsonb_build_object(
        'success', false,
        'status', COALESCE(v_event.result_status, 'ignored'),
        'message', COALESCE(v_event.error_message, 'Evento já processado anteriormente.')
      );
      UPDATE public.production_collection_events SET result_payload = v_result WHERE id = v_event.id;
      RETURN v_result;
    END IF;

    IF v_event.status = 'processing' THEN
      RAISE EXCEPTION 'Evento % ainda está em processamento; tente novamente.', v_client_event_id
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.production_collection_events
    SET status = 'processing',
        payload = p_payload,
        sync_started_at = now(),
        sync_finished_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  END IF;

  IF v_tag_value = '' THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'invalid',
      'alert_level', 'red',
      'message', 'Informe uma identificação produtiva válida.'
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'invalid', v_result, NULL, NULL, v_result->>'message');
  END IF;

  BEGIN
    v_piece := public.resolve_piece_by_identifier(v_tag_value);
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'not_found',
      'alert_level', 'red',
      'message', SQLERRM
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'not_found', v_result, NULL, NULL, SQLERRM);
  END;

  -- Serializar coletas para a mesma peça
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id FOR UPDATE;
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order FROM public.production_orders WHERE id = COALESCE(v_piece.production_order_id, v_lot.production_order_id, v_lot.order_id);

  -- Atualizar auditoria de eventos
  UPDATE public.production_collection_events SET
    piece_id = v_piece.id,
    pcp_import_batch_id = v_piece.pcp_import_batch_id,
    lot_id = v_piece.lot_id,
    production_order_id = v_piece.production_order_id,
    lot_code = v_lot.lot_code,
    load_number = v_order.load_number,
    order_number = COALESCE(v_order.order_number, v_order.order_code),
    customer_name = v_order.customer_name,
    environment_name = v_piece.environment,
    piece_code = v_piece.traceability_code,
    updated_at = now()
  WHERE id = v_event.id;

  -- Resolver etapa da célula
  IF v_step_input IS NOT NULL THEN
    v_target_step_code := v_step_input;
  ELSE
    SELECT code INTO v_target_step_code
    FROM public.routing_steps
    WHERE lower(code) = lower(v_cell)
       OR lower(name) = lower(v_cell)
       OR (v_cell IN ('Borda', 'Bordo') AND code = 'edge')
       OR (v_cell = 'Usinagem' AND code = 'cnc')
       OR (v_cell = 'Furação' AND code = 'drill')
       OR (v_cell = 'Corte' AND code = 'cut')
       OR (v_cell = 'Marcenaria' AND code = 'joinery')
    ORDER BY sequence NULLS LAST
    LIMIT 1;
  END IF;
  v_target_step_code := COALESCE(v_target_step_code, v_piece.current_stage);

  UPDATE public.production_collection_events SET
    operation_name = v_target_step_code
  WHERE id = v_event.id;

  -- Validar sequenciamento
  v_val_res := public.validar_fluxo_da_peca(v_piece.id, v_target_step_code);

  IF NOT COALESCE((v_val_res->>'success')::boolean, false) OR v_val_res->>'status' = 'duplicated' THEN
    IF v_piece.lot_id IS NOT NULL THEN
      INSERT INTO public.production_stage_readings (
        client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
        operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
        step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
        lot_code, load_number, order_number, customer_name, environment_name,
        operation_name, piece_code, created_at
      ) VALUES (
        v_client_event_id, v_piece.piece_uid,
        CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
        v_reader_type, v_station, v_cell,
        v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
        v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
        CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
        CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated_scan' ELSE 'wrong_step' END,
        v_op.id, v_session.machine_id, v_session.machine_name_snapshot, v_lot.lot_code, v_order.load_number,
        COALESCE(v_order.order_number, v_order.order_code), v_order.customer_name,
        v_piece.environment, v_target_step_code, v_piece.traceability_code, v_created_at_client
      ) RETURNING * INTO v_reading;
    END IF;

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id, event_type,
      from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
      event_status, reading_source, barcode_raw_value, notes, legacy_stage_reading_id
    ) VALUES (
      v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id, 'block',
      v_piece.current_stage, v_target_step_code, v_cell, v_session.machine_id::text, v_device_id, v_op.id,
      CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
      v_reader_type, v_tag_value, v_val_res->>'message', v_reading.id
    );

    v_result := jsonb_build_object(
      'success', false,
      'status', COALESCE(v_val_res->>'status', 'blocked'),
      'alert_level', COALESCE(v_val_res->>'alert_level', 'red'),
      'message', COALESCE(v_val_res->>'message', 'Entrada bloqueada.'),
      'lot', to_jsonb(v_lot),
      'order', to_jsonb(v_order),
      'item', to_jsonb(v_piece),
      'reading', CASE WHEN v_reading.id IS NULL THEN NULL ELSE to_jsonb(v_reading) END
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', v_val_res->>'status', v_result, v_reading.id, NULL, v_result->>'message');
  END IF;

  -- Defesa contra base defasada
  SELECT * INTO v_existing_reading FROM public.production_stage_readings
  WHERE piece_id = v_piece.id AND step_name = v_target_step_code AND production_cycle = 1 AND status = 'approved'
  LIMIT 1;

  IF v_existing_reading.id IS NOT NULL THEN
    INSERT INTO public.production_stage_readings (
      client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
      operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
      step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
      lot_code, load_number, order_number, customer_name, environment_name,
      operation_name, piece_code, created_at
    ) VALUES (
      v_client_event_id, v_piece.piece_uid,
      CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
      v_reader_type, v_station, v_cell,
      v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
      v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
      'duplicated', 'duplicated_scan', v_op.id, v_session.machine_id, v_session.machine_name_snapshot,
      v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
      v_order.customer_name, v_piece.environment, v_target_step_code, v_piece.traceability_code, v_created_at_client
    ) RETURNING * INTO v_reading;

    v_result := jsonb_build_object(
      'success', false,
      'status', 'duplicated',
      'alert_level', 'yellow',
      'message', 'Peça já aprovada nesta etapa; a nova tentativa foi registrada sem duplicar produção.',
      'lot', to_jsonb(v_lot),
      'order', to_jsonb(v_order),
      'item', to_jsonb(v_piece),
      'reading', to_jsonb(v_reading)
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'duplicated', v_result, v_reading.id, NULL, v_result->>'message');
  END IF;

  v_from_stage := v_piece.current_stage;

  -- Registrar Baixa
  INSERT INTO public.production_stage_readings (
    client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
    operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
    step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
    lot_code, load_number, order_number, customer_name, environment_name,
    operation_name, piece_code, production_cycle, created_at
  ) VALUES (
    v_client_event_id, v_piece.piece_uid,
    CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
    v_reader_type, v_station, v_cell,
    v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
    v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
    'approved', 'approved_scan', v_op.id, v_session.machine_id, v_session.machine_name_snapshot,
    v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
    v_order.customer_name, v_piece.environment, v_target_step_code,
    v_piece.traceability_code, 1, v_created_at_client
  ) RETURNING * INTO v_reading;

  -- Atualizar etapas completas
  v_new_completed_steps := COALESCE(v_piece.completed_steps, '{}'::text[]);
  IF NOT (v_target_step_code = ANY(v_new_completed_steps)) THEN
    v_new_completed_steps := array_append(v_new_completed_steps, v_target_step_code);
  END IF;

  -- Próxima etapa
  v_next_step := NULL;
  v_found_next := false;
  IF v_piece.route_steps IS NOT NULL AND array_length(v_piece.route_steps, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
      IF v_found_next THEN
        v_next_step := v_piece.route_steps[i];
        EXIT;
      END IF;
      IF lower(v_piece.route_steps[i]) = lower(v_target_step_code) THEN
        v_found_next := true;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.production_pieces
  SET completed_steps = v_new_completed_steps,
      current_stage = COALESCE(v_next_step, 'Concluída'),
      status = CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_piece.id
  RETURNING * INTO v_piece;

  -- Legado do item
  UPDATE public.production_lot_items
  SET current_step = COALESCE(
        (SELECT name FROM public.routing_steps WHERE code = v_piece.current_stage),
        v_piece.current_stage
      ),
      status = CASE WHEN v_piece.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_piece.legacy_production_lot_item_id;

  -- Recalcular Progresso do Lote do cliente
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('completed','packed','inspected','ready_for_shipping','shipped'))
  INTO v_total_pieces, v_completed_pieces
  FROM public.production_pieces
  WHERE lot_id = v_lot.id AND status NOT IN ('cancelled','replaced');

  SELECT COALESCE(sum(s.required_steps), 0), COALESCE(sum(s.done_steps), 0)
  INTO v_total_steps, v_completed_steps_count
  FROM (
    SELECT cardinality(COALESCE(p.route_steps, '{}'::text[])) AS required_steps,
           cardinality(ARRAY(
             SELECT DISTINCT step
             FROM unnest(COALESCE(p.route_steps, '{}'::text[])) AS step
             WHERE step = ANY(COALESCE(p.completed_steps, '{}'::text[]))
           )) AS done_steps
    FROM public.production_pieces p
    WHERE p.lot_id = v_lot.id AND p.status NOT IN ('cancelled','replaced')
  ) s;

  v_lot_progress := CASE
    WHEN v_total_steps > 0 THEN ROUND((v_completed_steps_count::numeric / v_total_steps::numeric) * 100, 2)
    WHEN v_total_pieces > 0 THEN ROUND((v_completed_pieces::numeric / v_total_pieces::numeric) * 100, 2)
    ELSE 0
  END;

  UPDATE public.production_lots
  SET progress_percent = LEAST(GREATEST(v_lot_progress, 0), 100),
      produced_quantity = v_completed_pieces,
      approved_quantity = v_completed_pieces,
      pending_quantity = GREATEST(v_total_pieces - v_completed_pieces, 0),
      current_stage = v_target_step_code,
      current_step = v_target_step_code,
      current_cell = v_cell,
      current_status = CASE
        WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'completed'
        ELSE 'in_progress'
      END,
      status = CASE
        WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'waiting_packaging'
        ELSE 'in_progress'
      END,
      actual_start = COALESCE(actual_start, now()),
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  UPDATE public.production_orders
  SET status = CASE WHEN status IN ('completed','cancelled') THEN status ELSE 'in_production' END,
      updated_at = now()
  WHERE id = v_order.id;

  -- Recalcular Lote Geral
  PERFORM public.refresh_pcp_batch_progress(v_piece.pcp_import_batch_id);

  -- Log do evento produtivo
  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id, event_type,
    from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
    event_status, reading_source, barcode_raw_value, legacy_stage_reading_id
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'stage_advance', v_from_stage, v_target_step_code, v_cell, v_session.machine_id::text,
    v_device_id, v_op.id, 'accepted', v_reader_type, v_tag_value, v_reading.id
  );

  -- Entrada MES para gráficos gerais
  INSERT INTO public.production_entries (
    date, shift, cell, hour, produced, target, scrap, downtime, operator, notes,
    created_by, client_event_id, operator_id, order_id, production_order_id,
    lot_id, lot_code, load_number, order_number, customer_name, environment_name,
    operation_name, machine_id, machine_name, pcp_import_batch_id
  ) VALUES (
    v_date, COALESCE(v_shift, 'Não informado'), COALESCE(v_cell, 'Não informada'),
    v_hour, v_quantity, 0, 0, 0, v_operator,
    'Coleta MES validada - Peça: ' || v_piece.traceability_code,
    auth.uid(), v_client_event_id, v_op.id, v_order.id, v_order.id,
    v_lot.id, v_lot.lot_code, v_order.load_number,
    COALESCE(v_order.order_number, v_order.order_code), v_order.customer_name,
    v_piece.environment, v_target_step_code, v_session.machine_id, v_session.machine_name_snapshot,
    v_piece.pcp_import_batch_id
  ) RETURNING id INTO v_entry_id;

  SELECT progress_percent INTO v_general_lot_progress_percent
  FROM public.promob_import_batches
  WHERE id = v_piece.pcp_import_batch_id;

  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', 'green',
    'message', 'Baixa de etapa registrada com sucesso!',
    'lot', to_jsonb(v_lot),
    'order', to_jsonb(v_order),
    'item', to_jsonb(v_piece),
    'reading', to_jsonb(v_reading),
    'lot_progress_percent', v_lot.progress_percent,
    'client_lot_progress', jsonb_build_object(
      'lot_id', v_lot.id,
      'lot_code', v_lot.lot_code,
      'total_parts', v_total_pieces,
      'completed_parts', v_completed_pieces,
      'pending_parts', GREATEST(v_total_pieces - v_completed_pieces, 0),
      'total_operations', v_total_steps,
      'completed_operations', v_completed_steps_count,
      'progress_percent', v_lot.progress_percent
    ),
    'general_lot_progress', jsonb_build_object(
      'pcp_import_batch_id', v_piece.pcp_import_batch_id,
      'general_lot_code', (SELECT general_lot_code FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'total_parts', (SELECT total_parts FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'completed_parts', (SELECT completed_parts FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'pending_parts', (SELECT pending_parts FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'total_operations', (SELECT total_operations FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'completed_operations', (SELECT completed_operations FROM public.promob_import_batches WHERE id = v_piece.pcp_import_batch_id),
      'progress_percent', COALESCE(v_general_lot_progress_percent, 0.0)
    )
  );

  RETURN public.finish_collection_event(v_event.id, 'synced', 'approved', v_result, v_reading.id, NULL, NULL);
END;
$$;

-- ─── 3. Redefinição de get_collection_cell_snapshot com Separação de Escopos ───
CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
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

  -- 2. Calcular Integridade Acumulada
  SELECT 
    count(p.id),
    count(*) FILTER (
      WHERE p.status IN ('rework_pending','rework_in_progress') OR p.rework_status = 'in_progress'
    ),
    count(*) FILTER (
      WHERE p.status IN ('replacement_requested','replacement_in_production') OR p.replacement_status = 'in_production'
    ),
    count(DISTINCT p.lot_id),
    count(DISTINCT p.pcp_import_batch_id)
  INTO v_expected, v_rework, v_replacement, v_active_lots, v_active_batches
  FROM public.production_pieces p
  JOIN public.production_lots l ON l.id = p.lot_id
  WHERE v_step_code = ANY(COALESCE(p.route_steps, '{}'::text[]))
    AND p.status NOT IN ('cancelled','replaced','shipped')
    AND l.status NOT IN ('closed','shipped','cancelled')
    AND (p_pcp_import_batch_id IS NULL OR p.pcp_import_batch_id = p_pcp_import_batch_id)
    AND (p_lot_id IS NULL OR p.lot_id = p_lot_id);

  SELECT count(DISTINCT p.id)
  INTO v_approved_cumulative
  FROM public.production_pieces p
  JOIN public.production_lots l ON l.id = p.lot_id
  JOIN public.collection_stage_facts f ON f.piece_id = p.id
  WHERE f.step_code_canonico = v_step_code
    AND p.status NOT IN ('cancelled','replaced','shipped')
    AND l.status NOT IN ('closed','shipped','cancelled')
    AND (p_pcp_import_batch_id IS NULL OR p.pcp_import_batch_id = p_pcp_import_batch_id)
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
  FROM public.production_stage_readings
  WHERE step_name = v_step_code
    AND status = 'approved'
    AND (p_workstation_id IS NULL OR machine_id = p_workstation_id)
    AND (p_shift IS NULL OR shift = p_shift)
    AND (p_date_from IS NULL OR COALESCE(created_at, created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(created_at, created_at) < p_date_to)
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
    -- Legado (Mantido para compatibilidade do front-end)
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
    
    -- Novo modelo de escopo separado
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
      'approved_unique_stage_completions', v_shift_unique_completions,
      'rejected', v_shift_rejected,
      'blocked', v_shift_blocked,
      'duplicated', v_shift_duplicated,
      'errors', v_shift_errors
    ),
    'active_general_lots', COALESCE(v_active_general_lots, '[]'::jsonb)
  );
END;
$$;

-- ─── 4. RPCs de Progresso Detalhado de Lotes ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_general_lot_progress(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_total_parts bigint := 0;
  v_completed_parts bigint := 0;
  v_total_operations bigint := 0;
  v_completed_operations bigint := 0;
  v_progress_percent numeric(5,2) := 0;
  v_lots jsonb;
  v_recent_reads jsonb;
BEGIN
  SELECT * INTO v_batch FROM public.promob_import_batches WHERE id = p_batch_id;
  IF v_batch.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE p.status IN ('completed','packed','inspected','ready_for_shipping','shipped')),
    COALESCE(sum(cardinality(COALESCE(p.route_steps, '{}'::text[]))), 0),
    COALESCE(sum(cardinality(ARRAY(
      SELECT DISTINCT step
      FROM unnest(COALESCE(p.route_steps, '{}'::text[])) AS step
      WHERE step = ANY(COALESCE(p.completed_steps, '{}'::text[]))
    ))), 0)
  INTO v_total_parts, v_completed_parts, v_total_operations, v_completed_operations
  FROM public.production_pieces p
  WHERE p.pcp_import_batch_id = p_batch_id
    AND p.status NOT IN ('cancelled','replaced');

  v_progress_percent := CASE
    WHEN v_total_operations > 0 THEN ROUND((v_completed_operations::numeric / v_total_operations::numeric) * 100, 2)
    ELSE 0.0
  END;

  SELECT json_agg(t) INTO v_lots
  FROM (
    SELECT 
      l.id AS lot_id,
      l.lot_code,
      l.status,
      l.progress_percent,
      count(p.id) AS total_pieces,
      count(p.id) FILTER (WHERE p.status = 'completed') AS completed_pieces
    FROM public.production_lots l
    LEFT JOIN public.production_pieces p ON p.lot_id = l.id
    WHERE p.pcp_import_batch_id = p_batch_id AND p.status NOT IN ('cancelled','replaced')
    GROUP BY l.id, l.lot_code, l.status, l.progress_percent
    ORDER BY l.lot_code
  ) t;

  SELECT json_agg(r) INTO v_recent_reads
  FROM (
    SELECT 
      e.id AS event_id,
      e.piece_code,
      e.lot_code,
      e.operator_name,
      e.operator_registration_snapshot AS registration,
      e.created_at_client AS read_at,
      e.cell_name,
      e.machine_name_snapshot AS machine_name,
      e.shift_snapshot AS shift,
      e.result_status AS status
    FROM public.production_collection_events e
    WHERE e.pcp_import_batch_id = p_batch_id
    ORDER BY e.created_at_client DESC
    LIMIT 20
  ) r;

  RETURN jsonb_build_object(
    'pcp_import_batch_id', p_batch_id,
    'general_lot_code', v_batch.general_lot_code,
    'total_parts', v_total_parts,
    'completed_parts', v_completed_parts,
    'pending_parts', GREATEST(v_total_parts - v_completed_parts, 0),
    'total_operations', v_total_operations,
    'completed_operations', v_completed_operations,
    'progress_percent', LEAST(GREATEST(v_progress_percent, 0), 100),
    'lots', COALESCE(v_lots, '[]'::jsonb),
    'recent_reads', COALESCE(v_recent_reads, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_general_lots_progress(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
BEGIN
  SELECT json_agg(t) INTO v_res
  FROM (
    SELECT 
      b.id AS pcp_import_batch_id,
      b.general_lot_code,
      b.total_parts,
      b.completed_parts,
      b.pending_parts,
      b.total_operations,
      b.completed_operations,
      b.progress_percent,
      b.created_at
    FROM public.promob_import_batches b
    WHERE b.status <> 'closed'
    ORDER BY b.created_at DESC
    LIMIT p_limit
  ) t;
  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_lot_progress(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot record;
  v_total_parts bigint := 0;
  v_completed_parts bigint := 0;
  v_total_operations bigint := 0;
  v_completed_operations bigint := 0;
  v_progress_percent numeric(5,2) := 0;
BEGIN
  SELECT * INTO v_lot FROM public.production_lots WHERE id = p_lot_id;
  IF v_lot.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE p.status IN ('completed','packed','inspected','ready_for_shipping','shipped')),
    COALESCE(sum(cardinality(COALESCE(p.route_steps, '{}'::text[]))), 0),
    COALESCE(sum(cardinality(ARRAY(
      SELECT DISTINCT step
      FROM unnest(COALESCE(p.route_steps, '{}'::text[])) AS step
      WHERE step = ANY(COALESCE(p.completed_steps, '{}'::text[]))
    ))), 0)
  INTO v_total_parts, v_completed_parts, v_total_operations, v_completed_operations
  FROM public.production_pieces p
  WHERE p.lot_id = p_lot_id
    AND p.status NOT IN ('cancelled','replaced');

  v_progress_percent := CASE
    WHEN v_total_operations > 0 THEN ROUND((v_completed_operations::numeric / v_total_operations::numeric) * 100, 2)
    ELSE 0.0
  END;

  RETURN jsonb_build_object(
    'lot_id', p_lot_id,
    'lot_code', v_lot.lot_code,
    'total_parts', v_total_parts,
    'completed_parts', v_completed_parts,
    'pending_parts', GREATEST(v_total_parts - v_completed_parts, 0),
    'total_operations', v_total_operations,
    'completed_operations', v_completed_operations,
    'progress_percent', LEAST(GREATEST(v_progress_percent, 0), 100)
  );
END;
$$;

-- ─── 4.5. Redefinição de calcular_integridade_do_lote ─────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_integridade_do_lote(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot record;
  v_total_pieces bigint;
  v_approved_pieces bigint;
  v_pending_pieces bigint := 0;
  v_blocked_pieces bigint;
  v_rejected_pieces bigint;
  v_rework_pieces bigint;
  v_replacement_pieces bigint;
  v_packed_pieces bigint;
  
  v_integrity_percent numeric(5,2) := 0.00;
  v_has_open_replacements boolean := false;
  v_has_open_reworks boolean := false;
  
  v_bottleneck text := 'Nenhum';
  v_most_pending_stage text := 'Nenhuma';
  v_can_close boolean := false;
BEGIN
  SELECT * INTO v_lot FROM public.production_lots WHERE id = p_lot_id;
  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lote não encontrado.');
  END IF;

  -- Contagens de peças canônicas
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'completed' OR status = 'inspected' OR status = 'ready_for_shipping' OR status = 'shipped')
  INTO v_total_pieces, v_approved_pieces
  FROM public.production_pieces WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced';

  SELECT COUNT(*) FILTER (WHERE is_blocked = true),
         COUNT(*) FILTER (WHERE status = 'rejected'),
         COUNT(*) FILTER (WHERE status = 'rework_pending' OR status = 'rework_in_progress' OR rework_status = 'in_progress'),
         COUNT(*) FILTER (WHERE status = 'replacement_in_production' OR status = 'replacement_requested' OR replacement_status = 'in_production'),
         COUNT(*) FILTER (WHERE status = 'packed' OR packaging_status = 'packed')
  INTO v_blocked_pieces, v_rejected_pieces, v_rework_pieces, v_replacement_pieces, v_packed_pieces
  FROM public.production_pieces WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced';

  -- Contar peças que possuem etapas pendentes na rota
  DECLARE
    v_piece record;
    v_step text;
    v_is_pending boolean;
  BEGIN
    FOR v_piece IN SELECT * FROM public.production_pieces WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced' LOOP
      v_is_pending := false;
      IF v_piece.route_steps IS NOT NULL THEN
        FOREACH v_step IN ARRAY v_piece.route_steps LOOP
          IF NOT (v_step = ANY(COALESCE(v_piece.completed_steps, '{}'::text[]))) THEN
            v_is_pending := true;
          END IF;
        END LOOP;
      END IF;
      IF v_is_pending THEN
        v_pending_pieces := v_pending_pieces + 1;
      END IF;
    END LOOP;
  END;

  -- Calcular percentual
  IF v_total_pieces > 0 THEN
    v_integrity_percent := ROUND((v_approved_pieces::numeric / v_total_pieces::numeric) * 100, 2);
  ELSE
    v_integrity_percent := 100.00;
  END IF;

  -- Checar ordens em aberto
  IF EXISTS (SELECT 1 FROM public.replacement_orders WHERE lot_id = p_lot_id AND status IN ('Reposição solicitada', 'Reposição em produção')) THEN
    v_has_open_replacements := true;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rework_orders o JOIN public.production_pieces p ON p.id = o.original_piece_id WHERE p.lot_id = p_lot_id AND o.status IN ('pending', 'in_progress')) THEN
    v_has_open_reworks := true;
  END IF;

  -- O lote só pode ser fechado se todas as peças estão aprovadas, nenhuma pendência de rota, e nenhuma ordem em aberto
  IF v_approved_pieces = v_total_pieces AND v_pending_pieces = 0 AND NOT v_has_open_replacements AND NOT v_has_open_reworks AND v_blocked_pieces = 0 AND v_rejected_pieces = 0 THEN
    v_can_close := true;
  END IF;

  -- Determinar o gargalo (etapa obrigatória com mais peças acumuladas/não-concluídas)
  DECLARE
    v_stage_count record;
  BEGIN
    SELECT step_name, COUNT(*) as c INTO v_stage_count
    FROM (
      SELECT unnest(route_steps) as step_name
      FROM public.production_pieces
      WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced'
    ) r
    WHERE step_name NOT IN (
      SELECT unnest(COALESCE(completed_steps, '{}'::text[]))
      FROM public.production_pieces
      WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced'
    )
    GROUP BY step_name
    ORDER BY c DESC LIMIT 1;
    
    IF v_stage_count.step_name IS NOT NULL THEN
      SELECT name INTO v_most_pending_stage FROM public.routing_steps WHERE code = v_stage_count.step_name;
      v_most_pending_stage := COALESCE(v_most_pending_stage, v_stage_count.step_name);
      v_bottleneck := v_most_pending_stage || ' (' || v_stage_count.c || ' peças)';
    END IF;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', p_lot_id,
    'lot_code', v_lot.lot_code,
    'total_pieces', v_total_pieces,
    'approved_pieces', v_approved_pieces,
    'pending_pieces', v_pending_pieces,
    'blocked_pieces', v_blocked_pieces,
    'rejected_pieces', v_rejected_pieces,
    'rework_pieces', v_rework_pieces,
    'replacement_pieces', v_replacement_pieces,
    'packed_pieces', v_packed_pieces,
    'integrity_percent', v_integrity_percent,
    'has_open_replacements', v_has_open_replacements,
    'has_open_reworks', v_has_open_reworks,
    'bottleneck', v_bottleneck,
    'most_pending_stage', v_most_pending_stage,
    'can_close', v_can_close
  );
END;
$$;

-- ─── 5. Reconciliação e Reparo de Dados Históricos Existentes ───────────
DO $$
DECLARE
  v_reconciled_events bigint := 0;
  v_reconciled_pieces bigint := 0;
  r record;
BEGIN
  -- A. Enriquecer metadata de eventos de coleta a partir de production_pieces
  UPDATE public.production_collection_events e
  SET pcp_import_batch_id = p.pcp_import_batch_id,
      lot_id = p.lot_id,
      production_order_id = p.production_order_id,
      lot_code = l.lot_code,
      piece_code = p.traceability_code
  FROM public.production_pieces p
  JOIN public.production_lots l ON l.id = p.lot_id
  WHERE e.piece_id = p.id 
    AND (e.pcp_import_batch_id IS NULL OR e.lot_id IS NULL);
  
  GET DIAGNOSTICS v_reconciled_events = ROW_COUNT;

  -- B. Reconciliar completed_steps das peças com leituras aprovadas do histórico
  UPDATE public.production_pieces p
  SET completed_steps = ARRAY(
    SELECT DISTINCT step
    FROM (
      SELECT unnest(COALESCE(p.completed_steps, '{}'::text[])) AS step
      UNION
      SELECT sr.step_name AS step
      FROM public.production_stage_readings sr
      WHERE sr.piece_id = p.id AND sr.status = 'approved' AND sr.step_name = ANY(COALESCE(p.route_steps, '{}'::text[]))
    ) u
  )
  WHERE p.status NOT IN ('cancelled','replaced');
  
  GET DIAGNOSTICS v_reconciled_pieces = ROW_COUNT;

  -- C. Recalcular progresso de lotes de clientes ativos
  FOR r IN 
    SELECT id FROM public.production_lots WHERE status NOT IN ('closed','cancelled','shipped')
  LOOP
    DECLARE
      v_t_parts bigint := 0;
      v_c_parts bigint := 0;
      v_t_steps bigint := 0;
      v_c_steps bigint := 0;
      v_prog numeric(5,2) := 0;
    BEGIN
      SELECT count(*),
             count(*) FILTER (WHERE status IN ('completed','packed','inspected','ready_for_shipping','shipped'))
      INTO v_t_parts, v_c_parts
      FROM public.production_pieces
      WHERE lot_id = r.id AND status NOT IN ('cancelled','replaced');

      SELECT COALESCE(sum(cardinality(COALESCE(route_steps, '{}'::text[]))), 0),
             COALESCE(sum(cardinality(ARRAY(
               SELECT DISTINCT step
               FROM unnest(COALESCE(route_steps, '{}'::text[])) AS step
               WHERE step = ANY(COALESCE(completed_steps, '{}'::text[]))
             ))), 0)
      INTO v_t_steps, v_c_steps
      FROM public.production_pieces
      WHERE lot_id = r.id AND status NOT IN ('cancelled','replaced');

      v_prog := CASE WHEN v_t_steps > 0 THEN ROUND((v_c_steps::numeric / v_t_steps::numeric) * 100, 2) ELSE 0.0 END;

      UPDATE public.production_lots
      SET progress_percent = LEAST(GREATEST(v_prog, 0), 100),
          produced_quantity = v_c_parts,
          approved_quantity = v_c_parts,
          pending_quantity = GREATEST(v_t_parts - v_c_parts, 0)
      WHERE id = r.id;
    END;
  END LOOP;

  -- D. Recalcular progresso de lotes gerais ativos
  FOR r IN
    SELECT id FROM public.promob_import_batches WHERE status <> 'closed'
  LOOP
    PERFORM public.refresh_pcp_batch_progress(r.id);
  END LOOP;

  RAISE NOTICE 'Reconciliação concluída: % eventos enriquecidos, % peças sincronizadas.', v_reconciled_events, v_reconciled_pieces;
END;
$$;

-- ─── 6. Índices de Desempenho e Concorrência ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_collection_events_batch_created 
  ON public.production_collection_events(pcp_import_batch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collection_events_piece_op_status 
  ON public.production_collection_events(piece_id, operation_name, result_status);

CREATE INDEX IF NOT EXISTS idx_production_pieces_batch_lot 
  ON public.production_pieces(pcp_import_batch_id, lot_id);

GRANT EXECUTE ON FUNCTION public.process_production_reading(jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(text,uuid,text,timestamptz,timestamptz,uuid,uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_general_lot_progress(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_active_general_lots_progress(integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_client_lot_progress(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.calcular_integridade_do_lote(uuid) TO authenticated, anon;

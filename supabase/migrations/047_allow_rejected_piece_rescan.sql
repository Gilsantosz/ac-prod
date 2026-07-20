-- ─── MIGRATION 047: REPROVAÇÃO E RECOLETA DE PEÇAS ───
-- 1. Redesenho de validar_fluxo_da_peca para permitir recoleta de peças com status 'rejected'
CREATE OR REPLACE FUNCTION public.validar_fluxo_da_peca(p_piece_id uuid, p_target_stage text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_piece record;
  v_lot record;
  v_order record;
  v_step_idx integer := 0;
  v_step text;
  v_pending_stages text[] := '{}'::text[];
BEGIN
  -- 1. Buscar peça
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = p_piece_id;
  IF v_piece.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: Peça inexistente no sistema.'
    );
  END IF;

  -- 2. Buscar lote
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: Peça não vinculada a nenhum lote de produção ativo.'
    );
  END IF;

  IF v_lot.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: O lote desta peça foi cancelado.'
    );
  END IF;

  IF v_lot.status = 'closed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: O lote desta peça já foi finalizado/fechado.'
    );
  END IF;

  IF v_lot.status = 'blocked_for_shipping' OR v_lot.status = 'blocked' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: O lote desta peça encontra-se bloqueado para processamento.'
    );
  END IF;

  -- 3. Buscar pedido
  SELECT * INTO v_order FROM public.production_orders WHERE id = v_piece.production_order_id;
  IF v_order.id IS NOT NULL AND (v_order.status = 'closed' OR v_order.status = 'shipped') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: O pedido correspondente a esta peça já foi expedido.'
    );
  END IF;

  -- 4. Verificar condições da peça
  IF v_piece.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: Esta peça foi cancelada no sistema.'
    );
  END IF;

  IF v_piece.status = 'replaced' OR v_piece.replacement_status = 'replaced' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: Esta peça foi reprovada e já substituída por reposição.'
    );
  END IF;

  -- REMOVIDO bloqueio de v_piece.status = 'rejected' para permitir a recoleta da peça.

  IF v_piece.status = 'rework_pending' OR v_piece.status = 'rework_in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'warning',
      'alert_level', 'yellow',
      'message', 'ATENÇÃO — Peça aguarda ou está em retrabalho. Conclua o retrabalho antes de avançar.'
    );
  END IF;

  -- 5. Verificar se já passou por esta estação
  IF p_target_stage = ANY(v_piece.completed_steps) THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'duplicated',
      'alert_level', 'yellow',
      'message', 'ATENÇÃO — Peça já foi processada e aprovada nesta estação.'
    );
  END IF;

  -- 6. Validar sequenciamento e etapas obrigatórias
  IF v_piece.route_steps IS NULL OR array_length(v_piece.route_steps, 1) IS NULL THEN
    -- Fallback para rota do lote
    SELECT array_agg(step_code ORDER BY step_order) INTO v_piece.route_steps
    FROM public.production_routes
    WHERE lot_id = v_piece.lot_id AND required = true;
  END IF;

  -- Se ainda não tem rota definida
  IF v_piece.route_steps IS NULL OR array_length(v_piece.route_steps, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'approved',
      'alert_level', 'blue',
      'message', 'INFORMAÇÃO DO FLUXO: Rota não definida. Entrada liberada.'
    );
  END IF;

  -- Localiza índice da etapa destino
  FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
    IF LOWER(v_piece.route_steps[i]) = LOWER(p_target_stage) THEN
      v_step_idx := i;
      EXIT;
    END IF;
  END LOOP;

  -- Se a etapa não pertence à rota da peça
  IF v_step_idx = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: A estação de ' || p_target_stage || ' não pertence ao roteiro de fabricação desta peça.'
    );
  END IF;

  -- Verificar se há etapas pendentes anteriores obrigatórias
  FOR i IN 1..(v_step_idx - 1) LOOP
    v_step := v_piece.route_steps[i];
    IF NOT (v_step = ANY(v_piece.completed_steps)) THEN
      v_pending_stages := array_append(v_pending_stages, v_step);
    END IF;
  END LOOP;

  IF array_length(v_pending_stages, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'wrong_step',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: A peça pulou etapas obrigatórias anteriores: ' || array_to_string(v_pending_stages, ', ')
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', 'green',
    'message', 'Fluxo produtivo sequencial validado com sucesso.'
  );
END;
$$;


-- 2. Redesenho de register_traceability_rejection para atualizar public.production_pieces.status para 'rejected'
-- e remover a etapa dos completed_steps
CREATE OR REPLACE FUNCTION register_traceability_rejection(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.production_lot_items%ROWTYPE;
  v_tag public.production_tags%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_occurrence public.occurrences%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_prior_reading public.production_stage_readings%ROWTYPE;
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity','')::integer, 1), 1);
  v_date date := COALESCE(NULLIF(p_payload->>'date','')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour',''), to_char(now(), 'HH24:MI'));
  v_shift text := COALESCE(NULLIF(p_payload->>'shift',''), 'Não informado');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_operator_id uuid := NULLIF(p_payload->>'operatorId', '')::uuid;
  v_step text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', '')), '');
  v_reason text := COALESCE(NULLIF(p_payload->>'reason',''), 'Reprovação registrada na coleta produtiva');
  v_defect_type text := NULLIF(p_payload->>'defectType', '');
  v_notes text := NULLIF(p_payload->>'notes', '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'tagValue', p_payload->>'rawValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), 'manual');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', '')), '');
  v_machine_id uuid := NULLIF(p_payload->>'machineId', '')::uuid;
  v_machine_name text := NULLIF(TRIM(p_payload->>'machineName'), '');
  v_release_for_rework boolean := COALESCE(NULLIF(p_payload->>'releaseForRework','')::boolean, true);
  v_message text;
BEGIN
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','operator') THEN
    RETURN jsonb_build_object('success', false, 'status', 'forbidden', 'message', 'Usuário sem permissão para reprovar peças.');
  END IF;

  SELECT * INTO v_item
  FROM public.production_lot_items
  WHERE id = NULLIF(p_payload->>'itemId','')::uuid
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    -- Fallback: busca pelo código da peça
    SELECT i.* INTO v_item
    FROM public.production_lot_items i
    JOIN public.production_pieces p ON p.legacy_production_lot_item_id = i.id
    WHERE p.piece_uid = v_tag_value OR p.traceability_code = v_tag_value
    LIMIT 1;
  END IF;

  IF v_item.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Peça não localizada para reprovar.');
  END IF;

  SELECT * INTO v_lot
  FROM public.production_lots
  WHERE id = COALESCE(NULLIF(p_payload->>'lotId','')::uuid, v_item.lot_id)
  FOR UPDATE;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Lote não localizado para reprovar.');
  END IF;

  IF NULLIF(p_payload->>'tagId','') IS NOT NULL THEN
    SELECT * INTO v_tag FROM public.production_tags WHERE id = NULLIF(p_payload->>'tagId','')::uuid;
  END IF;

  IF v_tag.id IS NULL AND v_tag_value <> '' THEN
    SELECT * INTO v_tag FROM public.production_tags WHERE tag_value = v_tag_value AND active = true LIMIT 1;
  END IF;

  v_tag_value := COALESCE(NULLIF(v_tag.tag_value, ''), NULLIF(v_tag_value, ''), v_item.item_code);
  v_cell := COALESCE(v_cell, v_item.current_cell, 'Não informada');
  v_step := COALESCE(v_step, v_item.current_step);

  SELECT * INTO v_prior_reading
  FROM public.production_stage_readings
  WHERE item_id = v_item.id
    AND step_name IS NOT DISTINCT FROM v_step
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.occurrences (
    date, shift, cell, reason, downtime, operator, notes, created_by,
    lot_id, lot_item_id, production_order_id, stage_reading_id, tag_value, lot_code,
    severity, status, load_number, order_number, customer_name, environment_name,
    piece_code, operation_name
  ) VALUES (
    v_date, v_shift, v_cell, v_reason, 0, v_operator,
    concat_ws(' | ', v_defect_type, v_notes, 'Tag: ' || v_tag_value, CASE WHEN v_release_for_rework THEN 'Liberada para retrabalho' ELSE 'Bloqueada' END),
    auth.uid(), v_lot.id, v_item.source_lot_item_id,
    COALESCE(v_lot.production_order_id, v_lot.order_id),
    NULL, v_tag_value, v_lot.lot_code, 'high', 'open',
    v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name,
    v_item.item_code, v_step
  ) RETURNING * INTO v_occurrence;

  INSERT INTO public.production_stage_readings (
    lot_id, item_id, tag_id, tag_value, reader_type, station_name, step_name, cell_name,
    operator, user_id, shift, date, hour, status, event_type, quantity, occurrence_id, notes,
    lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code,
    production_order_id, machine_id, machine_name, rework_reason
  ) VALUES (
    v_lot.id, v_item.id, v_tag.id, v_tag_value, v_reader_type, v_station, v_step, v_cell,
    v_operator, auth.uid(), v_shift, v_date, v_hour, 'rejected', 'rejected_scan', v_quantity, v_occurrence.id,
    concat_ws(' | ', v_defect_type, v_notes),
    v_lot.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_step, v_item.item_code,
    COALESCE(v_lot.production_order_id, v_lot.order_id), v_machine_id, v_machine_name, v_reason
  ) RETURNING * INTO v_reading;

  UPDATE public.occurrences
  SET stage_reading_id = v_reading.id
  WHERE id = v_occurrence.id
  RETURNING * INTO v_occurrence;

  -- Estorna a leitura anterior para possibilitar nova entrada (recoleta/reposição)
  IF v_prior_reading.id IS NOT NULL THEN
    UPDATE public.production_stage_readings
    SET status = 'pending_review',
        notes = concat_ws(E'\n', NULLIF(notes, ''), 'Estornada por reprovação: ' || v_reason),
        rework_reason = v_reason
    WHERE id = v_prior_reading.id;

    IF v_release_for_rework THEN
      UPDATE public.production_entries
      SET approval_status = 'reversed',
          correction_reason = concat_ws(' | ', 'Estorno automático por retrabalho', v_reason),
          corrected_by = COALESCE(v_operator, auth.uid()::text),
          corrected_at = now(),
          updated_at = now()
      WHERE (v_prior_reading.production_entry_id IS NOT NULL AND id = v_prior_reading.production_entry_id)
         OR (
           v_prior_reading.production_entry_id IS NULL
           AND v_prior_reading.client_event_id IS NOT NULL
           AND client_event_id = v_prior_reading.client_event_id
         );
    END IF;
  END IF;

  IF v_release_for_rework THEN
    UPDATE public.production_lot_items
    SET status = 'rework',
        current_step = COALESCE(v_step, current_step),
        current_cell = COALESCE(v_cell, current_cell),
        rework_count = COALESCE(rework_count, 0) + v_quantity,
        last_rejection_reading_id = v_reading.id,
        last_rejection_reason = v_reason,
        updated_at = now()
    WHERE id = v_item.id
    RETURNING * INTO v_item;

    UPDATE public.production_lots
    SET scrap_count = COALESCE(scrap_count, 0) + v_quantity,
        rework_count = COALESCE(rework_count, 0) + v_quantity,
        rejected_quantity = COALESCE(rejected_quantity, 0) + v_quantity,
        current_status = CASE WHEN current_status IN ('completed','shipped') THEN current_status ELSE 'in_progress' END,
        status = CASE WHEN status = 'shipped' THEN status ELSE 'in_progress' END,
        updated_at = now()
    WHERE id = v_lot.id
    RETURNING * INTO v_lot;

    v_message := 'Peça reprovada, liberada para retrabalho e pronta para recoleta.';
  ELSE
    UPDATE public.production_lot_items
    SET status = 'blocked',
        last_rejection_reading_id = v_reading.id,
        last_rejection_reason = v_reason,
        updated_at = now()
    WHERE id = v_item.id
    RETURNING * INTO v_item;

    UPDATE public.production_lots
    SET scrap_count = COALESCE(scrap_count, 0) + v_quantity,
        rejected_quantity = COALESCE(rejected_quantity, 0) + v_quantity,
        current_status = 'blocked',
        updated_at = now()
    WHERE id = v_lot.id
    RETURNING * INTO v_lot;

    v_message := 'Peça reprovada, bloqueada e ocorrência vinculada.';
  END IF;

  -- ─── NOVO: Atualizar status e completed_steps na tabela production_pieces ───
  UPDATE public.production_pieces
  SET status = 'rejected',
      completed_steps = array_remove(completed_steps, v_step),
      updated_at = now()
  WHERE piece_uid = v_tag_value OR legacy_production_lot_item_id = v_item.id;

  INSERT INTO public.production_entries (
    date, shift, cell, hour, produced, target, scrap, downtime, operator, notes, created_by,
    operator_id, order_id, production_order_id, lot_id, lot_code, load_number, order_number,
    customer_name, customer_legal_name, environment_name, operation_name, machine_id, machine_name,
    rework_reason
  ) VALUES (
    v_date, v_shift, v_cell, v_hour, 0, 0, v_quantity, 0, v_operator,
    CASE WHEN v_release_for_rework THEN 'Reprovação liberada para retrabalho - tag ' || v_tag_value ELSE 'Reprovação vinculada a tag ' || v_tag_value END,
    auth.uid(), v_operator_id, COALESCE(v_lot.production_order_id, v_lot.order_id), COALESCE(v_lot.production_order_id, v_lot.order_id),
    v_lot.id, v_lot.lot_code, v_item.load_number, v_item.order_number,
    v_item.customer_name, v_item.customer_name, v_item.environment_name, v_step, v_machine_id, v_machine_name,
    CASE WHEN v_release_for_rework THEN v_reason ELSE NULL END
  );

  INSERT INTO public.traceability_logs (user_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(), 'rejected_scan', 'production_lot_item', v_item.id,
    jsonb_build_object(
      'reading_id', v_reading.id,
      'occurrence_id', v_occurrence.id,
      'reason', v_reason,
      'release_for_rework', v_release_for_rework,
      'previous_approved_reading_id', CASE WHEN v_prior_reading.id IS NULL THEN NULL ELSE v_prior_reading.id END
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN v_release_for_rework THEN 'rework' ELSE 'rejected' END,
    'message', v_message,
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_item),
    'reading', to_jsonb(v_reading),
    'occurrence', to_jsonb(v_occurrence)
  );
END;
$$;


-- 3. Redesenho de process_production_reading para aceitar reposição de peça reprovada
-- e marcar como aprovada reposição (is_replacement = true e replacement_status = 'in_production')
CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Se a peça estava com status de reprovação, entra como aprovada reposição
  UPDATE public.production_pieces
  SET completed_steps = v_new_completed_steps,
      current_stage = COALESCE(v_next_step, 'Concluída'),
      status = CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_progress' END,
      is_replacement = CASE WHEN status = 'rejected' THEN true ELSE is_replacement END,
      replacement_status = CASE WHEN status = 'rejected' THEN 'in_production'::text ELSE replacement_status END,
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

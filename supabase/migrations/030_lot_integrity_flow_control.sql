-- ============================================================
-- AC.Prod MES — Fase: Motor de Integridade do Lote e Fluxo
-- Migration 030 — Implantação do LotIntegrityEngine
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. EXPANSÃO DE TABELAS DE ROTEIROS
-- ─────────────────────────────────────────────────────────────

-- Adiciona campos extras em route_templates
ALTER TABLE public.route_templates
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS application text,
  ADD COLUMN IF NOT EXISTS allow_skip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_final_inspection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_individual_packaging boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────
-- 2. EXPANSÃO DE TABELA DE PEÇAS
-- ─────────────────────────────────────────────────────────────

-- Atualizar CHECK constraint para status da peça se necessário
ALTER TABLE public.production_pieces DROP CONSTRAINT IF EXISTS production_pieces_status_check;
ALTER TABLE public.production_pieces ADD CONSTRAINT production_pieces_status_check CHECK (status IN (
  'created', 'planned', 'in_progress', 'completed', 'blocked', 'rejected',
  'rework_pending', 'rework_in_progress', 'rework_approved',
  'replacement_requested', 'replacement_in_production', 'replaced',
  'packed', 'inspected', 'ready_for_shipping', 'shipped', 'cancelled'
));

-- Atualizar CHECK constraint para status do lote
ALTER TABLE public.production_lots DROP CONSTRAINT IF EXISTS production_lots_status_check;
ALTER TABLE public.production_lots ADD CONSTRAINT production_lots_status_check CHECK (status IN (
  'imported', 'in_separation', 'in_progress', 'pending', 'replacement', 'rework',
  'waiting_packaging', 'in_final_inspection', 'blocked_for_shipping', 'released_for_shipping',
  'closed', 'shipped', 'cancelled'
));

-- Adiciona colunas de controle na tabela production_pieces
ALTER TABLE public.production_pieces
  ADD COLUMN IF NOT EXISTS route_template_id uuid REFERENCES public.route_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_steps text[],
  ADD COLUMN IF NOT EXISTS completed_steps text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS rework_status text NOT NULL DEFAULT 'none' CHECK (rework_status IN ('none', 'pending', 'in_progress', 'completed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS replacement_status text NOT NULL DEFAULT 'none' CHECK (replacement_status IN ('none', 'requested', 'in_production', 'replaced')),
  ADD COLUMN IF NOT EXISTS packaging_status text NOT NULL DEFAULT 'pending' CHECK (packaging_status IN ('pending', 'packed')),
  ADD COLUMN IF NOT EXISTS volume_id uuid REFERENCES public.packing_volumes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- ─────────────────────────────────────────────────────────────
-- 3. TABELAS DE REPOSIÇÕES E EXCEÇÕES DE FLUXO
-- ─────────────────────────────────────────────────────────────

-- Tabela de ordens de reposição de peças
CREATE TABLE IF NOT EXISTS public.replacement_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_piece_id    uuid NOT NULL REFERENCES public.production_pieces(id) ON DELETE CASCADE,
  replacement_piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  reason               text NOT NULL,
  priority             text NOT NULL DEFAULT 'high' CHECK (priority IN ('normal', 'high', 'critical')),
  lot_id               uuid REFERENCES public.production_lots(id) ON DELETE CASCADE,
  production_order_id  uuid REFERENCES public.production_orders(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'Reposição em produção'
                       CHECK (status IN ('Reposição solicitada', 'Reposição em produção', 'Finalizada', 'Cancelada')),
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Tabela de exceções de fluxo (Liberação Especial)
CREATE TABLE IF NOT EXISTS public.flow_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id       uuid NOT NULL REFERENCES public.production_pieces(id) ON DELETE CASCADE,
  skipped_stage  text NOT NULL,
  reason         text NOT NULL,
  justification  text NOT NULL,
  impact         text,
  authorized_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.replacement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "replacement_orders_select" ON public.replacement_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "replacement_orders_manage" ON public.replacement_orders FOR ALL TO authenticated USING (true);

CREATE POLICY "flow_exceptions_select" ON public.flow_exceptions FOR SELECT TO authenticated USING (true);
CREATE POLICY "flow_exceptions_manage" ON public.flow_exceptions FOR ALL TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- 4. FUNÇÕES DE RESOLUÇÃO AUTOMÁTICA DE ROTEIRO
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.select_route_template_for_piece(p_piece public.production_pieces)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_template_id uuid;
  v_product_type text;
BEGIN
  -- Determina a categoria do roteiro com base nas flags de processo
  IF p_piece.requires_joinery = true THEN
    IF p_piece.requires_cnc = true THEN
      v_product_type := 'custom_refined';
    ELSE
      v_product_type := 'special_joinery';
    END IF;
  ELSE
    IF p_piece.requires_cnc = true THEN
      v_product_type := 'cnc';
    ELSIF p_piece.requires_edge = true THEN
      v_product_type := 'edge';
    ELSE
      v_product_type := 'standard';
    END IF;
  END IF;

  -- Tenta buscar o último roteiro ativo desse tipo
  SELECT id INTO v_template_id FROM public.route_templates 
  WHERE product_type = v_product_type AND active = true 
  ORDER BY created_at DESC LIMIT 1;

  -- Fallback para qualquer roteiro ativo se não localizar o tipo específico
  IF v_template_id IS NULL THEN
    SELECT id INTO v_template_id FROM public.route_templates 
    WHERE active = true 
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  RETURN v_template_id;
END;
$$;

-- Gatilho BEFORE INSERT na production_pieces para auto-popular o roteiro
CREATE OR REPLACE FUNCTION public.trg_fn_populate_piece_route()
RETURNS trigger AS $$
DECLARE
  v_template_id uuid;
  v_steps text[];
BEGIN
  -- Só popula se route_steps estiver vazio
  IF NEW.route_steps IS NULL OR array_length(NEW.route_steps, 1) IS NULL THEN
    v_template_id := public.select_route_template_for_piece(NEW);
    
    SELECT array_agg(step_code ORDER BY sequence) INTO v_steps
    FROM public.route_template_steps
    WHERE route_template_id = v_template_id;

    NEW.route_template_id := v_template_id;
    NEW.route_steps := v_steps;
    NEW.current_stage := COALESCE(v_steps[1], 'created');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_populate_piece_route ON public.production_pieces;
CREATE TRIGGER trg_populate_piece_route
  BEFORE INSERT ON public.production_pieces
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_populate_piece_route();

-- ─────────────────────────────────────────────────────────────
-- 5. MOTOR DE INTEGRIDADE: VALIDAR FLUXO DA PEÇA
-- ─────────────────────────────────────────────────────────────

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

  IF v_piece.status = 'rejected' THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: Peça reprovada que não pode seguir fluxo de produção.'
    );
  END IF;

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

  -- Varre etapas obrigatórias anteriores
  FOR i IN 1..(v_step_idx - 1) LOOP
    v_step := v_piece.route_steps[i];
    IF NOT (v_step = ANY(v_piece.completed_steps)) THEN
      DECLARE
        v_step_display text;
      BEGIN
        SELECT name INTO v_step_display FROM public.routing_steps WHERE code = v_step;
        v_step_display := COALESCE(v_step_display, v_step);
        v_pending_stages := array_append(v_pending_stages, v_step_display);
      END;
    END IF;
  END LOOP;

  -- Se houver estações obrigatórias anteriores pendentes
  IF array_length(v_pending_stages, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'blocked',
      'alert_level', 'red',
      'message', 'ENTRADA BLOQUEADA: Esta peça ainda não passou pela estação ' || array_to_string(v_pending_stages, ', ') || '. Direcione a peça para a estação pendente antes de continuar.',
      'pending_stages', v_pending_stages
    );
  END IF;

  -- Aprovada para entrada na estação
  RETURN jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', 'green',
    'message', 'PEÇA LIBERADA — Processo registrado com sucesso.'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. REDESENHO DE process_production_reading COM MOTOR DE INTEGRIDADE
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_event_id text := TRIM(p_payload->>'client_event_id');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), 'keyboard_barcode');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', '')), '');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', '')), '');
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_shift text := NULLIF(TRIM(COALESCE(p_payload->>'shift', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour', ''), to_char(now(), 'HH24:MI'));
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_created_at_client timestamptz := COALESCE(NULLIF(p_payload->>'createdAtClient', '')::timestamptz, now());

  v_machine_id uuid := NULLIF(p_payload->>'machineId', '')::uuid;
  v_machine_name text := NULLIF(TRIM(p_payload->>'machineName'), '');
  v_enqueue_duration_ms numeric := (p_payload->>'enqueue_duration_ms')::numeric;
  v_sync_started_at timestamptz := now();

  v_operator_id uuid;
  v_registration text;
  v_operator_row public.operators%ROWTYPE;

  v_event public.production_collection_events%ROWTYPE;
  v_tag public.production_tags%ROWTYPE;
  v_item public.production_lot_items%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_piece public.production_pieces%ROWTYPE;
  v_route public.production_routes%ROWTYPE;
  v_next public.production_routes%ROWTYPE;
  
  v_val_res jsonb;
  v_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_recent integer := 0;
  v_total integer := 0;
  v_completed integer := 0;
BEGIN
  -- 1. Validar autenticação
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','supervisor','operator') THEN
    RETURN jsonb_build_object('success', false, 'status', 'forbidden', 'message', 'Usuário sem permissão para coleta produtiva.');
  END IF;

  IF v_client_event_id IS NULL OR v_client_event_id = '' THEN
    v_client_event_id := gen_random_uuid()::text;
  END IF;

  -- 2. Resolver operador
  IF p_payload->>'operatorId' IS NOT NULL AND p_payload->>'operatorId' <> '' THEN
    SELECT * INTO v_operator_row FROM public.operators WHERE id = (p_payload->>'operatorId')::uuid;
  ELSE
    SELECT * INTO v_operator_row FROM public.operators WHERE LOWER(name) = LOWER(v_operator) LIMIT 1;
  END IF;

  IF v_operator_row.id IS NOT NULL THEN
    v_operator_id := v_operator_row.id;
    v_operator := v_operator_row.name;
    v_registration := v_operator_row.registration;
    v_shift := COALESCE(v_shift, v_operator_row.shift);
  END IF;

  -- Registrar evento inicial como 'processing'
  INSERT INTO public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type,
    operator_id, operator_name, registration, cell_name, shift, date, hour,
    status, created_at_client, payload,
    machine_id, machine_name, station_name, enqueue_duration_ms, sync_started_at
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_operator_id, v_operator, v_registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload,
    v_machine_id, v_machine_name, v_station, v_enqueue_duration_ms, v_sync_started_at
  ) RETURNING * INTO v_event;

  -- 3. Validar tag vazia
  IF v_tag_value = '' THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'invalid', error_message = 'Identificação vazia.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'Informe uma identificação produtiva válida.');
  END IF;

  -- 4. Localizar peça canônica
  SELECT * INTO v_piece FROM public.production_pieces
  WHERE UPPER(traceability_code) = v_tag_value OR UPPER(piece_uid) = v_tag_value
  LIMIT 1;

  IF v_piece.id IS NULL THEN
    -- Fallback para localizar em production_lot_items
    SELECT * INTO v_item FROM public.production_lot_items WHERE UPPER(item_code) = v_tag_value LIMIT 1;
    IF v_item.id IS NOT NULL THEN
      -- Se achou o item, a peça deveria ter sido criada. Tenta forçar a criação por precaução
      SELECT * INTO v_piece FROM public.production_pieces WHERE legacy_production_lot_item_id = v_item.id LIMIT 1;
    END IF;
  END IF;

  IF v_piece.id IS NULL THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'not_found', error_message = 'Peça não localizada no sistema.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Peça não localizada no sistema.');
  END IF;

  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;

  -- Preencher detalhes no ledger de coletas
  UPDATE public.production_collection_events SET
    lot_id = v_piece.lot_id,
    lot_code = v_lot.lot_code,
    order_number = (SELECT order_number FROM public.production_orders WHERE id = v_piece.production_order_id),
    customer_name = (SELECT customer_name FROM public.production_orders WHERE id = v_piece.production_order_id),
    environment_name = v_piece.environment,
    piece_code = v_piece.traceability_code
  WHERE id = v_event.id;

  -- 5. Resolver rota e etapa esperada
  -- Mapeia a célula atual do operador (Corte, Borda, Usinagem, etc.) para o código de rota (cut, edge, cnc, etc.)
  -- Caso contrário, usa o v_step_input do payload
  DECLARE
    v_target_step_code text;
  BEGIN
    IF v_step_input IS NOT NULL THEN
      v_target_step_code := v_step_input;
    ELSE
      SELECT code INTO v_target_step_code FROM public.routing_steps
      WHERE LOWER(code) = LOWER(v_cell) OR LOWER(name) = LOWER(v_cell)
         OR (v_cell = 'Borda' AND code = 'edge')
         OR (v_cell = 'Bordo' AND code = 'edge')
         OR (v_cell = 'Usinagem' AND code = 'cnc')
         OR (v_cell = 'Furação' AND code = 'drill');
    END IF;

    IF v_target_step_code IS NULL THEN
      v_target_step_code := v_piece.current_stage;
    END IF;

    -- 6. Executar o Motor de Integridade do Lote (LotIntegrityEngine)
    v_val_res := public.validar_fluxo_da_peca(v_piece.id, v_target_step_code);
    
    IF NOT (v_val_res->>'success')::boolean THEN
      -- Log do bloqueio/erro
      INSERT INTO public.production_events (
        piece_id, traceability_code, production_order_id, lot_id,
        event_type, from_stage, to_stage, cell_name, operator_id, event_status, notes
      ) VALUES (
        v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
        'block', v_piece.current_stage, v_target_step_code, v_cell, v_operator_id, 'blocked', v_val_res->>'message'
      );

      UPDATE public.production_collection_events
      SET status = 'ignored', result_status = 'blocked', error_message = v_val_res->>'message', processed_at = now()
      WHERE id = v_event.id;

      RETURN jsonb_build_object(
        'success', false,
        'status', v_val_res->>'status',
        'alert_level', v_val_res->>'alert_level',
        'message', v_val_res->>'message',
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_piece)
      );
    END IF;

    -- Evitar leituras consecutivas duplicadas (debounce de 2s)
    SELECT COUNT(*) INTO v_recent FROM public.production_stage_readings
    WHERE tag_value = v_piece.piece_uid AND step_name = v_target_step_code AND status = 'approved'
      AND created_at >= (now() - interval '2 seconds');

    IF v_recent > 0 THEN
      UPDATE public.production_collection_events
      SET status = 'ignored', result_status = 'duplicated', error_message = 'Debounce ativo.', processed_at = now()
      WHERE id = v_event.id;
      
      RETURN jsonb_build_object(
        'success', false,
        'status', 'duplicated',
        'alert_level', 'yellow',
        'message', 'Leitura duplicada ignorada (debounce).'
      );
    END IF;

    -- 7. Registrar a leitura com sucesso
    INSERT INTO public.production_stage_readings (
      tag_value, tag_type, reader_type, reader_id, station_name, cell_name, operator, shift, date, hour,
      item_id, lot_id, step_name, quantity, status, operator_id, machine_id
    ) VALUES (
      v_piece.piece_uid, 'barcode', v_reader_type, v_event.device_id, v_station, v_cell, v_operator, v_shift, v_date, v_hour,
      v_piece.id, v_piece.lot_id, v_target_step_code, v_quantity, 'approved', v_operator_id, v_machine_id
    ) RETURNING * INTO v_reading;

    -- 8. Atualizar peça e completed_steps
    DECLARE
      v_new_completed_steps text[];
      v_next_step text := NULL;
      v_found_next boolean := false;
    BEGIN
      -- Adiciona ao final do array completed_steps se não estiver presente
      IF NOT (v_target_step_code = ANY(v_piece.completed_steps)) THEN
        v_new_completed_steps := array_append(v_piece.completed_steps, v_target_step_code);
      ELSE
        v_new_completed_steps := v_piece.completed_steps;
      END IF;

      -- Encontra o próximo estágio permitido
      IF v_piece.route_steps IS NOT NULL THEN
        FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
          IF v_found_next THEN
            v_next_step := v_piece.route_steps[i];
            EXIT;
          END IF;
          IF LOWER(v_piece.route_steps[i]) = LOWER(v_target_step_code) THEN
            v_found_next := true;
          END IF;
        END LOOP;
      END IF;

      UPDATE public.production_pieces SET
        completed_steps = v_new_completed_steps,
        current_stage = COALESCE(v_next_step, v_target_step_code),
        status = CASE WHEN v_next_step IS NULL THEN 'completed'::text ELSE 'in_progress'::text END,
        updated_at = now()
      WHERE id = v_piece.id;
    END;

    -- 9. Atualizar produção legada para compatibilidade de visualização
    UPDATE public.production_lot_items
    SET current_step = COALESCE((SELECT name FROM public.routing_steps WHERE code = v_piece.current_stage), v_piece.current_stage),
        status = CASE WHEN v_piece.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
        updated_at = now()
    WHERE id = v_piece.legacy_production_lot_item_id;

    -- 10. Atualizar progresso do lote
    SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
    INTO v_total, v_completed
    FROM public.production_pieces WHERE lot_id = v_lot.id;

    UPDATE public.production_lots
    SET progress_percent = CASE WHEN v_total > 0 THEN ROUND((v_completed::numeric / v_total::numeric) * 100, 2) ELSE 0 END,
        current_status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'completed' ELSE 'in_progress' END,
        status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'waiting_packaging' ELSE 'in_progress' END,
        updated_at = now()
    WHERE id = v_lot.id
    RETURNING * INTO v_lot;

    -- 11. Gravar log do evento
    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id,
      event_type, from_stage, to_stage, cell_name, operator_id, event_status
    ) VALUES (
      v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
      'stage_advance', v_piece.current_stage, v_target_step_code, v_cell, v_operator_id, 'accepted'
    );

    -- Gravar produção legada na tabela de entries
    INSERT INTO public.production_entries (
      date, shift, cell, hour, produced, target, scrap, downtime, operator, notes, created_by, client_event_id,
      operator_id, order_id, production_order_id, lot_id, lot_code, load_number, order_number,
      customer_name, environment_name, operation_name, machine_id, machine_name
    ) VALUES (
      v_date, COALESCE(v_shift, 'Não informado'), COALESCE(v_cell, 'Não informada'), v_hour, v_quantity, 0, 0, 0,
      v_operator, 'Coleta validada pelo LotIntegrityEngine - Tag: ' || v_tag_value, auth.uid(), v_client_event_id,
      v_operator_id, v_lot.production_order_id, v_lot.production_order_id, v_lot.id, v_lot.lot_code, '', '',
      '', v_piece.environment, v_target_step_code, v_machine_id, v_machine_name
    ) RETURNING id INTO v_entry_id;

    -- Atualiza ledger
    UPDATE public.production_collection_events SET
      status = 'synced',
      reading_id = v_reading.id,
      production_entry_id = v_entry_id,
      processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'approved',
      'alert_level', v_val_res->>'alert_level',
      'message', v_val_res->>'message',
      'lot', to_jsonb(v_lot),
      'item', to_jsonb(v_piece),
      'reading', to_jsonb(v_reading)
    );
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. REPOSIÇÃO AUTOMÁTICA DE PEÇA
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_piece_replacement(p_original_piece_id uuid, p_reason text, p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_original record;
  v_sub_uid text;
  v_sub_tcode text;
  v_sub_piece_id uuid;
  v_replacement_order_id uuid;
BEGIN
  -- 1. Obter peça original
  SELECT * INTO v_original FROM public.production_pieces WHERE id = p_original_piece_id;
  IF v_original.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça original não encontrada.');
  END IF;

  -- 2. Atualizar peça original para substituída
  UPDATE public.production_pieces SET
    status = 'replaced',
    replacement_status = 'replaced',
    is_blocked = true,
    block_reason = 'REPROVADA: ' || p_reason || ' - Substituída por reposição',
    updated_at = now()
  WHERE id = p_original_piece_id;

  -- 3. Gerar identificador para a reposição
  v_sub_uid := public.generate_piece_uid();
  v_sub_tcode := replace(v_sub_uid, 'PC-', '') || '-R'; -- Sufixo de reposição

  -- 4. Inserir peça substituta na rota (reinicia no Corte)
  INSERT INTO public.production_pieces (
    piece_uid,
    traceability_code,
    production_order_id,
    lot_id,
    module_name,
    environment,
    piece_name,
    description,
    material,
    color,
    thickness,
    width,
    height,
    length,
    grain_direction,
    edge_front,
    edge_back,
    edge_left,
    edge_right,
    requires_cut,
    requires_edge,
    requires_cnc,
    requires_joinery,
    requires_separation,
    requires_packaging,
    current_stage,
    status,
    source_origin,
    original_piece_id,
    is_replacement,
    replacement_status,
    route_template_id,
    route_steps,
    created_by
  ) VALUES (
    v_sub_uid,
    v_sub_tcode,
    v_original.production_order_id,
    v_original.lot_id,
    v_original.module_name,
    v_original.environment,
    v_original.piece_name || ' (REPOSIÇÃO)',
    v_original.description,
    v_original.material,
    v_original.color,
    v_original.thickness,
    v_original.width,
    v_original.height,
    v_original.length,
    v_original.grain_direction,
    v_original.edge_front,
    v_original.edge_back,
    v_original.edge_left,
    v_original.edge_right,
    v_original.requires_cut,
    v_original.requires_edge,
    v_original.requires_cnc,
    v_original.requires_joinery,
    v_original.requires_separation,
    v_original.requires_packaging,
    v_original.route_steps[1],
    'replacement_in_production',
    'rework',
    v_original.id,
    true,
    'in_production',
    v_original.route_template_id,
    v_original.route_steps,
    auth.uid()
  ) RETURNING id INTO v_sub_piece_id;

  -- 5. Criar a ordem de reposição correspondente
  INSERT INTO public.replacement_orders (
    original_piece_id,
    replacement_piece_id,
    reason,
    priority,
    lot_id,
    production_order_id,
    status,
    created_by
  ) VALUES (
    v_original.id,
    v_sub_piece_id,
    p_reason,
    'high',
    v_original.lot_id,
    v_original.production_order_id,
    'Reposição em produção',
    auth.uid()
  ) RETURNING id INTO v_replacement_order_id;

  -- 6. Gravar evento de reprovação e início de reposição
  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status, notes
  ) VALUES (
    v_original.id, v_original.traceability_code, v_original.production_order_id, v_original.lot_id,
    'rework_start', v_original.current_stage, v_original.route_steps[1], 'rejected', p_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'replacement_order_id', v_replacement_order_id,
    'original_piece_id', v_original.id,
    'replacement_piece_id', v_sub_piece_id,
    'replacement_uid', v_sub_uid,
    'replacement_code', v_sub_tcode
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. LIBERAÇÃO ESPECIAL (EXCEÇÃO CONTROLADA)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.authorize_special_release(
  p_piece_id uuid,
  p_stage text,
  p_reason text,
  p_justification text,
  p_impact text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_piece record;
  v_user_id uuid;
  v_role text;
  v_new_completed_steps text[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Autenticação necessária.');
  END IF;

  v_role := public.get_my_role();
  IF v_role NOT IN ('admin', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apenas Administradores ou Gestores podem autorizar Liberação Especial.');
  END IF;

  SELECT * INTO v_piece FROM public.production_pieces WHERE id = p_piece_id;
  IF v_piece.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça não encontrada.');
  END IF;

  -- Registrar na tabela de exceções
  INSERT INTO public.flow_exceptions (
    piece_id, skipped_stage, reason, justification, impact, authorized_by
  ) VALUES (
    p_piece_id, p_stage, p_reason, p_justification, p_impact, v_user_id
  );

  -- Adicionar etapa liberada ao completed_steps da peça
  IF NOT (p_stage = ANY(v_piece.completed_steps)) THEN
    v_new_completed_steps := array_append(v_piece.completed_steps, p_stage);
  ELSE
    v_new_completed_steps := v_piece.completed_steps;
  END IF;

  UPDATE public.production_pieces SET
    completed_steps = v_new_completed_steps,
    is_blocked = false,
    block_reason = NULL,
    updated_at = now()
  WHERE id = p_piece_id;

  -- Gravar evento de correção
  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status, notes
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'correction', v_piece.current_stage, p_stage, 'accepted', 'Liberação Especial: ' || p_justification
  );

  RETURN jsonb_build_object('success', true, 'piece_id', p_piece_id, 'stage_released', p_stage);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 9. CÁLCULO DE INTEGRIDADE DO LOTE
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calcular_integridade_do_lote(p_lot_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
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
  INTO v_blocked_pieces, v_rejected_pieces, v_rework_pieces, v_replacement_pieces, v_packed_pieces;

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
          IF NOT (v_step = ANY(v_piece.completed_steps)) THEN
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
      SELECT unnest(completed_steps)
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

-- ─────────────────────────────────────────────────────────────
-- 10. GRANTS
-- ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.select_route_template_for_piece(public.production_pieces) TO authenticated;
DO $$
BEGIN
  IF to_regprocedure('public.populate_piece_route_steps(uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.populate_piece_route_steps(uuid) TO authenticated;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.validar_fluxo_da_peca(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_production_reading(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_piece_replacement(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_special_release(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calcular_integridade_do_lote(uuid) TO authenticated;

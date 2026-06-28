-- ============================================================
-- AC.Prod — MES Fase 2: Addons para KPI por Célula e Rota por Peça
-- Migration 020 — Aditiva, sem drops de dados existentes
-- ============================================================

-- Add columns to public.lot_items
ALTER TABLE public.lot_items
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text;

-- Add columns to public.production_lot_items
ALTER TABLE public.production_lot_items
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS environment_name text;

-- Add columns to public.production_stage_readings
ALTER TABLE public.production_stage_readings
  ADD COLUMN IF NOT EXISTS production_entry_id uuid REFERENCES public.production_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS environment_name text,
  ADD COLUMN IF NOT EXISTS operation_name text,
  ADD COLUMN IF NOT EXISTS piece_code text;

-- Add columns to public.production_entries
ALTER TABLE public.production_entries
  ADD COLUMN IF NOT EXISTS environment_name text,
  ADD COLUMN IF NOT EXISTS operation_name text;

-- Add columns to public.production_collection_events
ALTER TABLE public.production_collection_events
  ADD COLUMN IF NOT EXISTS registration text,
  ADD COLUMN IF NOT EXISTS operation_name text,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.production_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS environment_name text,
  ADD COLUMN IF NOT EXISTS piece_code text;

-- Add columns to public.occurrences
ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS collection_event_id uuid REFERENCES public.production_collection_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS environment_name text,
  ADD COLUMN IF NOT EXISTS piece_code text,
  ADD COLUMN IF NOT EXISTS operation_name text;

-- Helper function to check if a piece requires a specific step
CREATE OR REPLACE FUNCTION piece_requires_step(p_source_lot_item_id uuid, p_step_name text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_item record;
  v_clean_step text := lower(p_step_name);
BEGIN
  SELECT * INTO v_item FROM public.lot_items WHERE id = p_source_lot_item_id;
  IF NOT FOUND THEN
    RETURN true; -- fallback
  END IF;

  IF v_clean_step = 'corte' THEN
    RETURN COALESCE(v_item.requires_cut, true);
  ELSIF v_clean_step = 'bordo' OR v_clean_step = 'bordeamento' THEN
    RETURN COALESCE(v_item.requires_edge, false);
  ELSIF v_clean_step = 'usinagem' THEN
    RETURN COALESCE(v_item.requires_cnc, false);
  ELSIF v_clean_step = 'marcenaria' THEN
    RETURN COALESCE(v_item.requires_joinery, false);
  ELSIF v_clean_step = 'separação' OR v_clean_step = 'separacao' THEN
    RETURN COALESCE(v_item.requires_separation, true);
  ELSIF v_clean_step = 'embalagem' THEN
    RETURN COALESCE(v_item.requires_packaging, true);
  ELSIF v_clean_step = 'expedição' OR v_clean_step = 'expedicao' THEN
    RETURN COALESCE(v_item.requires_shipping, true);
  ELSE
    RETURN true; -- Qualquer outra etapa é considerada requerida por padrão
  END IF;
END;
$$;

-- View production_cell_progress
CREATE OR REPLACE VIEW public.production_cell_progress AS
WITH planned_steps AS (
  SELECT 
    pli.lot_id,
    pli.lot_code,
    pli.load_number,
    pli.order_number,
    pli.customer_name,
    pli.environment_name,
    r.cell_name,
    r.step_name AS operation_name,
    pli.id AS item_id,
    pli.item_code
  FROM public.production_lot_items pli
  JOIN public.production_routes r ON r.lot_id = pli.lot_id
  WHERE r.required = true AND piece_requires_step(pli.source_lot_item_id, r.step_name) = true
),
readings_summary AS (
  SELECT 
    item_id,
    step_name AS operation_name,
    COALESCE(cell_name, '') AS cell_name,
    COALESCE(SUM(CASE WHEN status = 'approved' THEN quantity ELSE 0 END), 0) AS approved_qty,
    COALESCE(SUM(CASE WHEN status = 'rejected' THEN quantity ELSE 0 END), 0) AS rejected_qty,
    COALESCE(SUM(CASE WHEN status = 'blocked' THEN quantity ELSE 0 END), 0) AS blocked_qty,
    MIN(created_at) AS first_scan,
    MAX(created_at) AS last_scan
  FROM public.production_stage_readings
  GROUP BY item_id, step_name, COALESCE(cell_name, '')
)
SELECT 
  p.lot_id,
  p.lot_code,
  p.load_number,
  p.order_number,
  p.customer_name,
  p.environment_name,
  COALESCE(p.cell_name, '') AS cell_name,
  p.operation_name,
  COUNT(DISTINCT p.item_id) AS planned_quantity,
  COALESCE(SUM(r.approved_qty), 0) AS approved_quantity,
  COALESCE(SUM(r.rejected_qty), 0) AS rejected_quantity,
  COALESCE(SUM(r.blocked_qty), 0) AS blocked_quantity,
  GREATEST(COUNT(DISTINCT p.item_id) - COALESCE(SUM(r.approved_qty), 0), 0) AS pending_quantity,
  ROUND(
    CASE 
      WHEN COUNT(DISTINCT p.item_id) > 0 
      THEN LEAST((COALESCE(SUM(r.approved_qty), 0)::numeric / COUNT(DISTINCT p.item_id)::numeric) * 100, 100)
      ELSE 0 
    END, 2
  ) AS progress_percent,
  MIN(r.first_scan) AS first_scan_at,
  MAX(r.last_scan) AS last_scan_at
FROM planned_steps p
LEFT JOIN readings_summary r ON r.item_id = p.item_id AND LOWER(r.operation_name) = LOWER(p.operation_name)
GROUP BY 
  p.lot_id,
  p.lot_code,
  p.load_number,
  p.order_number,
  p.customer_name,
  p.environment_name,
  COALESCE(p.cell_name, ''),
  p.operation_name;

GRANT SELECT ON public.production_cell_progress TO authenticated, anon;

-- Processamento atomico da leitura com suporte a idempotencia, ledger e rotas customizadas por peca
CREATE OR REPLACE FUNCTION process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  v_operator_id uuid;
  v_registration text;
  v_operator_row public.operators%ROWTYPE;

  v_event public.production_collection_events%ROWTYPE;
  v_tag public.production_tags%ROWTYPE;
  v_item public.production_lot_items%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_route public.production_routes%ROWTYPE;
  v_next public.production_routes%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_recent integer := 0;
  v_total integer := 0;
  v_completed integer := 0;
  v_result jsonb;
BEGIN
  -- 1. Validar autenticação
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','operator') THEN
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

  -- 3. Verificar se o evento já existe (idempotência)
  SELECT * INTO v_event FROM public.production_collection_events WHERE client_event_id = v_client_event_id;
  IF FOUND THEN
    IF v_event.status = 'synced' THEN
      SELECT * INTO v_reading FROM public.production_stage_readings WHERE id = v_event.reading_id;
      SELECT * INTO v_item FROM public.production_lot_items WHERE id = v_reading.item_id;
      SELECT * INTO v_lot FROM public.production_lots WHERE id = v_reading.lot_id;
      SELECT * INTO v_route FROM public.production_routes WHERE lot_id = v_reading.lot_id AND step_name = v_reading.step_name LIMIT 1;
      SELECT * INTO v_next FROM public.production_routes WHERE lot_id = v_reading.lot_id AND required = true AND step_order > v_route.step_order ORDER BY step_order LIMIT 1;

      RETURN jsonb_build_object(
        'success', true,
        'status', 'approved',
        'message', 'Leitura aprovada (recuperada da fila).',
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_item),
        'route', to_jsonb(v_route),
        'reading', to_jsonb(v_reading),
        'nextStep', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END,
        'contextSummary', get_collection_context_summary(v_lot.id, null)
      );
    ELSIF v_event.status = 'error' THEN
      RETURN jsonb_build_object('success', false, 'status', 'error', 'message', v_event.error_message);
    ELSIF v_event.status = 'ignored' THEN
      RETURN jsonb_build_object('success', false, 'status', v_event.result_status, 'message', 'Leitura ignorada.');
    END IF;
  END IF;

  -- Registrar evento inicial como 'processing'
  INSERT INTO public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type,
    operator_id, operator_name, registration, cell_name, shift, date, hour,
    status, created_at_client, payload
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_operator_id, v_operator, v_registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload
  ) RETURNING * INTO v_event;

  -- 4. Validar tag vazia
  IF v_tag_value = '' THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'invalid', error_message = 'Identificação produtiva vazia.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'Informe uma identificação produtiva válida.');
  END IF;

  -- 5. Localizar tag
  SELECT * INTO v_tag FROM public.production_tags
  WHERE tag_value = v_tag_value AND active = true
  LIMIT 1;

  -- 6. Localizar item de lote correspondente
  IF FOUND AND v_tag.item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.production_lot_items WHERE id = v_tag.item_id FOR UPDATE;
  ELSE
    SELECT * INTO v_item FROM public.production_lot_items
    WHERE UPPER(item_code) = v_tag_value
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    SELECT pli.* INTO v_item
    FROM public.production_lot_items pli
    JOIN public.production_lots pl ON pl.id = pli.lot_id
    WHERE UPPER(pl.lot_code) = v_tag_value
      AND pli.status NOT IN ('completed','cancelled')
    ORDER BY pli.created_at ASC LIMIT 1 FOR UPDATE OF pli;
  END IF;

  IF v_item.id IS NULL THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'not_found', error_message = 'Tag, peça ou lote não localizado.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Tag, peça ou lote não localizado.');
  END IF;

  -- Preencher detalhes do item e do lote no evento do ledger
  UPDATE public.production_collection_events SET
    lot_id = v_item.lot_id,
    lot_code = v_item.lot_code,
    load_number = v_item.load_number,
    order_number = v_item.order_number,
    customer_name = v_item.customer_name,
    environment_name = v_item.environment_name,
    piece_code = v_item.item_code
  WHERE id = v_event.id;

  -- Se a tag não foi criada no banco, criar agora
  IF v_tag.id IS NULL THEN
    INSERT INTO public.production_tags (lot_id, item_id, tag_value, tag_type, tag_format, barcode_value)
    VALUES (v_item.lot_id, v_item.id, v_tag_value,
      CASE
        WHEN p_payload->>'detectedTagType' IN ('qrcode','datamatrix','rfid_epc','rfid_tid','manual') THEN p_payload->>'detectedTagType'
        ELSE 'barcode'
      END,
      CASE
        WHEN p_payload->>'detectedTagFormat' IN ('code128','code39','ean13','qrcode','datamatrix','epc96','custom') THEN p_payload->>'detectedTagFormat'
        ELSE 'custom'
      END,
      v_tag_value)
    ON CONFLICT (tag_value) DO UPDATE SET active = true
    RETURNING * INTO v_tag;
  END IF;

  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_item.lot_id FOR UPDATE;

  -- 7. Validar status da peça
  IF v_item.status IN ('rejected','blocked','scrap','cancelled') THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'blocked', error_message = 'Peça bloqueada ou reprovada.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'blocked', 'message', 'Peça bloqueada ou reprovada. Libere a ocorrência antes de avançar.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  IF v_item.status = 'completed' THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'completed', error_message = 'Peça já concluída.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'completed', 'message', 'Esta peça já concluiu toda a rota produtiva.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  -- 8. Resolver rota do lote considerando se a peça requer a etapa
  SELECT * INTO v_route FROM public.production_routes
  WHERE lot_id = v_item.lot_id
    AND required = true
    AND (step_name = v_item.current_step OR v_item.current_step IS NULL)
    AND piece_requires_step(v_item.source_lot_item_id, step_name) = true
  ORDER BY step_order LIMIT 1;

  IF v_route.id IS NULL THEN
    SELECT * INTO v_route FROM public.production_routes
    WHERE lot_id = v_item.lot_id
      AND required = true
      AND piece_requires_step(v_item.source_lot_item_id, step_name) = true
    ORDER BY step_order LIMIT 1;
  END IF;

  IF v_route.id IS NULL THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'route_missing', error_message = 'Rota do lote não configurada.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'route_missing', 'message', 'O lote não possui rota produtiva configurada.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  -- 9. Validar se a etapa é a correta
  IF v_step_input IS NOT NULL AND LOWER(v_step_input) <> LOWER(v_route.step_name) THEN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,
      v_station,v_step_input,v_cell,v_operator,auth.uid(),v_shift,v_date,v_hour,'blocked','wrong_step',v_quantity,
      'Etapa esperada: ' || v_route.step_name, v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_step_input, v_item.item_code
    ) RETURNING * INTO v_reading;

    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'wrong_step', reading_id = v_reading.id, processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object('success', false, 'status', 'wrong_step', 'message', 'Etapa incorreta. Etapa esperada: ' || v_route.step_name, 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  -- 10. Validar se a célula é a correta
  IF v_route.cell_name IS NOT NULL AND v_cell IS NOT NULL AND LOWER(v_route.cell_name) <> LOWER(v_cell) THEN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,
      v_station,v_route.step_name,v_cell,v_operator,auth.uid(),v_shift,v_date,v_hour,'blocked','wrong_step',v_quantity,
      'Célula esperada: ' || v_route.cell_name, v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_route.step_name, v_item.item_code
    ) RETURNING * INTO v_reading;

    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'wrong_cell', reading_id = v_reading.id, processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object('success', false, 'status', 'wrong_cell', 'message', 'Célula incorreta. Célula esperada: ' || v_route.cell_name, 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  -- 11. Janela anti-repetição de 3 segundos
  SELECT COUNT(*) INTO v_recent FROM public.production_stage_readings
  WHERE tag_id = v_tag.id AND created_at >= now() - interval '3 seconds';
  
  IF v_recent > 0 THEN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,v_station,v_route.step_name,v_cell,
      v_operator,auth.uid(),v_shift,v_date,v_hour,'duplicated','duplicated_scan',v_quantity,
      'Janela anti-repetição de 3 segundos', v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_route.step_name, v_item.item_code
    ) RETURNING * INTO v_reading;

    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'duplicated', reading_id = v_reading.id, processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Leitura repetida bloqueada.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  -- 12. Validar se a peça já concluiu esta etapa
  IF EXISTS (
    SELECT 1 FROM public.production_stage_readings
    WHERE item_id = v_item.id AND step_name = v_route.step_name AND status = 'approved'
  ) THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'duplicated', error_message = 'Peça já baixada nesta etapa.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Esta peça já foi baixada nesta etapa.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route));
  END IF;

  -- 13. Registrar leitura aprovada
  INSERT INTO public.production_stage_readings (
    lot_id,item_id,tag_id,tag_value,reader_type,reader_id,reader_name,station_id,station_name,
    step_name,cell_name,operator,user_id,shift,date,hour,status,event_type,quantity,notes,
    rssi,antenna_port,read_count,first_seen_at,last_seen_at,client_event_id,
    lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code
  ) VALUES (
    v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,NULLIF(p_payload->>'readerId','')::uuid,
    p_payload->>'readerName',p_payload->>'stationId',v_station,v_route.step_name,COALESCE(v_cell,v_route.cell_name),
    v_operator,auth.uid(),v_shift,v_date,v_hour,'approved',
    CASE WHEN v_reader_type = 'manual' THEN 'manual_adjustment' WHEN v_reader_type LIKE 'rfid_%' AND v_quantity > 1 THEN 'rfid_bulk_read' ELSE 'approved_scan' END,
    v_quantity,p_payload->>'notes',NULLIF(p_payload->>'rssi','')::numeric,NULLIF(p_payload->>'antennaPort','')::integer,
    COALESCE(NULLIF(p_payload->>'readCount','')::integer,1),NULLIF(p_payload->>'firstSeenAt','')::timestamptz,NULLIF(p_payload->>'lastSeenAt','')::timestamptz,
    v_client_event_id,
    v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_route.step_name, v_item.item_code
  ) RETURNING * INTO v_reading;

  -- 14. Encontrar próxima etapa necessária da peça
  SELECT * INTO v_next FROM public.production_routes
  WHERE lot_id = v_item.lot_id 
    AND required = true 
    AND step_order > v_route.step_order
    AND piece_requires_step(v_item.source_lot_item_id, step_name) = true
  ORDER BY step_order LIMIT 1;

  -- 15. Atualizar item
  UPDATE public.production_lot_items
  SET current_step = v_next.step_name,
      current_cell = v_next.cell_name,
      status = CASE WHEN v_next.id IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  -- 16. Atualizar progresso do lote
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total, v_completed
  FROM public.production_lot_items WHERE lot_id = v_lot.id;

  UPDATE public.production_lots
  SET progress_percent = CASE WHEN v_total > 0 THEN ROUND((v_completed::numeric / v_total::numeric) * 100, 2) ELSE 0 END,
      planned_quantity = CASE WHEN COALESCE(planned_quantity,0) = 0 THEN v_total ELSE planned_quantity END,
      current_status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'completed' ELSE 'in_progress' END,
      status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'shipped' ELSE 'in_progress' END,
      actual_end = CASE WHEN v_total > 0 AND v_completed = v_total THEN now() ELSE actual_end END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  -- 17. Inserir baixa produtiva na tabela production_entries
  INSERT INTO public.production_entries (
    date,shift,cell,hour,produced,target,scrap,downtime,operator,notes,created_by,client_event_id,
    operator_id, environment_name, operation_name
  ) VALUES (
    v_date,COALESCE(v_shift,'Não informado'),COALESCE(v_cell,v_route.cell_name,'Não informada'),v_hour,v_quantity,0,0,0,
    v_operator,'Coleta produtiva - tag ' || v_tag_value,auth.uid(),v_client_event_id,
    v_operator_id, v_item.environment_name, v_route.step_name
  ) RETURNING id INTO v_entry_id;

  -- 18. Registrar log de auditoria
  INSERT INTO public.traceability_logs (user_id,action,entity,entity_id,details)
  VALUES (auth.uid(),'approved_scan','production_lot_item',v_item.id,jsonb_build_object('tag',v_tag_value,'step',v_route.step_name,'cell',COALESCE(v_cell,v_route.cell_name),'reading_id',v_reading.id));

  -- 19. Sincronizar o evento no ledger
  UPDATE public.production_collection_events
  SET status = 'synced', result_status = 'approved', reading_id = v_reading.id, production_entry_id = v_entry_id, processed_at = now()
  WHERE id = v_event.id;

  -- 20. Montar resposta
  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'message', 'Leitura aprovada. Baixa produtiva registrada.',
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_item),
    'route', to_jsonb(v_route),
    'reading', to_jsonb(v_reading),
    'nextStep', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END,
    'contextSummary', get_collection_context_summary(v_lot.id, null)
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Sincronizar erro no ledger
  IF v_event.id IS NOT NULL THEN
    UPDATE public.production_collection_events
    SET status = 'error', error_message = SQLERRM, processed_at = now()
    WHERE id = v_event.id;
  END IF;
  RETURN jsonb_build_object('success', false, 'status', 'error', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION process_production_reading(jsonb) TO authenticated, anon;

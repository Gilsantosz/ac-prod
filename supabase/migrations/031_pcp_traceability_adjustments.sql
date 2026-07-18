-- ============================================================
-- AC.Prod MES — Fase: Ajustes e Rastreabilidade do Padrão PCP
-- Migration 031 — Implantação da Rastreabilidade e Ledger PCP
-- ============================================================

-- 1. CORREÇÃO DE STATUS DO LOTE (PERMITIR planned)
ALTER TABLE public.production_lots DROP CONSTRAINT IF EXISTS production_lots_status_check;
ALTER TABLE public.production_lots ADD CONSTRAINT production_lots_status_check CHECK (status IN (
  'planned', 'imported', 'in_separation', 'in_progress', 'pending', 'replacement', 'rework',
  'waiting_packaging', 'in_final_inspection', 'blocked_for_shipping', 'released_for_shipping',
  'closed', 'shipped', 'cancelled'
));

-- 2. HARMONIZAÇÃO DE STATUS DA PEÇA (REINCORPORAR rework)
ALTER TABLE public.production_pieces DROP CONSTRAINT IF EXISTS production_pieces_status_check;
ALTER TABLE public.production_pieces ADD CONSTRAINT production_pieces_status_check CHECK (status IN (
  'created', 'planned', 'in_progress', 'completed', 'blocked', 'rejected', 'rework',
  'rework_pending', 'rework_in_progress', 'rework_approved',
  'replacement_requested', 'replacement_in_production', 'replaced',
  'packed', 'inspected', 'ready_for_shipping', 'shipped', 'cancelled'
));

-- 3. AJUSTES EM production_stage_readings
ALTER TABLE public.production_stage_readings ADD COLUMN IF NOT EXISTS piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL;
ALTER TABLE public.production_stage_readings ALTER COLUMN event_type SET DEFAULT 'approved_scan';

-- 4. AJUSTES EM production_tags (piece_id E INDEX DE ATIVAS)
ALTER TABLE public.production_tags ADD COLUMN IF NOT EXISTS piece_id uuid REFERENCES public.production_pieces(id) ON DELETE CASCADE;

-- Remover a restrição global unique de tag_value para permitir tags históricas inativas
ALTER TABLE public.production_tags DROP CONSTRAINT IF EXISTS production_tags_tag_value_key;

-- Criar índice de unicidade apenas para tags ativas
DROP INDEX IF EXISTS public.idx_production_tags_active_tag_value;
CREATE UNIQUE INDEX idx_production_tags_active_tag_value ON public.production_tags(tag_value) WHERE active = true;

-- 5. PROCEDIMENTOS DE BACKFILL SEGURO
DO $$
DECLARE
  r record;
  v_lot_item_id uuid;
  v_piece_id uuid;
BEGIN
  -- Backfill production_stage_readings
  -- Caso 1: item_id contém incorretamente um production_pieces.id
  FOR r IN 
    SELECT sr.id AS r_id, sr.item_id AS r_item_id
    FROM public.production_stage_readings sr
    JOIN public.production_pieces p ON sr.item_id = p.id
  LOOP
    SELECT legacy_production_lot_item_id INTO v_lot_item_id
    FROM public.production_pieces WHERE id = r.r_item_id;
    
    UPDATE public.production_stage_readings
    SET piece_id = r.r_item_id,
        item_id = v_lot_item_id
    WHERE id = r.r_id;
  END LOOP;

  -- Caso 2: item_id contém production_lot_items.id mas piece_id é nulo
  FOR r IN 
    SELECT sr.id AS r_id, sr.item_id AS r_item_id
    FROM public.production_stage_readings sr
    JOIN public.production_lot_items pli ON sr.item_id = pli.id
    WHERE sr.piece_id IS NULL
  LOOP
    SELECT id INTO v_piece_id
    FROM public.production_pieces 
    WHERE legacy_production_lot_item_id = r.r_item_id
    LIMIT 1;
    
    IF v_piece_id IS NOT NULL THEN
      UPDATE public.production_stage_readings
      SET piece_id = v_piece_id
      WHERE id = r.r_id;
    END IF;
  END LOOP;

  -- Backfill production_tags
  -- Caso 1: item_id (production_lot_items) preenchido mas piece_id (production_pieces) nulo
  FOR r IN
    SELECT pt.id AS r_id, pt.item_id AS r_item_id
    FROM public.production_tags pt
    WHERE pt.item_id IS NOT NULL AND pt.piece_id IS NULL
  LOOP
    SELECT id INTO v_piece_id
    FROM public.production_pieces
    WHERE legacy_production_lot_item_id = r.r_item_id
    LIMIT 1;
    
    IF v_piece_id IS NOT NULL THEN
      UPDATE public.production_tags
      SET piece_id = v_piece_id
      WHERE id = r.r_id;
    END IF;
  END LOOP;

  -- Caso 2: piece_id preenchido mas item_id nulo (retrocompatibilidade)
  FOR r IN
    SELECT pt.id AS r_id, pt.piece_id AS r_piece_id
    FROM public.production_tags pt
    WHERE pt.piece_id IS NOT NULL AND pt.item_id IS NULL
  LOOP
    SELECT legacy_production_lot_item_id INTO v_lot_item_id
    FROM public.production_pieces
    WHERE id = r.r_piece_id;
    
    IF v_lot_item_id IS NOT NULL THEN
      UPDATE public.production_tags
      SET item_id = v_lot_item_id
      WHERE id = r.r_id;
    END IF;
  END LOOP;
END $$;

-- 6. TABELAS DE CONFIGURAÇÃO E LEDGER PCP
CREATE TABLE IF NOT EXISTS public.pcp_mapping_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name        text UNIQUE NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  columns_mapping     jsonb NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Pre-seed 'pcp_padrao_v1'
INSERT INTO public.pcp_mapping_profiles (profile_name, version, columns_mapping, is_active)
VALUES (
  'pcp_padrao_v1',
  1,
  '{
    "lotCode": 0,
    "orderCode": 1,
    "customer": 2,
    "projectName": 3,
    "environmentName": 4,
    "moduleName": 5,
    "pieceCode": 6,
    "pieceName": 7,
    "material": 8,
    "color": 9,
    "thickness": 10,
    "width": 11,
    "height": 12,
    "quantity": 13,
    "barcode": 14,
    "checkBarcode": 24,
    "route": 26
  }'::jsonb,
  true
) ON CONFLICT (profile_name) DO UPDATE
SET columns_mapping = EXCLUDED.columns_mapping, version = EXCLUDED.version;

CREATE TABLE IF NOT EXISTS public.pcp_import_rows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid NOT NULL REFERENCES public.promob_import_batches(id) ON DELETE CASCADE,
  row_number          integer NOT NULL,
  raw_cells           jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalized_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
  barcode_raw         text,
  barcode_normalized  text,
  validation_status   text NOT NULL,
  validation_errors   jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping_version     integer NOT NULL DEFAULT 1,
  row_hash            text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcp_import_rows_batch_id ON public.pcp_import_rows(batch_id);

-- Ativar RLS
ALTER TABLE public.pcp_mapping_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pcp_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pcp_mapping_profiles_select ON public.pcp_mapping_profiles;
CREATE POLICY pcp_mapping_profiles_select ON public.pcp_mapping_profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pcp_import_rows_select ON public.pcp_import_rows;
CREATE POLICY pcp_import_rows_select ON public.pcp_import_rows FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pcp_mapping_profiles_manage ON public.pcp_mapping_profiles;
CREATE POLICY pcp_mapping_profiles_manage ON public.pcp_mapping_profiles FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager')) WITH CHECK (get_my_role() IN ('admin', 'manager'));

DROP POLICY IF EXISTS pcp_import_rows_manage ON public.pcp_import_rows;
CREATE POLICY pcp_import_rows_manage ON public.pcp_import_rows FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager')) WITH CHECK (get_my_role() IN ('admin', 'manager'));

-- 7. REGISTRAR NOVAS ETAPAS DE ROTEIRO
INSERT INTO public.routing_steps (code, name, sequence) VALUES
  ('drill', 'Furação', 12),
  ('canal', 'Canal', 13),
  ('maranello', 'Maranello', 14),
  ('portajoias', 'Porta Joias', 15),
  ('sorrento', 'Sorrento', 16),
  ('usi_especial', 'Usi Especial', 17),
  ('rasgo_freggio', 'Rasgo Freggio', 18)
ON CONFLICT (code) DO NOTHING;

-- 8. RESTRINGIR ACESSO A EXCEÇÕES DE FLUXO (flow_exceptions)
DROP POLICY IF EXISTS flow_exceptions_manage ON public.flow_exceptions;
CREATE POLICY flow_exceptions_manage ON public.flow_exceptions FOR ALL TO authenticated
  USING (get_my_role() IN ('admin', 'manager')) WITH CHECK (get_my_role() IN ('admin', 'manager'));

-- 9. IMPEDIR GRAVAÇÃO DIRETA DE CONTADORES REALTIME
DROP POLICY IF EXISTS production_realtime_counters_all ON public.production_realtime_counters;

-- 10. ADICIONAR COLUNAS PCP AO HISTÓRICO DE BATCHES
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS source_format text;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS mapping_profile text;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS mapping_version integer;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS total_lines integer;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS valid_lines integer;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS empty_lines integer;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS duplicate_lines integer;
ALTER TABLE public.promob_import_batches ADD COLUMN IF NOT EXISTS error_details jsonb;


-- ============================================================
-- FUNÇÕES DE BANCO DE DADOS (RESOLVER & COLETOR PCP)
-- ============================================================

-- 11. RESOLVEDOR CANÔNICO DE PEÇA
CREATE OR REPLACE FUNCTION public.resolve_piece_by_identifier(p_identifier text)
RETURNS public.production_pieces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
  v_piece public.production_pieces;
  v_count integer;
BEGIN
  v_normalized := TRIM(p_identifier);
  
  IF v_normalized IS NULL OR v_normalized = '' THEN
    RAISE EXCEPTION 'Identificador vazio' USING ERRCODE = 'P0001';
  END IF;

  -- Busca por piece_uid, traceability_code ou tag_value ativa (case-insensitive fallback)
  WITH matches AS (
    SELECT id FROM public.production_pieces
    WHERE piece_uid = v_normalized OR traceability_code = v_normalized
       OR UPPER(piece_uid) = UPPER(v_normalized) OR UPPER(traceability_code) = UPPER(v_normalized)
    UNION
    SELECT piece_id FROM public.production_tags
    WHERE (tag_value = v_normalized OR UPPER(tag_value) = UPPER(v_normalized)) AND active = true AND piece_id IS NOT NULL
  )
  SELECT COUNT(*), (SELECT id FROM matches ORDER BY id LIMIT 1)
  INTO v_count, v_piece.id
  FROM matches;

  IF v_count = 0 THEN
    -- Verificar se existe de forma inativa nas tags
    SELECT COUNT(*) INTO v_count FROM public.production_tags
    WHERE (tag_value = v_normalized OR UPPER(tag_value) = UPPER(v_normalized)) AND active = false;
    
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Identificador % inativo no sistema', p_identifier USING ERRCODE = 'P0003';
    ELSE
      RAISE EXCEPTION 'Peça não localizada para o identificador %', p_identifier USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'Identificador % ambíguo (múltiplas peças encontradas)', p_identifier USING ERRCODE = 'P0004';
  END IF;

  -- Retorna a peça encontrada
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id;
  RETURN v_piece;
END;
$$;


-- 12. REDESENHO DE resolve_production_context
CREATE OR REPLACE FUNCTION public.resolve_production_context(p_input text, p_hint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v text := UPPER(TRIM(COALESCE(p_input,'')));
  h text := LOWER(TRIM(COALESCE(p_hint,'')));
  o production_orders%ROWTYPE;
  l production_lots%ROWTYPE;
  i production_order_items%ROWTYPE;
  li production_lot_items%ROWTYPE;
  r production_routes%ROWTYPE;
  t production_tags%ROWTYPE;
  v_piece production_pieces%ROWTYPE;
  matched text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('contextFound',false,'warnings',jsonb_build_array('Autenticacao obrigatoria.')); END IF;
  IF v = '' THEN RETURN jsonb_build_object('contextFound',false,'warnings',jsonb_build_array('Informe Pedido, Lote, Carga, Pallet ou etiqueta.')); END IF;
  
  IF h IN ('','tag','scanner','camera','rfid') THEN
    BEGIN
      -- Resolver via resolvedor canônico
      v_piece := public.resolve_piece_by_identifier(p_input);
      IF v_piece.id IS NOT NULL THEN
        SELECT * INTO l FROM production_lots WHERE id = v_piece.lot_id;
        SELECT * INTO li FROM production_lot_items WHERE id = v_piece.legacy_production_lot_item_id;
        matched := 'tag';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Fallback legada em caso de erro no resolvedor
      SELECT * INTO t FROM production_tags WHERE active AND UPPER(tag_value)=v LIMIT 1;
      IF t.id IS NOT NULL THEN
        SELECT * INTO l FROM production_lots WHERE id=t.lot_id;
        SELECT * INTO li FROM production_lot_items WHERE id=t.item_id;
        matched:='tag';
      END IF;
    END;
  END IF;
  
  IF l.id IS NULL AND h IN ('','lot','lote') THEN SELECT * INTO l FROM production_lots WHERE UPPER(lot_code)=v LIMIT 1; IF l.id IS NOT NULL THEN matched:='lot'; END IF; END IF;
  IF l.id IS NOT NULL THEN
    SELECT * INTO o FROM production_orders WHERE id=COALESCE(l.production_order_id,l.order_id);
    SELECT * INTO i FROM production_order_items WHERE lot_id=l.id AND (li.id IS NULL OR product_code=li.product_code OR product_name=li.product_name) ORDER BY created_at LIMIT 1;
  END IF;
  IF i.id IS NULL AND h IN ('','pallet','palete') THEN
    SELECT * INTO i FROM production_order_items WHERE UPPER(COALESCE(pallet_number,''))=v ORDER BY created_at DESC LIMIT 1;
    IF i.id IS NOT NULL THEN SELECT * INTO o FROM production_orders WHERE id=i.production_order_id; SELECT * INTO l FROM production_lots WHERE id=i.lot_id; matched:='pallet'; END IF;
  END IF;
  IF o.id IS NULL AND h IN ('','order','pedido') THEN
    SELECT * INTO o FROM production_orders WHERE UPPER(COALESCE(system_order_number,''))=v OR UPPER(COALESCE(customer_order_number,''))=v OR UPPER(COALESCE(order_number,''))=v OR UPPER(order_code)=v ORDER BY created_at DESC LIMIT 1;
    IF o.id IS NOT NULL THEN matched:='order'; END IF;
  END IF;
  IF o.id IS NULL AND h IN ('','load','carga') THEN SELECT * INTO o FROM production_orders WHERE UPPER(COALESCE(load_number,''))=v ORDER BY created_at DESC LIMIT 1; IF o.id IS NOT NULL THEN matched:='load'; END IF; END IF;
  IF o.id IS NULL AND h IN ('','product','produto') THEN
    SELECT * INTO i FROM production_order_items WHERE UPPER(COALESCE(product_code,''))=v OR UPPER(COALESCE(product_name,''))=v ORDER BY created_at DESC LIMIT 1;
    IF i.id IS NOT NULL THEN SELECT * INTO o FROM production_orders WHERE id=i.production_order_id; SELECT * INTO l FROM production_lots WHERE id=i.lot_id; matched:='product'; END IF;
  END IF;
  IF o.id IS NULL AND h IN ('','customer','cliente') THEN
    SELECT * INTO o FROM production_orders WHERE UPPER(COALESCE(customer_code,''))=v OR UPPER(COALESCE(customer_legal_name,''))=v OR UPPER(COALESCE(customer_trade_name,''))=v OR UPPER(customer_name)=v ORDER BY created_at DESC LIMIT 1;
    IF o.id IS NOT NULL THEN matched:='customer'; END IF;
  END IF;
  IF o.id IS NOT NULL AND l.id IS NULL THEN SELECT * INTO l FROM production_lots WHERE COALESCE(production_order_id,order_id)=o.id ORDER BY created_at DESC LIMIT 1; END IF;
  IF l.id IS NOT NULL AND i.id IS NULL THEN SELECT * INTO i FROM production_order_items WHERE lot_id=l.id ORDER BY created_at LIMIT 1; END IF;
  IF l.id IS NOT NULL THEN SELECT * INTO r FROM production_routes WHERE lot_id=l.id AND required AND status NOT IN ('completed','skipped') ORDER BY step_order LIMIT 1; END IF;
  
  RETURN jsonb_build_object(
    'productionOrder',CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o) END,
    'lot',CASE WHEN l.id IS NULL THEN NULL ELSE to_jsonb(l) END,
    'item',CASE WHEN i.id IS NULL THEN CASE WHEN li.id IS NULL THEN NULL ELSE to_jsonb(li) END ELSE to_jsonb(i) END,
    'route',CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END,
    'contextFound',o.id IS NOT NULL OR l.id IS NOT NULL OR i.id IS NOT NULL,
    'matchedBy',matched,
    'warnings',CASE WHEN o.id IS NULL AND l.id IS NULL AND i.id IS NULL THEN jsonb_build_array('Contexto produtivo nao localizado. Rastreabilidade limitada.') WHEN i.id IS NULL THEN jsonb_build_array('Contexto localizado sem item comercial vinculado.') ELSE '[]'::jsonb END
  );
END;
$$;


-- 13. REDESENHO DE process_production_reading
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

  -- IDEMPOTÊNCIA: Verificação por client_event_id antes do INSERT
  SELECT * INTO v_event FROM public.production_collection_events WHERE client_event_id = v_client_event_id;
  IF FOUND THEN
    IF v_event.status = 'synced' THEN
      SELECT * INTO v_reading FROM public.production_stage_readings WHERE id = v_event.reading_id;
      SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_reading.piece_id;
      SELECT * INTO v_lot FROM public.production_lots WHERE id = v_reading.lot_id;
      
      RETURN jsonb_build_object(
        'success', true,
        'status', 'approved',
        'alert_level', 'green',
        'message', 'Leitura já processada anteriormente (idempotência).',
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_piece),
        'reading', to_jsonb(v_reading)
      );
    ELSIF v_event.status = 'ignored' THEN
      BEGIN
        v_piece := public.resolve_piece_by_identifier(v_event.piece_code);
        SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
      EXCEPTION WHEN OTHERS THEN
        -- ignora erro de resolução no fallback de idempotência
      END;
      RETURN jsonb_build_object(
        'success', false,
        'status', v_event.result_status,
        'alert_level', CASE WHEN v_event.result_status = 'duplicated' THEN 'yellow' ELSE 'red' END,
        'message', COALESCE(v_event.error_message, 'Evento ignorado anteriormente.'),
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_piece)
      );
    ELSE
      RETURN jsonb_build_object('success', false, 'status', 'processing', 'message', 'Evento em processamento ou com erro.');
    END IF;
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

  -- 4. Localizar peça canônica pelo resolvedor único
  BEGIN
    v_piece := public.resolve_piece_by_identifier(v_tag_value);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'not_found', error_message = SQLERRM, processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', SQLERRM);
  END;

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
    WHERE piece_id = v_piece.id AND step_name = v_target_step_code AND status = 'approved'
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
      item_id, piece_id, lot_id, step_name, quantity, status, event_type, operator_id, machine_id
    ) VALUES (
      v_piece.piece_uid, 'barcode', v_reader_type, v_event.device_id, v_station, v_cell, v_operator, v_shift, v_date, v_hour,
      v_piece.legacy_production_lot_item_id, v_piece.id, v_piece.lot_id, v_target_step_code, v_quantity, 'approved', 'approved_scan', v_operator_id, v_machine_id
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


-- 14. REDESENHO DE scan_piece_to_volume
CREATE OR REPLACE FUNCTION public.scan_piece_to_volume(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_volume_id          uuid := (p_payload->>'volume_id')::uuid;
  v_barcode            text := p_payload->>'barcode';
  v_operator_id        uuid := (p_payload->>'operator_id')::uuid;
  v_device_id          text := p_payload->>'device_id';
  
  v_volume             public.packing_volumes%ROWTYPE;
  v_piece              public.production_pieces%ROWTYPE;
  v_already_packed     public.packing_volume_items%ROWTYPE;
  v_scan_id            uuid;
BEGIN
  -- Buscar volume
  SELECT * INTO v_volume FROM public.packing_volumes WHERE id = v_volume_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Volume não encontrado.');
  END IF;

  IF v_volume.status = 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não é possível adicionar peças a um volume já fechado.');
  END IF;

  -- Buscar peça pelo resolvedor canônico
  BEGIN
    v_piece := public.resolve_piece_by_identifier(v_barcode);
    IF v_piece.status = 'cancelled' THEN
      RAISE EXCEPTION 'Peça foi cancelada no sistema' USING ERRCODE = 'P0005';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, NULL, 'rejected', SQLERRM, v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  -- Bloquear peça de outro pedido/lote
  IF v_piece.lot_id <> v_volume.lot_id THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça pertence a outro lote produtiva.', v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Bloqueio: Peça pertence a outro lote produtiva.');
  END IF;

  -- Bloquear peça ainda não liberada para embalagem
  IF v_piece.current_stage IN ('Corte', 'Bordo', 'Usinagem', 'Marcenaria') AND v_piece.status <> 'completed' THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça ainda está na etapa ' || v_piece.current_stage, v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Peça não liberada para embalagem (ainda pendente em ' || v_piece.current_stage || ').');
  END IF;

  -- Bloquear peça já embalada em outro volume
  SELECT * INTO v_already_packed FROM public.packing_volume_items WHERE piece_id = v_piece.id;
  IF FOUND THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça já se encontra embalada em outro volume.', v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Peça já se encontra embalada em outro volume.');
  END IF;

  -- Inserir item no volume
  INSERT INTO public.packing_volume_items (volume_id, piece_id, traceability_code, scanned_by)
  VALUES (v_volume_id, v_piece.id, v_piece.traceability_code, auth.uid());

  -- Registrar scan de sucesso
  INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, operator_id, device_id)
  VALUES (volume_id, piece_id, 'approved', operator_id, device_id);

  -- Atualizar estágio da peça
  UPDATE public.production_pieces 
  SET current_stage = 'Embalagem', status = 'in_progress'
  WHERE id = v_piece.id;

  -- Registrar evento
  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'pack', v_piece.current_stage, 'Embalagem', 'accepted'
  );

  RETURN jsonb_build_object('success', true, 'piece_id', v_piece.id, 'piece_name', v_piece.piece_name);
END;
$$;


-- 15. REDESENHO DE scan_shipment_item
CREATE OR REPLACE FUNCTION public.scan_shipment_item(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shipment_id        uuid := (p_payload->>'shipment_id')::uuid;
  v_barcode            text := p_payload->>'barcode';
  v_operator_id        uuid := (p_payload->>'operator_id')::uuid;
  v_device_id          text := p_payload->>'device_id';
  
  v_shipment           public.shipments%ROWTYPE;
  v_volume             public.packing_volumes%ROWTYPE;
  v_piece              public.production_pieces%ROWTYPE;
  v_checklist_item     public.shipment_items%ROWTYPE;
  v_is_volume          boolean := false;
BEGIN
  -- Buscar remessa
  SELECT * INTO v_shipment FROM public.shipments WHERE id = v_shipment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Expedição/Remessa não encontrada.');
  END IF;

  IF v_shipment.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Remessa não está pendente para bipagem.');
  END IF;

  -- Tentar localizar volume
  SELECT * INTO v_volume FROM public.packing_volumes WHERE UPPER(volume_code) = UPPER(TRIM(v_barcode));
  IF FOUND THEN
    v_is_volume := true;
  ELSE
    -- Tentar localizar peça pelo resolvedor canônico
    BEGIN
      v_piece := public.resolve_piece_by_identifier(v_barcode);
      IF v_piece.status = 'cancelled' THEN
        v_piece.id := NULL; -- Tratado como não localizado se cancelado
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_piece.id := NULL;
    END;
  END IF;

  IF v_volume.id IS NULL AND v_piece.id IS NULL THEN
    INSERT INTO public.shipment_scans (shipment_id, piece_id, volume_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
    VALUES (v_shipment_id, NULL, NULL, v_barcode, 'rejected', 'Código desconhecido', v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Código não identificado como peça ou volume.');
  END IF;

  -- Se for volume
  IF v_is_volume THEN
    IF v_volume.lot_id <> v_shipment.lot_id THEN
      INSERT INTO public.shipment_scans (shipment_id, piece_id, volume_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
      VALUES (v_shipment_id, NULL, v_volume.id, v_barcode, 'rejected', 'Volume pertence a outro lote', v_operator_id, v_device_id);
      
      RETURN jsonb_build_object('success', false, 'error', 'Volume pertence a outro lote produtiva.');
    END IF;

    IF v_volume.status <> 'closed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Volume não está fechado na embalagem.');
    END IF;

    -- Verificar checklist de expedição
    SELECT * INTO v_checklist_item FROM public.shipment_items 
    WHERE shipment_id = v_shipment_id AND volume_id = v_volume.id;

    IF NOT FOUND THEN
      INSERT INTO public.shipment_items (shipment_id, expected_type, volume_id, traceability_code, status, scanned_at, scanned_by)
      VALUES (v_shipment_id, 'volume', v_volume.id, v_volume.volume_code, 'scanned', now(), auth.uid())
      RETURNING * INTO v_checklist_item;
    ELSE
      UPDATE public.shipment_items 
      SET status = 'scanned', scanned_at = now(), scanned_by = auth.uid()
      WHERE id = v_checklist_item.id
      RETURNING * INTO v_checklist_item;
    END IF;

    INSERT INTO public.shipment_scans (shipment_id, volume_id, barcode_raw_value, scan_result, operator_id, device_id)
    VALUES (v_shipment_id, v_volume.id, v_barcode, 'approved', v_operator_id, v_device_id);

    -- Atualizar as peças deste volume para shipped e gravar evento
    UPDATE public.production_pieces 
    SET current_stage = 'Expedição', status = 'completed'
    WHERE id IN (SELECT piece_id FROM public.packing_volume_items WHERE volume_id = v_volume.id);

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id,
      event_type, from_stage, to_stage, event_status
    )
    SELECT piece_id, traceability_code, v_shipment.order_id, v_shipment.lot_id,
      'ship', 'Embalagem', 'Expedição', 'accepted'
    FROM public.packing_volume_items WHERE volume_id = v_volume.id;

    RETURN jsonb_build_object('success', true, 'type', 'volume', 'id', v_volume.id, 'code', v_volume.volume_code);
  END IF;

  -- Se for peça avulsa
  IF v_piece.lot_id <> v_shipment.lot_id THEN
    INSERT INTO public.shipment_scans (shipment_id, piece_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
    VALUES (v_shipment_id, v_piece.id, v_barcode, 'rejected', 'Peça pertence a outro lote', v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Peça pertence a outro lote produtiva.');
  END IF;

  -- Verificar se já foi embalada em algum volume
  IF EXISTS (SELECT 1 FROM public.packing_volume_items WHERE piece_id = v_piece.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Esta peça pertence a um volume fechado. Bipe a etiqueta do volume.');
  END IF;

  -- Verificar checklist de expedição
  SELECT * INTO v_checklist_item FROM public.shipment_items 
  WHERE shipment_id = v_shipment_id AND piece_id = v_piece.id;

  IF NOT FOUND THEN
    INSERT INTO public.shipment_items (shipment_id, expected_type, piece_id, traceability_code, status, scanned_at, scanned_by)
    VALUES (v_shipment_id, 'piece', v_piece.id, v_piece.traceability_code, 'scanned', now(), auth.uid())
    RETURNING * INTO v_checklist_item;
  ELSE
    UPDATE public.shipment_items 
    SET status = 'scanned', scanned_at = now(), scanned_by = auth.uid()
    WHERE id = v_checklist_item.id
    RETURNING * INTO v_checklist_item;
  END IF;

  INSERT INTO public.shipment_scans (shipment_id, piece_id, barcode_raw_value, scan_result, operator_id, device_id)
  VALUES (v_shipment_id, v_piece.id, v_barcode, 'approved', v_operator_id, v_device_id);

  UPDATE public.production_pieces 
  SET current_stage = 'Expedição', status = 'completed'
  WHERE id = v_piece.id;

  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'ship', v_piece.current_stage, 'Expedição', 'accepted'
  );

  RETURN jsonb_build_object('success', true, 'type', 'piece', 'id', v_piece.id, 'name', v_piece.piece_name);
END;
$$;


-- ============================================================
-- MOTOR E PARSER DE IMPORTAÇÃO PCP TRANSAcional
-- ============================================================

-- 16. PARSER DE TOKENS DE ROTA
CREATE OR REPLACE FUNCTION public.parse_pcp_route_tokens(p_route_text text)
RETURNS text[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_route_clean text;
  v_tokens text[];
  v_token text;
  v_stages text[] := '{}'::text[];
  v_ordered text[] := ARRAY['cut', 'edge', 'drill', 'cnc', 'canal', 'maranello', 'portajoias', 'sorrento', 'usi_especial', 'rasgo_freggio', 'joinery', 'separation', 'packaging'];
  v_result text[] := '{}'::text[];
  v_stage text;
BEGIN
  -- Normaliza tokens compostos antes do split
  v_route_clean := UPPER(COALESCE(p_route_text, ''));
  v_route_clean := REPLACE(v_route_clean, 'USI ESPECIAL', 'USIESPECIAL');
  v_route_clean := REPLACE(v_route_clean, 'PORTA JOIAS', 'PORTAJOIAS');
  v_route_clean := REPLACE(v_route_clean, 'RASGO FREGGIO', 'RASGOFREGGIO');

  -- Divide o texto por delimitadores comuns
  v_tokens := regexp_split_to_array(v_route_clean, '[\s,;/+\-]+');
  
  FOREACH v_token IN ARRAY v_tokens LOOP
    v_token := TRIM(v_token);
    IF v_token = 'CORTAR' OR v_token = 'CORTE' THEN
      v_stages := array_append(v_stages, 'cut');
    ELSIF v_token = 'BORDEAR' OR v_token = 'BORDO' OR v_token = 'BORDA' OR v_token = 'EDGE' THEN
      v_stages := array_append(v_stages, 'edge');
    ELSIF v_token = 'FURAR' OR v_token = 'FURAÇÃO' OR v_token = 'DRILL' THEN
      v_stages := array_append(v_stages, 'drill');
    ELSIF v_token = 'USINAGEM' OR v_token = 'CNC' OR v_token = 'USINAR' THEN
      v_stages := array_append(v_stages, 'cnc');
    ELSIF v_token = 'CANAL' THEN
      v_stages := array_append(v_stages, 'canal');
    ELSIF v_token = 'MARANELLO' THEN
      v_stages := array_append(v_stages, 'maranello');
    ELSIF v_token = 'PORTAJOIAS' THEN
      v_stages := array_append(v_stages, 'portajoias');
    ELSIF v_token = 'SORRENTO' THEN
      v_stages := array_append(v_stages, 'sorrento');
    ELSIF v_token = 'USIESPECIAL' THEN
      v_stages := array_append(v_stages, 'usi_especial');
    ELSIF v_token = 'RASGOFREGGIO' THEN
      v_stages := array_append(v_stages, 'rasgo_freggio');
    ELSIF v_token = 'MARCENARIA' OR v_token = 'JOINERY' THEN
      v_stages := array_append(v_stages, 'joinery');
    END IF;
  END LOOP;

  -- Garante Separação e Embalagem ao final de todas as rotas
  v_stages := array_append(v_stages, 'separation');
  v_stages := array_append(v_stages, 'packaging');

  -- Ordena de forma determinística canônica e remove duplicados
  FOREACH v_stage IN ARRAY v_ordered LOOP
    IF v_stage = ANY(v_stages) THEN
      v_result := array_append(v_result, v_stage);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;


-- 17. EXECUÇÃO DA TRANSAÇÃO DO PCP IMPORT ENGINE
CREATE OR REPLACE FUNCTION public.commit_pcp_import(
  p_batch_id           uuid,
  p_order_code         text,
  p_lot_code           text,
  p_customer           text,
  p_project_name       text,
  p_mapping_profile    text,
  p_mapping_version    integer,
  p_rows               jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_lot_id uuid;
  v_row jsonb;
  v_piece_id uuid;
  v_lot_item_id uuid;
  v_route_steps text[];
  v_current_user uuid := auth.uid();
  v_barcode text;
  v_check_barcode text;
  v_route text;
  v_piece_code text;
  v_piece_name text;
  v_quantity integer;
  v_material text;
  v_color text;
  v_thickness numeric;
  v_width numeric;
  v_height numeric;
  v_environment text;
  v_module text;
  
  v_inserted_pieces integer := 0;
  v_inserted_items integer := 0;
BEGIN
  -- Validar lote de importação
  IF NOT EXISTS (SELECT 1 FROM public.promob_import_batches WHERE id = p_batch_id) THEN
    RAISE EXCEPTION 'Lote de importação % não localizado', p_batch_id USING ERRCODE = 'P0008';
  END IF;

  -- 1. Resolver/Criar Pedido de Produção
  SELECT id INTO v_order_id FROM public.production_orders WHERE UPPER(order_code) = UPPER(p_order_code) LIMIT 1;
  IF v_order_id IS NULL THEN
    INSERT INTO public.production_orders (
      order_code, system_order_number, customer_name, project_name, status, created_by
    ) VALUES (
      p_order_code, p_order_code, p_customer, p_project_name, 'planned', v_current_user
    ) RETURNING id INTO v_order_id;
  END IF;

  -- 2. Resolver/Criar Lote de Produção (status: planned)
  SELECT id INTO v_lot_id FROM public.production_lots WHERE UPPER(lot_code) = UPPER(p_lot_code) LIMIT 1;
  IF v_lot_id IS NULL THEN
    INSERT INTO public.production_lots (
      lot_code, order_id, production_order_id, status, created_by
    ) VALUES (
      p_lot_code, v_order_id, v_order_id, 'planned', v_current_user
    ) RETURNING id INTO v_lot_id;
  ELSE
    UPDATE public.production_lots SET status = 'planned' WHERE id = v_lot_id;
  END IF;

  -- 3. Inserir peças e logs
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_barcode := TRIM(v_row->>'barcode');
    v_check_barcode := TRIM(v_row->>'checkBarcode');
    v_route := TRIM(v_row->>'route');
    v_piece_code := TRIM(v_row->>'pieceCode');
    v_piece_name := COALESCE(TRIM(v_row->>'pieceName'), 'Sem Nome');
    v_quantity := GREATEST(COALESCE((v_row->>'quantity')::integer, 1), 1);
    v_material := TRIM(v_row->>'material');
    v_color := TRIM(v_row->>'color');
    v_thickness := (v_row->>'thickness')::numeric;
    v_width := (v_row->>'width')::numeric;
    v_height := (v_row->>'height')::numeric;
    v_environment := TRIM(v_row->>'environmentName');
    v_module := TRIM(v_row->>'moduleName');

    IF v_barcode IS NULL OR v_barcode = '' THEN
      CONTINUE;
    END IF;

    -- Roteamento
    v_route_steps := public.parse_pcp_route_tokens(v_route);

    -- Importação de rastreabilidade unitária (1 registro por unidade de quantidade)
    FOR i IN 1..v_quantity LOOP
      DECLARE
        v_suffix text := CASE WHEN v_quantity > 1 THEN '-' || i::text ELSE '' END;
        v_piece_uid text := v_barcode || v_suffix;
        v_traceability text := v_barcode || v_suffix;
      BEGIN
        -- Inserção no ledger pcp_import_rows
        INSERT INTO public.pcp_import_rows (
          batch_id, row_number, raw_cells, normalized_payload, barcode_raw, barcode_normalized,
          validation_status, mapping_version, row_hash
        ) VALUES (
          p_batch_id, (v_row->>'row_number')::integer, v_row->'raw_cells', v_row, v_barcode, v_barcode,
          'valid', p_mapping_version, md5(v_row::text)
        );

        -- Inserção de compatibilidade (production_lot_items)
        INSERT INTO public.production_lot_items (
          lot_id, product_code, product_name, quantity, status, current_step,
          material, color, width, height, thickness, created_by
        ) VALUES (
          v_lot_id, v_piece_code, v_piece_name, 1, 'planned', 'Importado',
          v_material, v_color, v_width, v_height, v_thickness, v_current_user
        ) RETURNING id INTO v_lot_item_id;
        
        v_inserted_items := v_inserted_items + 1;

        -- Inserção de peças reais (production_pieces)
        INSERT INTO public.production_pieces (
          piece_uid, traceability_code, production_order_id, lot_id,
          module_name, environment, piece_name, material, color,
          thickness, width, height, length,
          current_stage, status, source_origin,
          legacy_production_lot_item_id, route_steps, created_by
        ) VALUES (
          v_piece_uid, v_traceability, v_order_id, v_lot_id,
          v_module, v_environment, v_piece_name, v_material, v_color,
          v_thickness, v_width, v_height, v_height,
          v_route_steps[1], 'planned', 'xlsx',
          v_lot_item_id, v_route_steps, v_current_user
        ) RETURNING id INTO v_piece_id;

        v_inserted_pieces := v_inserted_pieces + 1;

        -- Inserir tag de rastreabilidade
        INSERT INTO public.production_tags (
          lot_id, item_id, piece_id, tag_value, active, created_by
        ) VALUES (
          v_lot_id, v_lot_item_id, v_piece_id, v_piece_uid, true, v_current_user
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao inserir peça % no lote %: %', v_piece_uid, p_lot_code, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  -- 4. Atualizar cabeçalho do Batch com status compatível ('processed')
  UPDATE public.promob_import_batches SET
    status = 'processed',
    imported_at = now(),
    customer_name = p_customer,
    promob_project_name = p_project_name,
    order_code = p_order_code,
    total_parts = v_inserted_pieces,
    source_format = p_mapping_profile,
    mapping_profile = p_mapping_profile,
    mapping_version = p_mapping_version,
    total_lines = jsonb_array_length(p_rows),
    valid_lines = v_inserted_pieces,
    empty_lines = 0,
    duplicate_lines = 0
  WHERE id = p_batch_id;

  -- 5. Registrar histórico auditável
  INSERT INTO public.pcp_import_logs (
    import_file_id, user_id, action, message, severity, metadata_json
  ) VALUES (
    p_batch_id, v_current_user, 'PCP_IMPORT',
    'Importação PCP finalizada com sucesso. Lote: ' || p_lot_code || '. ' || v_inserted_pieces || ' peças criadas.',
    'info',
    jsonb_build_object(
      'order_code', p_order_code,
      'lot_code', p_lot_code,
      'pieces_created', v_inserted_pieces,
      'items_created', v_inserted_items
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'pieces_created', v_inserted_pieces,
    'lot_id', v_lot_id,
    'order_id', v_order_id
  );
END;
$$;

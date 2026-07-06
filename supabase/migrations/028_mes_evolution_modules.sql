-- ============================================================
-- AC.Prod MES — Fase 4-8: Módulos de Embalagem, Expedição, Retrabalho e Pontes
-- Migration 028 — Evolução para MES robusto
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ESTRUTURA DE EMBALAGEM
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.packing_volumes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volume_code         text NOT NULL UNIQUE,
  production_order_id uuid REFERENCES public.production_orders(id) ON DELETE CASCADE,
  lot_id              uuid REFERENCES public.production_lots(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz
);

CREATE TABLE IF NOT EXISTS public.packing_volume_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volume_id           uuid NOT NULL REFERENCES public.packing_volumes(id) ON DELETE CASCADE,
  piece_id            uuid NOT NULL REFERENCES public.production_pieces(id) ON DELETE CASCADE,
  traceability_code   text NOT NULL,
  scanned_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scanned_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (volume_id, piece_id)
);

CREATE TABLE IF NOT EXISTS public.packing_scans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volume_id           uuid REFERENCES public.packing_volumes(id) ON DELETE CASCADE,
  piece_id            uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  scan_result         text NOT NULL, -- 'approved', 'rejected'
  error_reason        text,
  operator_id         uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  device_id           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS para Embalagem
ALTER TABLE public.packing_volumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packing_volume_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packing_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packing_volumes_select" ON public.packing_volumes FOR SELECT TO authenticated USING (true);
CREATE POLICY "packing_volume_items_select" ON public.packing_volume_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "packing_scans_select" ON public.packing_scans FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- 2. ESTRUTURA DE EXPEDIÇÃO
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shipment_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id         uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  expected_type       text NOT NULL CHECK (expected_type IN ('piece', 'volume')),
  piece_id            uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  volume_id           uuid REFERENCES public.packing_volumes(id) ON DELETE SET NULL,
  traceability_code   text NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scanned', 'exception')),
  scanned_at          timestamptz,
  scanned_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (shipment_id, piece_id),
  UNIQUE (shipment_id, volume_id)
);

CREATE TABLE IF NOT EXISTS public.shipment_scans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id         uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  piece_id            uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  volume_id           uuid REFERENCES public.packing_volumes(id) ON DELETE SET NULL,
  barcode_raw_value   text NOT NULL,
  scan_result         text NOT NULL, -- 'approved', 'rejected'
  error_reason        text,
  operator_id         uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  device_id           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shipment_exceptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id         uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  piece_id            uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  volume_id           uuid REFERENCES public.packing_volumes(id) ON DELETE SET NULL,
  reason              text NOT NULL,
  approved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS para Expedição
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipment_items_select" ON public.shipment_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "shipment_scans_select" ON public.shipment_scans FOR SELECT TO authenticated USING (true);
CREATE POLICY "shipment_exceptions_select" ON public.shipment_exceptions FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- 3. ESTRUTURA DE RETRABALHO
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rework_reasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  description text NOT NULL,
  active      boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.rework_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_piece_id    uuid NOT NULL REFERENCES public.production_pieces(id) ON DELETE CASCADE,
  replacement_piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  reason_id            uuid NOT NULL REFERENCES public.rework_reasons(id) ON DELETE RESTRICT,
  reported_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_at          timestamptz NOT NULL DEFAULT now(),
  stage_at_damage      text NOT NULL,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  notes                text
);

-- RLS para Retrabalho
ALTER TABLE public.rework_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rework_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rework_reasons_select" ON public.rework_reasons FOR SELECT TO authenticated USING (true);
CREATE POLICY "rework_orders_select" ON public.rework_orders FOR SELECT TO authenticated USING (true);

-- Seed de Motivos Padrão de Retrabalho
INSERT INTO public.rework_reasons (code, description) VALUES
  ('mdf_riscado', 'MDF riscado'),
  ('peca_lascada', 'Peça lascada'),
  ('erro_corte', 'Erro de corte'),
  ('erro_medida', 'Erro de medida'),
  ('erro_furacao', 'Erro de furação'),
  ('erro_cnc', 'Erro de CNC'),
  ('borda_descolada', 'Borda descolada'),
  ('borda_errada', 'Borda errada'),
  ('peca_quebrada', 'Peça quebrada'),
  ('peca_perdida', 'Peça perdida'),
  ('falha_pintura', 'Falha de pintura'),
  ('falha_montagem', 'Falha de montagem'),
  ('gestor_solicitou', 'Retrabalho solicitado pelo gestor'),
  ('outro', 'Outro')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. PONTES DE COMPATIBILIDADE DE PIECES E EVENTS (FASE 4)
-- ─────────────────────────────────────────────────────────────

-- Trigger para sincronizar production_lot_items para production_pieces
CREATE OR REPLACE FUNCTION sync_production_lot_item_to_piece()
RETURNS trigger AS $$
DECLARE
  v_lot_item record;
  v_piece_id uuid;
  v_uid text;
  v_tcode text;
  v_order_id uuid;
BEGIN
  -- Obter order_id correspondente ao lote
  SELECT production_order_id INTO v_order_id FROM public.production_lots WHERE id = NEW.lot_id;
  
  -- Se o source_lot_item_id estiver presente, buscar dados em lot_items
  IF NEW.source_lot_item_id IS NOT NULL THEN
    SELECT * INTO v_lot_item FROM public.lot_items WHERE id = NEW.source_lot_item_id;
  END IF;

  -- Gerar UID e código de rastreabilidade
  v_uid := 'PC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 6));
  -- Usar item_code como traceability_code para compatibilidade com as etiquetas existentes
  v_tcode := COALESCE(NEW.item_code, replace(v_uid, 'PC-', ''));

  -- Verificar se já existe uma production_piece para este production_lot_item
  SELECT id INTO v_piece_id FROM public.production_pieces 
  WHERE legacy_production_lot_item_id = NEW.id;

  IF v_piece_id IS NULL THEN
    -- Inserir nova peça canônica
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
      legacy_lot_item_id,
      legacy_production_lot_item_id,
      created_at
    ) VALUES (
      v_uid,
      v_tcode,
      COALESCE(v_order_id, (SELECT order_id FROM public.production_lots WHERE id = NEW.lot_id)),
      NEW.lot_id,
      NULL,
      COALESCE(NEW.environment_name, v_lot_item.environment),
      COALESCE(NEW.product_name, v_lot_item.piece_name, 'Peça sem nome'),
      v_lot_item.description,
      v_lot_item.material,
      v_lot_item.color,
      COALESCE(v_lot_item.thickness, 0),
      COALESCE(v_lot_item.width, 0),
      COALESCE(v_lot_item.height, 0),
      COALESCE(v_lot_item.length, 0),
      v_lot_item.edge_front,
      v_lot_item.edge_back,
      v_lot_item.edge_left,
      v_lot_item.edge_right,
      COALESCE(v_lot_item.requires_cut, true),
      COALESCE(v_lot_item.requires_edge, false),
      COALESCE(v_lot_item.requires_cnc, false),
      COALESCE(v_lot_item.requires_joinery, false),
      COALESCE(v_lot_item.requires_separation, true),
      COALESCE(v_lot_item.requires_packaging, true),
      NEW.current_step,
      CASE 
        WHEN NEW.status = 'completed' THEN 'completed'
        WHEN NEW.status = 'cancelled' THEN 'cancelled'
        WHEN NEW.status = 'rework' THEN 'rework'
        ELSE 'planned'
      END,
      CASE WHEN NEW.source_lot_item_id IS NOT NULL THEN 'promob_xml'::text ELSE 'manual'::text END,
      NEW.source_lot_item_id,
      NEW.id,
      NEW.created_at
    ) RETURNING id INTO v_piece_id;

    -- Registrar evento inicial
    INSERT INTO public.production_events (
      piece_id,
      traceability_code,
      production_order_id,
      lot_id,
      event_type,
      from_stage,
      to_stage,
      event_status,
      created_at
    ) VALUES (
      v_piece_id,
      v_tcode,
      v_order_id,
      NEW.lot_id,
      'reading',
      NULL,
      NEW.current_step,
      'accepted',
      NEW.created_at
    );
  ELSE
    -- Atualizar peça existente
    UPDATE public.production_pieces SET
      current_stage = NEW.current_step,
      status = CASE 
        WHEN NEW.status = 'completed' THEN 'completed'
        WHEN NEW.status = 'cancelled' THEN 'cancelled'
        WHEN NEW.status = 'rework' THEN 'rework'
        ELSE 'in_progress'
      END,
      updated_at = now()
    WHERE id = v_piece_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_production_lot_item_to_piece ON public.production_lot_items;
CREATE TRIGGER trg_sync_production_lot_item_to_piece
  AFTER INSERT OR UPDATE ON public.production_lot_items
  FOR EACH ROW EXECUTE FUNCTION sync_production_lot_item_to_piece();

-- Trigger para sincronizar readings legadas em production_events
CREATE OR REPLACE FUNCTION sync_reading_to_event()
RETURNS trigger AS $$
DECLARE
  v_piece_id uuid;
  v_tcode text;
BEGIN
  SELECT id, traceability_code INTO v_piece_id, v_tcode
  FROM public.production_pieces
  WHERE legacy_production_lot_item_id = NEW.item_id;

  IF v_piece_id IS NOT NULL THEN
    INSERT INTO public.production_events (
      piece_id,
      traceability_code,
      production_order_id,
      lot_id,
      event_type,
      from_stage,
      to_stage,
      cell_name,
      device_id,
      operator_id,
      event_status,
      reading_source,
      barcode_raw_value,
      notes,
      legacy_stage_reading_id,
      created_at
    ) VALUES (
      v_piece_id,
      v_tcode,
      NEW.production_order_id,
      NEW.lot_id,
      'stage_advance',
      NULL,
      NEW.step_name,
      NEW.cell_name,
      NEW.reader_id,
      NEW.operator_id,
      CASE WHEN NEW.status = 'approved' THEN 'accepted' ELSE 'rejected' END,
      NEW.reader_type,
      NEW.tag_value,
      'Sincronizado via leitura legada',
      NEW.id,
      NEW.created_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reading_to_event ON public.production_stage_readings;
CREATE TRIGGER trg_sync_reading_to_event
  AFTER INSERT ON public.production_stage_readings
  FOR EACH ROW EXECUTE FUNCTION sync_reading_to_event();

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: update_production_lot_status_safely (FASE 3)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_production_lot_status_safely(p_lot_id uuid, p_new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lot record;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_lot FROM public.production_lots WHERE id = p_lot_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lote não localizado.');
  END IF;

  IF p_new_status = v_lot.status THEN
    RETURN jsonb_build_object('success', true, 'message', 'Status já atualizado.');
  END IF;

  -- Validar transições seguras
  IF p_new_status = 'in_progress' THEN
    v_allowed := true;
  ELSIF p_new_status = 'ready_to_pack' OR p_new_status = 'waiting_packaging' THEN
    v_allowed := true;
  ELSIF p_new_status = 'packed' OR p_new_status = 'waiting_shipping' THEN
    v_allowed := true;
  ELSIF p_new_status = 'shipped' THEN
    v_allowed := true; -- Validado na expedição
  ELSIF p_new_status = 'cancelled' THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transição de status inválida para ' || p_new_status);
  END IF;

  UPDATE public.production_lots
  SET status = p_new_status,
      updated_at = now()
  WHERE id = p_lot_id;

  -- Se for shipped, atualizar também o production_orders associado se todos os lotes dele estiverem shipped
  IF p_new_status = 'shipped' THEN
    UPDATE public.production_lots SET actual_end = now() WHERE id = p_lot_id;
    IF v_lot.production_order_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.production_lots 
        WHERE production_order_id = v_lot.production_order_id AND status <> 'shipped'
      ) THEN
        UPDATE public.production_orders 
        SET status = 'shipped', finalization_date = now()::date 
        WHERE id = v_lot.production_order_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_status', p_new_status);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: scan_piece_to_volume (FASE 7)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scan_piece_to_volume(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_volume_id          uuid := (p_payload->>'volume_id')::uuid;
  v_barcode            text := UPPER(TRIM(p_payload->>'barcode'));
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

  -- Buscar peça pelo código de rastreabilidade ou UID
  SELECT * INTO v_piece FROM public.production_pieces 
  WHERE (UPPER(traceability_code) = v_barcode OR UPPER(piece_uid) = v_barcode)
    AND status <> 'cancelled';

  IF NOT FOUND THEN
    -- Registrar log de erro
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, NULL, 'rejected', 'Peça não localizada no sistema: ' || v_barcode, v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Peça não localizada no sistema.');
  END IF;

  -- Bloquear peça de outro pedido/lote
  IF v_piece.lot_id <> v_volume.lot_id THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça pertence ao lote ' || v_piece.lot_id || ', mas o volume pertence ao lote ' || v_volume.lot_id, v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Bloqueio: Peça pertence a outro lote produtiva.');
  END IF;

  -- Bloquear peça ainda não liberada para embalagem (deve ter concluído etapas anteriores como usinagem/marcenaria)
  -- Para marcenaria sob medida, marcenaria/separação concluída é o critério
  -- Mas se requires_joinery for false, exige separação
  -- Por simplicidade e segurança, a peça deve ter concluído as etapas produtivas anteriores e estar em separação ou concluída
  IF v_piece.current_stage IN ('Corte', 'Bordo', 'Usinagem', 'Marcenaria') AND v_piece.status <> 'completed' THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça ainda está na etapa ' || v_piece.current_stage, v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Peça não liberada para embalagem (ainda pendente em ' || v_piece.current_stage || ').');
  END IF;

  -- Bloquear peça já embalada em outro volume
  SELECT * INTO v_already_packed FROM public.packing_volume_items WHERE piece_id = v_piece.id;
  IF FOUND THEN
    INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
    VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça já embalada no volume ' || v_already_packed.volume_id, v_operator_id, v_device_id);
    
    RETURN jsonb_build_object('success', false, 'error', 'Peça já se encontra embalada em outro volume.');
  END IF;

  -- Inserir item no volume
  INSERT INTO public.packing_volume_items (volume_id, piece_id, traceability_code, scanned_by)
  VALUES (v_volume_id, v_piece.id, v_piece.traceability_code, auth.uid());

  -- Registrar scan de sucesso
  INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, operator_id, device_id)
  VALUES (v_volume_id, v_piece.id, 'approved', v_operator_id, v_device_id);

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

-- ─────────────────────────────────────────────────────────────
-- 7. RPC: scan_shipment_item (FASE 8)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION scan_shipment_item(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shipment_id        uuid := (p_payload->>'shipment_id')::uuid;
  v_barcode            text := UPPER(TRIM(p_payload->>'barcode'));
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
  SELECT * INTO v_volume FROM public.packing_volumes WHERE UPPER(volume_code) = v_barcode;
  IF FOUND THEN
    v_is_volume := true;
  ELSE
    -- Tentar localizar peça
    SELECT * INTO v_piece FROM public.production_pieces 
    WHERE (UPPER(traceability_code) = v_barcode OR UPPER(piece_uid) = v_barcode)
      AND status <> 'cancelled';
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
      -- Se não estiver no checklist mas for do lote, inserir no checklist
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

  -- Verificar se já foi embalada em algum volume (se sim, exige bipar o volume, não a peça solta)
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

-- ─────────────────────────────────────────────────────────────
-- 8. RPC: create_rework_order (FASE 6)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_rework_order(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_piece_id           uuid := (p_payload->>'piece_id')::uuid;
  v_reason_code        text := p_payload->>'reason_code';
  v_stage_at_damage    text := p_payload->>'stage_at_damage';
  v_notes              text := p_payload->>'notes';
  
  v_original           public.production_pieces%ROWTYPE;
  v_reason             public.rework_reasons%ROWTYPE;
  v_sub_uid            text;
  v_sub_tcode          text;
  v_sub_piece_id       uuid;
  v_rework_id          uuid;
BEGIN
  -- Obter peça original
  SELECT * INTO v_original FROM public.production_pieces WHERE id = v_piece_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça original não encontrada.');
  END IF;

  -- Obter motivo
  SELECT * INTO v_reason FROM public.rework_reasons WHERE code = v_reason_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Motivo de retrabalho inválido.');
  END IF;

  -- Bloquear peça original
  UPDATE public.production_pieces SET
    status = 'rework',
    is_blocked = true,
    block_reason = 'RETRABALHO: ' || v_reason.description,
    updated_at = now()
  WHERE id = v_piece_id;

  -- Gerar UID da peça substituta
  v_sub_uid := generate_piece_uid();
  v_sub_tcode := replace(v_sub_uid, 'PC-', '') || '-R'; -- Código de etiqueta diferenciado

  -- Inserir peça substituta na rota a partir da etapa do dano (ou do início Corte)
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
    COALESCE(v_stage_at_damage, 'Corte'),
    'planned',
    'rework',
    v_original.id,
    true,
    auth.uid()
  ) RETURNING id INTO v_sub_piece_id;

  -- Criar ordem de retrabalho
  INSERT INTO public.rework_orders (
    original_piece_id,
    replacement_piece_id,
    reason_id,
    reported_by,
    stage_at_damage,
    status,
    notes
  ) VALUES (
    v_original.id,
    v_sub_piece_id,
    v_reason.id,
    auth.uid(),
    COALESCE(v_stage_at_damage, v_original.current_stage),
    'pending',
    v_notes
  ) RETURNING id INTO v_rework_id;

  -- Registrar evento
  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status, notes
  ) VALUES (
    v_original.id, v_original.traceability_code, v_original.production_order_id, v_original.lot_id,
    'rework_start', v_original.current_stage, COALESCE(v_stage_at_damage, 'Corte'), 'accepted', v_reason.description
  );

  RETURN jsonb_build_object(
    'success',            true,
    'rework_order_id',    v_rework_id,
    'original_piece_id',  v_original.id,
    'replacement_id',     v_sub_piece_id,
    'replacement_uid',    v_sub_uid,
    'replacement_code',   v_sub_tcode
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- REDESENHO DE process_production_reading (FASE 3)
-- Atualizado para evitar status = 'shipped' automático no lote
-- ─────────────────────────────────────────────────────────────

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

  -- Máquina
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
  v_route public.production_routes%ROWTYPE;
  v_next public.production_routes%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_recent integer := 0;
  v_total integer := 0;
  v_completed integer := 0;
  v_result jsonb;
  v_is_rework boolean := false;
  v_rework_of_reading_id uuid;
  v_rework_reason text;
  
  -- Para atualização do contador incremental
  v_machine_row public.production_machines%ROWTYPE;
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

  -- Resolver máquina se ID fornecido
  IF v_machine_id IS NOT NULL THEN
    SELECT * INTO v_machine_row FROM public.production_machines WHERE id = v_machine_id;
    IF FOUND THEN
      v_machine_name := v_machine_row.name;
    END IF;
  ELSIF v_machine_name IS NOT NULL AND v_cell IS NOT NULL THEN
    SELECT * INTO v_machine_row FROM public.production_machines WHERE name = v_machine_name AND cell_name = v_cell LIMIT 1;
    IF FOUND THEN
      v_machine_id := v_machine_row.id;
    END IF;
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
    status, created_at_client, payload,
    machine_id, machine_name, station_name, enqueue_duration_ms, sync_started_at
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_operator_id, v_operator, v_registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload,
    v_machine_id, v_machine_name, v_station, v_enqueue_duration_ms, v_sync_started_at
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

  -- Preencher detalhes no ledger
  UPDATE public.production_collection_events SET
    lot_id = v_item.lot_id,
    lot_code = v_item.lot_code,
    load_number = v_item.load_number,
    order_number = v_item.order_number,
    customer_name = v_item.customer_name,
    environment_name = v_item.environment_name,
    piece_code = v_item.item_code
  WHERE id = v_event.id;

  -- Se a tag não existia, cria
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

  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_item.lot_id;

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

  v_is_rework := v_item.status = 'rework';
  IF v_is_rework THEN
    v_rework_of_reading_id := v_item.last_rejection_reading_id;
    v_rework_reason := v_item.last_rejection_reason;
  END IF;

  -- 8. Resolver rota
  SELECT * INTO v_route FROM public.production_routes
  WHERE lot_id = v_lot.id
    AND step_name = COALESCE(v_step_input, v_item.current_step)
  LIMIT 1;

  IF v_route.id IS NULL THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'route_missing', error_message = 'Etapa não configurada para a rota do lote.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'route_missing', 'message', 'Esta etapa de processo não pertence à rota configurada para este lote.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  -- 9. Validar etapa atual
  IF v_step_input IS NOT NULL AND v_step_input <> v_item.current_step THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'wrong_step', error_message = 'Etapa incorreta.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'wrong_step', 'message', 'Bipagem em etapa incorreta.', 'expected', v_item.current_step, 'requested', v_step_input);
  END IF;

  -- 10. Validar célula
  IF v_cell IS NOT NULL AND v_route.cell_name IS NOT NULL AND LOWER(v_route.cell_name) <> LOWER(v_cell) THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'wrong_cell', error_message = 'Célula incorreta.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'wrong_cell', 'message', 'Célula de leitura incorreta.', 'expected', v_route.cell_name, 'requested', v_cell);
  END IF;

  -- 11. Evitar leituras consecutivas duplicadas (debounce de 2s)
  SELECT COUNT(*) INTO v_recent FROM public.production_stage_readings
  WHERE item_id = v_item.id AND step_name = v_route.step_name AND status = 'approved'
    AND created_at >= (now() - interval '2 seconds');

  IF v_recent > 0 THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'duplicated', error_message = 'Debounce de 2s ativo.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Bipagem repetida ignorada.');
  END IF;

  -- 12. Localizar próxima etapa
  SELECT * INTO v_next FROM public.production_routes
  WHERE lot_id = v_lot.id AND required = true AND step_order > v_route.step_order
  ORDER BY step_order LIMIT 1;

  -- 13. Gravar leitura
  INSERT INTO public.production_stage_readings (
    tag_id, tag_value, tag_type, reader_type, reader_id, station_name, cell_name, operator, shift, date, hour,
    item_id, lot_id, step_name, quantity, status, is_rework, rework_of_reading_id, rework_reason, operator_id, machine_id
  ) VALUES (
    v_tag.id, v_tag_value, v_tag.tag_type, v_reader_type, v_event.device_id, v_station, v_route.cell_name, v_operator, v_shift, v_date, v_hour,
    v_item.id, v_lot.id, v_route.step_name, v_quantity, 'approved', v_is_rework, v_rework_of_reading_id, v_rework_reason, v_operator_id, v_machine_id
  ) RETURNING * INTO v_reading;

  -- 14. Atualizar item
  UPDATE public.production_lot_items
  SET current_step = v_next.step_name,
      current_cell = v_next.cell_name,
      status = CASE WHEN v_next.id IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  -- 15. Atualizar progresso do lote
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total, v_completed
  FROM public.production_lot_items WHERE lot_id = v_lot.id;

  -- CORREÇÃO FASE 3: Quando a produção encerra, o lote vai para 'waiting_packaging' ou 'ready_to_pack', NUNCA 'shipped'!
  UPDATE public.production_lots
  SET progress_percent = CASE WHEN v_total > 0 THEN ROUND((v_completed::numeric / v_total::numeric) * 100, 2) ELSE 0 END,
      planned_quantity = CASE WHEN COALESCE(planned_quantity,0) = 0 THEN v_total ELSE planned_quantity END,
      current_status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'completed' ELSE 'in_progress' END,
      status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'waiting_packaging' ELSE 'in_progress' END,
      actual_end = CASE WHEN v_total > 0 AND v_completed = v_total THEN now() ELSE actual_end END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  -- 16. Inserir baixa produtiva
  INSERT INTO public.production_entries (
    date,shift,cell,hour,produced,target,scrap,downtime,operator,notes,created_by,client_event_id,
    operator_id, order_id, production_order_id, lot_id, lot_code, load_number, order_number,
    customer_name, customer_legal_name, environment_name, operation_name, machine_id, machine_name,
    is_rework, rework_of_reading_id, rework_reason
  ) VALUES (
    v_date,COALESCE(v_shift,'Não informado'),COALESCE(v_cell,v_route.cell_name,'Não informada'),v_hour,v_quantity,0,0,0,
    v_operator,CASE WHEN v_is_rework THEN 'Retrabalho aprovado - tag ' || v_tag_value ELSE 'Coleta produtiva - tag ' || v_tag_value END,auth.uid(),v_client_event_id,
    v_operator_id, COALESCE(v_lot.production_order_id, v_lot.order_id), COALESCE(v_lot.production_order_id, v_lot.order_id), v_lot.id, v_lot.lot_code, v_item.load_number, v_item.order_number,
    v_item.customer_name, v_item.customer_name, v_item.environment_name, v_route.step_name, v_machine_id, v_machine_name,
    v_is_rework, v_rework_of_reading_id, v_rework_reason
  ) RETURNING id INTO v_entry_id;

  -- Atualizar evento do ledger como sincronizado
  UPDATE public.production_collection_events SET
    status = 'synced',
    reading_id = v_reading.id,
    production_entry_id = v_entry_id,
    processed_at = now()
  WHERE id = v_event.id;

  -- Retornar resultado
  RETURN jsonb_build_object(
    'success', true,
    'status', 'approved',
    'message', CASE WHEN v_next.id IS NULL THEN 'Leitura aprovada. Rota concluída.' ELSE 'Leitura aprovada. Próxima etapa: ' || v_next.step_name END,
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_item),
    'route', to_jsonb(v_route),
    'reading', to_jsonb(v_reading),
    'nextStep', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END,
    'contextSummary', get_collection_context_summary(v_lot.id, null)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- GRANTS PARA AS NOVAS RPCS
-- ─────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION update_production_lot_status_safely(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_piece_to_volume(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_shipment_item(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_rework_order(jsonb) TO authenticated;

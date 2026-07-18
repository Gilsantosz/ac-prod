-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 036: Capa de Cliente Multi-Lote
-- ============================================================

-- ─── 1. Tabela de Capas de Clientes ────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_covers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pcp_import_batch_id uuid NOT NULL REFERENCES public.promob_import_batches(id) ON DELETE CASCADE,
  general_lot_code text NOT NULL,
  customer_name_exact text NOT NULL,
  cover_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'planned', -- planned | in_production | ready_to_pack | packing | packed | shipping | shipped | blocked | cancelled
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid,
  closed_by uuid,
  shipped_by uuid,
  closed_at timestamptz,
  shipped_at timestamptz,
  CONSTRAINT customer_covers_batch_name_key UNIQUE (pcp_import_batch_id, customer_name_exact)
);

-- Índices essenciais
CREATE INDEX IF NOT EXISTS idx_customer_covers_batch ON public.customer_covers(pcp_import_batch_id);
CREATE INDEX IF NOT EXISTS idx_customer_covers_customer ON public.customer_covers(customer_name_exact);
CREATE INDEX IF NOT EXISTS idx_customer_covers_status ON public.customer_covers(status);

-- ─── 2. Alterações de Tabelas Existentes ───────────────────

-- Associar lote de cliente à capa
ALTER TABLE public.production_lots 
  ADD COLUMN IF NOT EXISTS customer_cover_id uuid REFERENCES public.customer_covers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_production_lots_cover ON public.production_lots(customer_cover_id);

-- Associar volumes de embalagem à capa
ALTER TABLE public.packing_volumes 
  ADD COLUMN IF NOT EXISTS customer_cover_id uuid REFERENCES public.customer_covers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_packing_volumes_cover ON public.packing_volumes(customer_cover_id);

-- Associar remessa de expedição à capa
ALTER TABLE public.shipments 
  ADD COLUMN IF NOT EXISTS customer_cover_id uuid REFERENCES public.customer_covers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_cover ON public.shipments(customer_cover_id);

-- Permitir nulabilidade nas remessas legadas de lote único
ALTER TABLE public.shipments ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.shipments ALTER COLUMN lot_id DROP NOT NULL;

-- Restrição de expedição por capa ou por lote único
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS check_shipment_target;
ALTER TABLE public.shipments ADD CONSTRAINT check_shipment_target 
  CHECK (customer_cover_id IS NOT NULL OR (lot_id IS NOT NULL AND order_id IS NOT NULL));

-- Excluir duplicidades nas peças embaladas antes de aplicar restrição única (para evitar falhas de migração)
DELETE FROM public.packing_volume_items a 
USING public.packing_volume_items b 
WHERE a.id < b.id AND a.piece_id = b.piece_id;

-- Garantir restrição de peça única por volume
ALTER TABLE public.packing_volume_items DROP CONSTRAINT IF EXISTS packing_volume_items_piece_id_key;
ALTER TABLE public.packing_volume_items ADD CONSTRAINT packing_volume_items_piece_id_key UNIQUE (piece_id);

-- ─── 3. Histórico de Eventos da Capa ───────────────────────
CREATE TABLE IF NOT EXISTS public.customer_cover_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_id uuid NOT NULL REFERENCES public.customer_covers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  lot_id uuid REFERENCES public.production_lots(id) ON DELETE SET NULL,
  piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  volume_id uuid REFERENCES public.packing_volumes(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  operator_id uuid,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cover_events_cover ON public.customer_cover_events(cover_id);

-- ─── 4. RPC: Criar Capas para Lotes do Batch ───────────────
CREATE OR REPLACE FUNCTION public.create_customer_covers_for_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_code text;
  v_rec record;
  v_cover_id uuid;
  v_hash text;
  v_cover_code text;
  v_customer_clean text;
BEGIN
  -- Obter o código do lote geral/batch
  SELECT general_lot_code INTO v_batch_code
  FROM public.promob_import_batches
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importação % não encontrado.', p_batch_id;
  END IF;

  -- Percorrer os clientes do lote
  FOR v_rec IN 
    SELECT DISTINCT customer_name 
    FROM public.production_lots 
    WHERE pcp_import_batch_id = p_batch_id
  LOOP
    v_customer_clean := btrim(v_rec.customer_name);
    
    -- Ignorar clientes vazios ou não informados agrupados (isolamos por lote de forma controlada)
    IF v_customer_clean IS NULL OR v_customer_clean = '' OR v_customer_clean = 'Cliente não informado' THEN
      -- Criar uma capa exclusiva para cada lote individual sem cliente válido
      FOR v_rec IN 
        SELECT id, lot_code, customer_name
        FROM public.production_lots 
        WHERE pcp_import_batch_id = p_batch_id
          AND (customer_name IS NULL OR btrim(customer_name) = '' OR btrim(customer_name) = 'Cliente não informado')
      LOOP
        v_customer_clean := COALESCE(NULLIF(btrim(v_rec.customer_name), ''), 'Cliente não informado');
        v_hash := substring(md5(p_batch_id::text || ':' || v_rec.lot_code), 1, 8);
        v_cover_code := 'CAP-' || COALESCE(v_batch_code, 'PCP') || '-' || v_hash;

        INSERT INTO public.customer_covers (
          pcp_import_batch_id, general_lot_code, customer_name_exact, cover_code, status
        ) VALUES (
          p_batch_id, COALESCE(v_batch_code, 'PCP'), v_customer_clean || ' (' || v_rec.lot_code || ')', v_cover_code, 'planned'
        )
        ON CONFLICT (pcp_import_batch_id, customer_name_exact) DO UPDATE
        SET general_lot_code = EXCLUDED.general_lot_code
        RETURNING id INTO v_cover_id;

        UPDATE public.production_lots
        SET customer_cover_id = v_cover_id
        WHERE id = v_rec.id;
      END LOOP;
    ELSE
      -- Gerar hash determinístico baseado no batch e no nome do cliente
      v_hash := substring(md5(p_batch_id::text || ':' || v_customer_clean), 1, 8);
      v_cover_code := 'CAP-' || COALESCE(v_batch_code, 'PCP') || '-' || v_hash;

      INSERT INTO public.customer_covers (
        pcp_import_batch_id, general_lot_code, customer_name_exact, cover_code, status
      ) VALUES (
        p_batch_id, COALESCE(v_batch_code, 'PCP'), v_customer_clean, v_cover_code, 'planned'
      )
      ON CONFLICT (pcp_import_batch_id, customer_name_exact) DO UPDATE
      SET general_lot_code = EXCLUDED.general_lot_code
      RETURNING id INTO v_cover_id;

      -- Associar os lotes correspondentes a essa capa
      UPDATE public.production_lots
      SET customer_cover_id = v_cover_id
      WHERE pcp_import_batch_id = p_batch_id
        AND btrim(customer_name) = v_customer_clean;

      -- Registrar evento
      INSERT INTO public.customer_cover_events (cover_id, event_type, metadata)
      VALUES (v_cover_id, 'created', jsonb_build_object('auto_created', true));
    END IF;
  END LOOP;
END;
$$;

-- ─── 5. View de Progresso Consolidado da Capa ──────────────
CREATE OR REPLACE VIEW public.v_customer_cover_summary AS
SELECT 
  cc.id AS id,
  cc.cover_code,
  cc.customer_name_exact,
  cc.general_lot_code,
  cc.pcp_import_batch_id,
  cc.status,
  cc.created_at,
  cc.closed_at,
  cc.shipped_at,
  count(DISTINCT pl.id) AS total_lots,
  string_agg(DISTINCT pl.lot_code, ', ' ORDER BY pl.lot_code) AS lot_codes,
  count(DISTINCT pp.id) AS planned_pieces,
  count(DISTINCT pp.id) FILTER (WHERE pp.status <> 'planned') AS started_pieces,
  count(DISTINCT pp.id) FILTER (WHERE pp.current_stage = 'Separação' OR pp.status = 'completed') AS ready_to_pack_pieces,
  count(DISTINCT pvi.piece_id) AS packed_pieces,
  count(DISTINCT pp.id) FILTER (WHERE pp.status = 'completed' AND pp.current_stage = 'Expedição') AS shipped_pieces,
  count(DISTINCT pv.id) FILTER (WHERE pv.status = 'open') AS open_volumes,
  count(DISTINCT pv.id) FILTER (WHERE pv.status = 'closed') AS closed_volumes,
  -- Progresso produtivo ponderado
  COALESCE(
    (SUM(
      CASE 
        WHEN pp.status = 'completed' THEN 1.0 
        ELSE COALESCE(cardinality(pp.completed_steps)::numeric / NULLIF(cardinality(pp.route_steps), 0), 0.0) 
      END
    ) / NULLIF(count(pp.id), 0)) * 100, 
    0
  ) AS production_progress,
  -- Progresso de embalagem
  COALESCE(
    (count(DISTINCT pvi.piece_id)::numeric / NULLIF(count(DISTINCT pp.id) FILTER (WHERE pp.requires_packaging IS NOT FALSE), 0)) * 100, 
    0
  ) AS packing_progress,
  -- Progresso de expedição
  COALESCE(
    (count(DISTINCT pp.id) FILTER (WHERE pp.status = 'completed' AND pp.current_stage = 'Expedição')::numeric / NULLIF(count(pp.id), 0)) * 100, 
    0
  ) AS shipping_progress
FROM public.customer_covers cc
LEFT JOIN public.production_lots pl ON pl.customer_cover_id = cc.id
LEFT JOIN public.production_pieces pp ON pp.lot_id = pl.id
LEFT JOIN public.packing_volume_items pvi ON pvi.piece_id = pp.id
LEFT JOIN public.packing_volumes pv ON pv.customer_cover_id = cc.id OR pv.lot_id = pl.id
GROUP BY cc.id;

-- ─── 6. RPC: Buscar Progresso Detalhado ──────────────────
CREATE OR REPLACE FUNCTION public.get_cover_progress(p_cover_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary record;
END;
$$;
-- Note: placeholder completed below inside sql.
-- wait, let me actually write the full get_cover_progress
CREATE OR REPLACE FUNCTION public.get_cover_progress(p_cover_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary record;
BEGIN
  SELECT * INTO v_summary FROM public.v_customer_cover_summary WHERE id = p_cover_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Capa de cliente não encontrada.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_summary.id,
    'cover_code', v_summary.cover_code,
    'customer_name_exact', v_summary.customer_name_exact,
    'general_lot_code', v_summary.general_lot_code,
    'status', v_summary.status,
    'total_lots', v_summary.total_lots,
    'lot_codes', v_summary.lot_codes,
    'planned_pieces', v_summary.planned_pieces,
    'started_pieces', v_summary.started_pieces,
    'ready_to_pack_pieces', v_summary.ready_to_pack_pieces,
    'packed_pieces', v_summary.packed_pieces,
    'shipped_pieces', v_summary.shipped_pieces,
    'open_volumes', v_summary.open_volumes,
    'closed_volumes', v_summary.closed_volumes,
    'production_progress', round(v_summary.production_progress, 1),
    'packing_progress', round(v_summary.packing_progress, 1),
    'shipping_progress', round(v_summary.shipping_progress, 1)
  );
END;
$$;

-- ─── 7. RPC: Expedir Todos os Lotes da Capa ──────────────
CREATE OR REPLACE FUNCTION public.release_cover_shipment(
  p_cover_id uuid,
  p_carrier text,
  p_vehicle text,
  p_driver text,
  p_tracking_code text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cover record;
  v_shipment_id uuid;
  v_lot record;
  v_operator uuid := auth.uid();
BEGIN
  -- Verificar se o usuário está logado
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'Operação não autorizada. Faça login.';
  END IF;

  -- Obter capa
  SELECT * INTO v_cover FROM public.customer_covers WHERE id = p_cover_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Capa de cliente não encontrada.');
  END IF;

  -- Criar a remessa na tabela shipments
  INSERT INTO public.shipments (
    customer_cover_id, shipment_code, carrier, vehicle, driver, tracking_code, status, notes, shipped_by, shipped_at
  ) VALUES (
    p_cover_id, 'SHIP-' || v_cover.cover_code, p_carrier, p_vehicle, p_driver, p_tracking_code, 'shipped', p_notes, v_operator, now()
  ) RETURNING id INTO v_shipment_id;

  -- Atualizar capa
  UPDATE public.customer_covers
  SET status = 'shipped', shipped_at = now(), shipped_by = v_operator
  WHERE id = p_cover_id;

  -- Atualizar todos os lotes pertencentes à capa
  FOR v_lot IN SELECT id, lot_code FROM public.production_lots WHERE customer_cover_id = p_cover_id LOOP
    -- Atualizar status do lote de forma segura
    PERFORM public.update_production_lot_status_safely(v_lot.id, 'shipped');

    -- Gravar evento de expedição para o lote
    INSERT INTO public.lot_step_events (
      lot_id, step_code, event_type, notes, quantity
    ) VALUES (
      v_lot.id, 'shipping', 'finish', 'Expedido via Capa ' || v_cover.cover_code, 0
    );
  END LOOP;

  -- Atualizar todas as peças pertencentes a esses lotes para Expedição/completed
  UPDATE public.production_pieces
  SET current_stage = 'Expedição', status = 'completed'
  WHERE lot_id IN (SELECT id FROM public.production_lots WHERE customer_cover_id = p_cover_id);

  -- Gravar evento de expedição no histórico consolidado da capa
  INSERT INTO public.customer_cover_events (
    cover_id, event_type, shipment_id, operator_id, metadata
  ) VALUES (
    p_cover_id, 'shipped', v_shipment_id, v_operator, 
    jsonb_build_object('carrier', p_carrier, 'vehicle', p_vehicle, 'driver', p_driver)
  );

  RETURN jsonb_build_object('success', true, 'shipment_id', v_shipment_id);
END;
$$;

-- ─── 8. RPC: Cancelar Capa ────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_customer_cover(p_cover_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator uuid := auth.uid();
BEGIN
  IF v_operator IS NULL OR public.get_my_role() NOT IN ('admin','manager') THEN
    RAISE EXCEPTION 'Permissão insuficiente para cancelar capa de cliente.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.customer_covers
  SET status = 'cancelled', notes = COALESCE(notes, '') || E'\nCancelado: ' || p_reason
  WHERE id = p_cover_id;

  -- Desvincular lotes para que possam ser reagrupados se necessário
  UPDATE public.production_lots
  SET customer_cover_id = NULL
  WHERE customer_cover_id = p_cover_id;

  -- Registrar evento
  INSERT INTO public.customer_cover_events (cover_id, event_type, operator_id, metadata)
  VALUES (p_cover_id, 'cancelled', v_operator, jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 9. Atualização da RPC: scan_piece_to_volume ──────────
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

  -- Bloquear peça de outra capa (se o volume estiver associado a uma capa)
  IF v_volume.customer_cover_id IS NOT NULL THEN
    IF v_piece.customer_cover_id IS NULL OR v_piece.customer_cover_id <> v_volume.customer_cover_id THEN
      INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
      VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça pertence a outra capa de cliente.', v_operator_id, v_device_id);
      
      RETURN jsonb_build_object('success', false, 'error', 'Bloqueio: Peça pertence a outra capa de cliente.');
    END IF;
  ELSE
    -- Bloquear peça de outro lote produtivo
    IF v_piece.lot_id <> v_volume.lot_id THEN
      INSERT INTO public.packing_scans (volume_id, piece_id, scan_result, error_reason, operator_id, device_id)
      VALUES (v_volume_id, v_piece.id, 'rejected', 'Peça pertence a outro lote produtivo.', v_operator_id, v_device_id);
      
      RETURN jsonb_build_object('success', false, 'error', 'Bloqueio: Peça pertence a outro lote produtivo.');
    END IF;
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

-- ─── 10. Atualização da RPC: scan_shipment_item ───────────
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
        v_piece.id := NULL;
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
    IF v_shipment.customer_cover_id IS NOT NULL THEN
      IF v_volume.customer_cover_id IS NULL OR v_volume.customer_cover_id <> v_shipment.customer_cover_id THEN
        INSERT INTO public.shipment_scans (shipment_id, piece_id, volume_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
        VALUES (v_shipment_id, NULL, v_volume.id, v_barcode, 'rejected', 'Volume pertence a outra capa', v_operator_id, v_device_id);
        RETURN jsonb_build_object('success', false, 'error', 'Volume pertence a outra capa de cliente.');
      END IF;
    ELSE
      IF v_volume.lot_id <> v_shipment.lot_id THEN
        INSERT INTO public.shipment_scans (shipment_id, piece_id, volume_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
        VALUES (v_shipment_id, NULL, v_volume.id, v_barcode, 'rejected', 'Volume pertence a outro lote', v_operator_id, v_device_id);
        RETURN jsonb_build_object('success', false, 'error', 'Volume pertence a outro lote produtiva.');
      END IF;
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
    SELECT piece_id, traceability_code, production_order_id, lot_id,
      'ship', 'Embalagem', 'Expedição', 'accepted'
    FROM public.production_pieces WHERE id IN (SELECT piece_id FROM public.packing_volume_items WHERE volume_id = v_volume.id);

    RETURN jsonb_build_object('success', true, 'type', 'volume', 'id', v_volume.id, 'code', v_volume.volume_code);
  END IF;

  -- Se for peça avulsa
  IF v_shipment.customer_cover_id IS NOT NULL THEN
    IF v_piece.customer_cover_id IS NULL OR v_piece.customer_cover_id <> v_shipment.customer_cover_id THEN
      INSERT INTO public.shipment_scans (shipment_id, piece_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
      VALUES (v_shipment_id, v_piece.id, v_barcode, 'rejected', 'Peça pertence a outra capa', v_operator_id, v_device_id);
      RETURN jsonb_build_object('success', false, 'error', 'Peça pertence a outra capa de cliente.');
    END IF;
  ELSE
    IF v_piece.lot_id <> v_shipment.lot_id THEN
      INSERT INTO public.shipment_scans (shipment_id, piece_id, barcode_raw_value, scan_result, error_reason, operator_id, device_id)
      VALUES (v_shipment_id, v_piece.id, v_barcode, 'rejected', 'Peça pertence a outro lote', v_operator_id, v_device_id);
      RETURN jsonb_build_object('success', false, 'error', 'Peça pertence a outro lote produtiva.');
    END IF;
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

-- ─── 11. Habilitar RLS e Roteamento ────────────────────────
ALTER TABLE public.customer_covers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_cover_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cc_select_all" ON public.customer_covers;
CREATE POLICY "cc_select_all" ON public.customer_covers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cce_select_all" ON public.customer_cover_events;
CREATE POLICY "cce_select_all" ON public.customer_cover_events
  FOR SELECT TO authenticated USING (true);

-- ─── 12. Adicionar Tabelas ao Realtime ────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_covers', 'customer_cover_events']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_table THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ─── 13. Backfill Idempotente de Lotes Existentes ─────────
DO $$
DECLARE
  v_batch record;
BEGIN
  FOR v_batch IN SELECT DISTINCT pcp_import_batch_id FROM public.production_lots WHERE pcp_import_batch_id IS NOT NULL LOOP
    BEGIN
      PERFORM public.create_customer_covers_for_batch(v_batch.pcp_import_batch_id);
    EXCEPTION WHEN OTHERS THEN
      -- Capturar e silenciar erros de backfill para não bloquear a migração
      RAISE NOTICE 'Erro ao processar batch %: %', v_batch.pcp_import_batch_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ─── 14. Atualização de commit_pcp_import para Gerar Capas ─
CREATE OR REPLACE FUNCTION public.commit_pcp_import(
  p_batch_id uuid,
  p_order_code text,
  p_lot_code text,
  p_customer text,
  p_project_name text,
  p_mapping_profile text,
  p_mapping_version integer,
  p_rows jsonb,
  p_finalize boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_current_user uuid := auth.uid();
  v_order_id uuid;
  v_first_order_id uuid;
  v_lot_id uuid;
  v_piece_id uuid;
  v_lot_item_id uuid;
  v_route_steps text[];
  v_row_order_code text;
  v_row_general_lot_code text;
  v_row_lot_code text;
  v_row_customer text;
  v_row_project text;
  v_barcode text;
  v_check_barcode text;
  v_route text;
  v_piece_code text;
  v_piece_name text;
  v_manual_joinery boolean;
  v_quantity integer;
  v_material text;
  v_color text;
  v_thickness numeric;
  v_width numeric;
  v_height numeric;
  v_environment text;
  v_module text;
  v_piece_uid text;
  v_suffix text;
  v_inserted_pieces integer := 0;
  v_inserted_rows integer := 0;
  v_order_count integer := 0;
  v_lot_count integer := 0;
  v_customer_count integer := 0;
  v_total_batch_pieces integer := 0;
  v_total_batch_rows integer := 0;
  v_existing_batch_id uuid;
  v_batch_general_lot_code text;
  v_existing_lot_batch_id uuid;
  v_existing_lot_customer text;
  i integer;
BEGIN
  IF v_current_user IS NULL OR public.get_my_role() NOT IN ('admin','manager','supervisor') THEN
    RAISE EXCEPTION 'Usuário sem permissão para confirmar importação PCP.' USING ERRCODE = '42501';
  END IF;

  SELECT general_lot_code INTO v_batch_general_lot_code
  FROM public.promob_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importação % não localizado.', p_batch_id USING ERRCODE = 'P0008';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'A importação PCP não contém linhas válidas.' USING ERRCODE = 'P0009';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row_order_code := COALESCE(NULLIF(TRIM(v_row->>'orderCode'), ''), NULLIF(TRIM(p_order_code), ''), 'PED-' || p_batch_id::text);
    v_row_general_lot_code := COALESCE(NULLIF(TRIM(v_row->>'generalLotCode'), ''), NULLIF(TRIM(p_lot_code), ''));
    v_row_lot_code := NULLIF(TRIM(v_row->>'clientLotCode'), '');
    v_row_customer := COALESCE(NULLIF(TRIM(v_row->>'customer'), ''), NULLIF(TRIM(p_customer), ''), 'Cliente não informado');
    v_row_project := COALESCE(NULLIF(TRIM(v_row->>'projectName'), ''), NULLIF(TRIM(p_project_name), ''), '');
    v_barcode := UPPER(TRIM(COALESCE(v_row->>'barcode', '')));
    v_check_barcode := UPPER(TRIM(COALESCE(v_row->>'checkBarcode', '')));
    v_route := TRIM(COALESCE(v_row->>'route', ''));
    v_piece_code := COALESCE(NULLIF(TRIM(v_row->>'pieceCode'), ''), v_barcode);
    v_piece_name := COALESCE(NULLIF(TRIM(v_row->>'pieceName'), ''), 'Sem nome');
    v_manual_joinery := COALESCE((v_row->>'manualJoinery')::boolean, false);
    v_quantity := 1;
    v_material := NULLIF(TRIM(v_row->>'material'), '');
    v_color := NULLIF(TRIM(v_row->>'color'), '');
    v_thickness := NULLIF(REPLACE(v_row->>'thickness', ',', '.'), '')::numeric;
    v_width := NULLIF(REPLACE(v_row->>'width', ',', '.'), '')::numeric;
    v_height := NULLIF(REPLACE(v_row->>'height', ',', '.'), '')::numeric;
    v_environment := NULLIF(TRIM(v_row->>'environmentName'), '');
    v_module := NULLIF(TRIM(v_row->>'moduleName'), '');

    IF v_barcode = '' THEN
      RAISE EXCEPTION 'Linha % sem código de barras.', COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1);
    END IF;
    IF v_row_general_lot_code IS NULL THEN
      RAISE EXCEPTION 'Linha % sem lote geral PCP.', COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1);
    END IF;
    IF v_batch_general_lot_code IS NULL OR v_batch_general_lot_code = '' THEN
      v_batch_general_lot_code := v_row_general_lot_code;
      UPDATE public.promob_import_batches
      SET general_lot_code = v_batch_general_lot_code
      WHERE id = p_batch_id;
    ELSIF v_batch_general_lot_code <> v_row_general_lot_code THEN
      RAISE EXCEPTION 'Linha % pertence ao lote geral %, mas esta importação é do lote geral %.',
        COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1),
        v_row_general_lot_code,
        v_batch_general_lot_code;
    END IF;
    IF v_row_lot_code IS NULL THEN
      RAISE EXCEPTION 'Linha % sem lote do cliente.', COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1);
    END IF;
    IF v_check_barcode <> '' AND v_check_barcode <> v_barcode THEN
      RAISE EXCEPTION 'Linha % com divergência entre código e conferência (% <> %).',
        COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1), v_barcode, v_check_barcode;
    END IF;

    INSERT INTO public.production_orders (
      order_code, system_order_number, order_number, customer_name,
      customer_legal_name, promob_project_name, status, created_by
    ) VALUES (
      v_row_order_code, v_row_order_code, v_row_order_code, v_row_customer,
      v_row_customer, v_row_project, 'planned', v_current_user
    )
    ON CONFLICT (order_code) DO UPDATE
    SET customer_name = CASE
          WHEN public.production_orders.customer_name = '' THEN EXCLUDED.customer_name
          ELSE public.production_orders.customer_name
        END,
        customer_legal_name = COALESCE(public.production_orders.customer_legal_name, EXCLUDED.customer_legal_name),
        promob_project_name = COALESCE(public.production_orders.promob_project_name, EXCLUDED.promob_project_name),
        updated_at = now()
    RETURNING id INTO v_order_id;

    v_first_order_id := COALESCE(v_first_order_id, v_order_id);

    SELECT l.id, l.pcp_import_batch_id,
           (SELECT pli.customer_name FROM public.production_lot_items pli WHERE pli.lot_id = l.id AND pli.customer_name IS NOT NULL LIMIT 1)
    INTO v_lot_id, v_existing_lot_batch_id, v_existing_lot_customer
    FROM public.production_lots l
    WHERE upper(l.lot_code) = upper(v_row_lot_code)
    FOR UPDATE;

    IF v_lot_id IS NULL THEN
      INSERT INTO public.production_lots (
        lot_code, order_id, production_order_id, order_number, customer_name,
        status, created_by, pcp_import_batch_id, actual_start
      ) VALUES (
        v_row_lot_code, v_order_id, v_order_id, v_row_order_code, v_row_customer,
        'planned', v_current_user, p_batch_id, NULL
      ) RETURNING id INTO v_lot_id;
    ELSE
      IF v_existing_lot_batch_id IS NOT NULL AND v_existing_lot_batch_id <> p_batch_id THEN
        RAISE EXCEPTION 'Lote do cliente % já pertence a outro lote geral PCP.', v_row_lot_code;
      END IF;
      IF v_existing_lot_customer IS NOT NULL AND lower(v_existing_lot_customer) <> lower(v_row_customer) THEN
        RAISE EXCEPTION 'Lote do cliente % está vinculado a % e não pode receber peças de %.',
          v_row_lot_code, v_existing_lot_customer, v_row_customer;
      END IF;
      UPDATE public.production_lots
      SET pcp_import_batch_id = p_batch_id,
          customer_name = COALESCE(NULLIF(customer_name, ''), v_row_customer),
          order_number = COALESCE(NULLIF(order_number, ''), v_row_order_code),
          updated_at = now()
      WHERE id = v_lot_id;
    END IF;

    INSERT INTO public.pcp_import_rows (
      batch_id, row_number, raw_cells, normalized_payload, barcode_raw,
      barcode_normalized, validation_status, validation_errors,
      mapping_version, row_hash
    ) VALUES (
      p_batch_id,
      COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1),
      COALESCE(v_row->'raw_cells', '[]'::jsonb),
      v_row,
      v_barcode,
      v_barcode,
      'valid',
      '[]'::jsonb,
      COALESCE(p_mapping_version, 1),
      md5(p_batch_id::text || ':' || v_row::text)
    )
    ON CONFLICT (batch_id, row_number) DO UPDATE
    SET raw_cells = EXCLUDED.raw_cells,
        normalized_payload = EXCLUDED.normalized_payload,
        barcode_raw = EXCLUDED.barcode_raw,
        barcode_normalized = EXCLUDED.barcode_normalized,
        validation_status = EXCLUDED.validation_status,
        validation_errors = EXCLUDED.validation_errors,
        mapping_version = EXCLUDED.mapping_version,
        row_hash = EXCLUDED.row_hash;

    v_route_steps := public.parse_pcp_route_tokens(v_route);
    IF v_manual_joinery THEN
      v_route_steps := array_prepend('joinery', array_remove(v_route_steps, 'joinery'));
    END IF;

    FOR i IN 1..v_quantity LOOP
      v_suffix := CASE WHEN v_quantity > 1 THEN '-' || i::text ELSE '' END;
      v_piece_uid := v_barcode || v_suffix;

      SELECT pcp_import_batch_id INTO v_existing_batch_id
      FROM public.production_pieces
      WHERE piece_uid = v_piece_uid;

      IF FOUND THEN
        IF v_existing_batch_id = p_batch_id THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Código de barras % já pertence a outra importação PCP.', v_piece_uid;
      END IF;

      INSERT INTO public.production_lot_items (
        lot_id, item_code, product_code, product_name, current_step, status,
        lot_code, load_number, order_number, customer_name, environment_name,
        pieces_quantity
      ) VALUES (
        v_lot_id, v_piece_uid, v_piece_code, v_piece_name,
        COALESCE(v_route_steps[1], 'Importado'), 'pending',
        v_row_lot_code, NULL, v_row_order_code, v_row_customer, v_environment, 1
      ) RETURNING id INTO v_lot_item_id;

      v_piece_id := NULL;
      SELECT id INTO v_piece_id
      FROM public.production_pieces
      WHERE legacy_production_lot_item_id = v_lot_item_id
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE;

      IF v_piece_id IS NULL THEN
        INSERT INTO public.production_pieces (
          piece_uid, traceability_code, production_order_id, lot_id,
          module_name, environment, piece_name, material, color,
          thickness, width, height, length, requires_joinery, manual_joinery,
          manual_joinery_reason, current_stage, status,
          source_origin, legacy_production_lot_item_id, route_steps,
          pcp_import_batch_id, created_by
        ) VALUES (
          v_piece_uid, v_piece_uid, v_order_id, v_lot_id,
          v_module, v_environment, v_piece_name, v_material, v_color,
          v_thickness, v_width, v_height, v_height, v_manual_joinery, v_manual_joinery,
          NULLIF(TRIM(v_row->>'manualJoineryReason'), ''),
          COALESCE(v_route_steps[1], 'created'), 'planned',
          CASE
            WHEN lower(COALESCE(v_row->>'sourceFormat', p_mapping_profile, '')) LIKE '%csv%' THEN 'csv'
            ELSE 'xlsx'
          END,
          v_lot_item_id, v_route_steps, p_batch_id, v_current_user
        ) RETURNING id INTO v_piece_id;
      ELSE
        UPDATE public.production_pieces
        SET piece_uid = v_piece_uid,
            traceability_code = v_piece_uid,
            production_order_id = v_order_id,
            lot_id = v_lot_id,
            module_name = v_module,
            environment = v_environment,
            piece_name = v_piece_name,
            material = v_material,
            color = v_color,
            thickness = v_thickness,
            width = v_width,
            height = v_height,
            length = v_height,
            requires_joinery = v_manual_joinery,
            manual_joinery = v_manual_joinery,
            manual_joinery_reason = NULLIF(TRIM(v_row->>'manualJoineryReason'), ''),
            current_stage = COALESCE(v_route_steps[1], 'created'),
            status = 'planned',
            source_origin = CASE
              WHEN lower(COALESCE(v_row->>'sourceFormat', p_mapping_profile, '')) LIKE '%csv%' THEN 'csv'
              ELSE 'xlsx'
            END,
            route_steps = v_route_steps,
            pcp_import_batch_id = p_batch_id,
            created_by = v_current_user,
            updated_at = now()
        WHERE id = v_piece_id;

        UPDATE public.production_events
        SET traceability_code = v_piece_uid,
            production_order_id = v_order_id,
            event_type = 'note',
            from_stage = NULL,
            to_stage = COALESCE(v_route_steps[1], 'created'),
            notes = 'Peça criada pela importação PCP.',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'source', 'pcp_import',
              'pcp_import_batch_id', p_batch_id,
              'general_lot_code', v_row_general_lot_code,
              'client_lot_code', v_row_lot_code
            )
        WHERE piece_id = v_piece_id
          AND event_type = 'reading'
          AND operator_id IS NULL
          AND legacy_stage_reading_id IS NULL;
      END IF;

      INSERT INTO public.production_tags (
        lot_id, item_id, piece_id, tag_value, tag_type, active
      ) VALUES (
        v_lot_id, v_lot_item_id, v_piece_id, v_piece_uid,
        CASE WHEN v_manual_joinery THEN 'manual' ELSE 'barcode' END,
        true
      );

      v_inserted_pieces := v_inserted_pieces + 1;
    END LOOP;

    v_inserted_rows := v_inserted_rows + 1;
  END LOOP;

  SELECT count(*),
         count(DISTINCT p.production_order_id),
         count(DISTINCT p.lot_id),
         count(DISTINCT NULLIF(TRIM(l.customer_name), ''))
  INTO v_total_batch_pieces, v_order_count, v_lot_count, v_customer_count
  FROM public.production_pieces p
  LEFT JOIN public.production_lots l ON l.id = p.lot_id
  WHERE p.pcp_import_batch_id = p_batch_id;

  SELECT count(*) INTO v_total_batch_rows
  FROM public.pcp_import_rows
  WHERE batch_id = p_batch_id;

  SELECT production_order_id INTO v_first_order_id
  FROM public.production_pieces
  WHERE pcp_import_batch_id = p_batch_id
    AND production_order_id IS NOT NULL
  ORDER BY created_at, id
  LIMIT 1;

  UPDATE public.production_lots l
  SET planned_quantity = x.piece_count,
      pending_quantity = x.piece_count,
      progress_percent = 0,
      updated_at = now()
  FROM (
    SELECT lot_id, count(*)::numeric AS piece_count
    FROM public.production_pieces
    WHERE pcp_import_batch_id = p_batch_id
    GROUP BY lot_id
  ) x
  WHERE l.id = x.lot_id;

  UPDATE public.promob_import_batches
  SET status = CASE WHEN p_finalize THEN 'processed' ELSE 'parsed' END,
      imported_at = CASE WHEN p_finalize THEN now() ELSE imported_at END,
      validated_at = CASE WHEN p_finalize THEN now() ELSE validated_at END,
      customer_name = CASE WHEN v_order_count > 1 THEN 'Múltiplos clientes' ELSE p_customer END,
      promob_project_name = p_project_name,
      order_code = CASE WHEN v_order_count > 1 THEN 'Múltiplos pedidos' ELSE p_order_code END,
      generated_op_id = CASE WHEN v_order_count = 1 THEN v_first_order_id ELSE NULL END,
      total_parts = v_total_batch_pieces,
      client_lots_count = v_lot_count,
      customers_count = v_customer_count,
      source_format = p_mapping_profile,
      mapping_profile = p_mapping_profile,
      mapping_version = COALESCE(p_mapping_version, 1),
      total_lines = v_total_batch_rows,
      valid_lines = v_total_batch_rows,
      empty_lines = 0,
      duplicate_lines = 0,
      notes = format(
        'PCP consolidado: %s peças, %s pedido(s), %s lote(s).',
        v_total_batch_pieces, v_order_count, v_lot_count
      )
  WHERE id = p_batch_id;

  PERFORM public.refresh_pcp_batch_progress(p_batch_id);

  IF p_finalize THEN
    -- Gerar capas automaticamente ao finalizar
    PERFORM public.create_customer_covers_for_batch(p_batch_id);

    INSERT INTO public.pcp_import_logs (
      import_file_id, user_id, action, message, severity, metadata_json
    ) VALUES (
      p_batch_id,
      v_current_user,
      'PCP_IMPORT',
      format(
        'Importação PCP finalizada: %s peças, %s pedido(s), %s lote(s).',
        v_total_batch_pieces, v_order_count, v_lot_count
      ),
      'info',
      jsonb_build_object(
        'pieces_created', v_total_batch_pieces,
        'source_rows', v_total_batch_rows,
        'orders', v_order_count,
        'lots', v_lot_count,
        'pcp_import_batch_id', p_batch_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'pieces_created', v_total_batch_pieces,
    'pieces_created_in_chunk', v_inserted_pieces,
    'rows_imported', v_total_batch_rows,
    'rows_imported_in_chunk', v_inserted_rows,
    'orders', v_order_count,
    'lots', v_lot_count,
    'finalized', p_finalize
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.promob_import_batches
  SET status = 'error', error_message = SQLERRM
  WHERE id = p_batch_id;
  RAISE;
END;
$$;

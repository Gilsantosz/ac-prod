-- ============================================================
-- Migration 035: Corrige search_path do pgcrypto e nomes de colunas
--
-- PROBLEMA 1: pgcrypto está no schema 'extensions', não em 'public'.
--   As funções sync_production_lot_item_to_piece e generate_piece_uid
--   chamavam gen_random_bytes() sem qualificação, causando:
--   "function gen_random_bytes(integer) does not exist"
--
-- PROBLEMA 2: O trigger sync_production_lot_item_to_piece usava
--   NEW.piece_name, mas a tabela production_lot_items tem product_name.
--   Também usava legacy_lot_id, mas a coluna é legacy_lot_item_id.
--
-- SOLUÇÃO: Reescrever ambas as funções com search_path correto e
--   nomes de colunas auditados contra o schema real do banco.
-- ============================================================

-- ─── generate_piece_uid ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_piece_uid()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_date  text := to_char(now(), 'YYYYMMDD');
  v_rand  text := upper(substring(encode(extensions.gen_random_bytes(4), 'hex') FROM 1 FOR 6));
  v_uid   text;
BEGIN
  v_uid := 'PC-' || v_date || '-' || v_rand;
  WHILE EXISTS (SELECT 1 FROM production_pieces WHERE piece_uid = v_uid) LOOP
    v_rand := upper(substring(encode(extensions.gen_random_bytes(4), 'hex') FROM 1 FOR 6));
    v_uid  := 'PC-' || v_date || '-' || v_rand;
  END LOOP;
  RETURN v_uid;
END;
$function$;

-- ─── sync_production_lot_item_to_piece (trigger em production_lot_items) ─────
--
-- Auditoria de colunas de production_lot_items usadas via NEW.*:
--   NEW.lot_id            → lot_id           ✅
--   NEW.source_lot_item_id → source_lot_item_id ✅
--   NEW.item_code         → item_code         ✅
--   NEW.environment_name  → environment_name  ✅
--   NEW.product_name      → product_name      ✅ (era piece_name — CORRIGIDO)
--   NEW.current_step      → current_step      ✅
--   NEW.status            → status            ✅
--   NEW.created_at        → created_at        ✅
--   NEW.id                → id                ✅
--
-- Auditoria de colunas de production_pieces usadas no INSERT:
--   legacy_lot_item_id            ✅ (era legacy_lot_id — CORRIGIDO)
--   legacy_production_lot_item_id ✅
--
CREATE OR REPLACE FUNCTION public.sync_production_lot_item_to_piece()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lot_item public.lot_items%ROWTYPE;
  v_piece_id uuid;
  v_uid      text;
  v_tcode    text;
  v_order_id uuid;
BEGIN
  -- Busca o production_order_id do lote pai
  SELECT production_order_id INTO v_order_id
  FROM public.production_lots
  WHERE id = NEW.lot_id;

  -- Se tiver origem em lot_items, busca dados complementares
  IF NEW.source_lot_item_id IS NOT NULL THEN
    SELECT * INTO v_lot_item
    FROM public.lot_items
    WHERE id = NEW.source_lot_item_id;
  END IF;

  -- Gera UID único para a peça (usa extensions.gen_random_bytes)
  v_uid   := 'PC-' || to_char(now(), 'YYYYMMDD') || '-' ||
             upper(substring(encode(extensions.gen_random_bytes(4), 'hex') FROM 1 FOR 6));
  -- v_tcode usa item_code (coluna de production_lot_items)
  v_tcode := COALESCE(NEW.item_code, replace(v_uid, 'PC-', ''));

  -- Verifica se já existe production_piece para este production_lot_item
  SELECT id INTO v_piece_id
  FROM public.production_pieces
  WHERE legacy_production_lot_item_id = NEW.id
  ORDER BY created_at, id
  LIMIT 1;

  IF v_piece_id IS NULL THEN
    INSERT INTO public.production_pieces (
      piece_uid, traceability_code, production_order_id, lot_id,
      module_name, environment, piece_name, description, material, color,
      thickness, width, height, length, edge_front, edge_back, edge_left,
      edge_right, requires_cut, requires_edge, requires_cnc, requires_joinery,
      requires_separation, requires_packaging, current_stage, status,
      source_origin, legacy_lot_item_id, legacy_production_lot_item_id, created_at
    ) VALUES (
      v_uid, v_tcode,
      COALESCE(v_order_id, (SELECT order_id FROM public.production_lots WHERE id = NEW.lot_id)),
      NEW.lot_id,
      NULL,
      COALESCE(NEW.environment_name, v_lot_item.environment_name),
      -- production_lot_items.product_name → production_pieces.piece_name
      COALESCE(NEW.product_name, v_lot_item.piece_name, 'Peça sem nome'),
      NULL,
      v_lot_item.material,
      v_lot_item.color,
      COALESCE(v_lot_item.thickness, 0),
      COALESCE(v_lot_item.width, 0),
      COALESCE(v_lot_item.height, 0),
      COALESCE(v_lot_item.depth, 0),
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
        WHEN NEW.status = 'rework'    THEN 'rework'
        ELSE 'planned'
      END,
      CASE WHEN NEW.source_lot_item_id IS NOT NULL THEN 'promob_xml' ELSE 'manual' END,
      NEW.source_lot_item_id,
      NEW.id,
      NEW.created_at
    ) RETURNING id INTO v_piece_id;

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id,
      event_type, from_stage, to_stage, event_status, created_at
    ) VALUES (
      v_piece_id, v_tcode, v_order_id, NEW.lot_id,
      'reading', NULL, NEW.current_step, 'accepted', NEW.created_at
    );
  ELSE
    UPDATE public.production_pieces
    SET current_stage = CASE
          WHEN pcp_import_batch_id IS NULL THEN NEW.current_step
          ELSE current_stage
        END,
        status = CASE
          WHEN NEW.status = 'completed' THEN 'completed'
          WHEN NEW.status = 'cancelled' THEN 'cancelled'
          WHEN NEW.status = 'rework'    THEN 'rework'
          ELSE 'in_progress'
        END,
        updated_at = now()
    WHERE id = v_piece_id;
  END IF;

  RETURN NEW;
END;
$function$;

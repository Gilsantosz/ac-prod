-- ============================================================
-- AC.Prod MES — Enriquecimento Automático de Dados de Peças PCP
-- Migration 20260725130000 — Backfill e Atualização de RPCs
-- ============================================================

-- 1. BACKFILL EM ESTRUTURAS EXISTENTES
-- Preenche material, cor, dimensão, espessura e route_steps em production_pieces a partir de pcp_import_rows e production_lot_items
DO $$
DECLARE
  r RECORD;
  v_material text;
  v_color text;
  v_thickness numeric;
  v_width numeric;
  v_height numeric;
  v_length numeric;
  v_route_raw text;
  v_route_steps text[];
BEGIN
  -- Percorrer peças com dados físicos ausentes
  FOR r IN 
    SELECT 
      pp.id AS piece_id,
      pp.piece_uid,
      pp.traceability_code,
      pp.material,
      pp.color,
      pp.thickness,
      pp.width,
      pp.height,
      pp.length,
      pp.route_steps,
      pp.legacy_production_lot_item_id,
      pli.material AS pli_material,
      pli.color AS pli_color,
      pli.thickness AS pli_thickness,
      pli.width AS pli_width,
      pli.height AS pli_height
    FROM public.production_pieces pp
    LEFT JOIN public.production_lot_items pli ON pli.id = pp.legacy_production_lot_item_id
    WHERE pp.material IS NULL 
       OR pp.color IS NULL 
       OR pp.thickness IS NULL 
       OR pp.width IS NULL 
       OR pp.length IS NULL 
       OR pp.route_steps IS NULL 
       OR array_length(pp.route_steps, 1) IS NULL
  LOOP
    v_material := COALESCE(r.material, r.pli_material);
    v_color := COALESCE(r.color, r.pli_color);
    v_thickness := COALESCE(r.thickness, r.pli_thickness);
    v_width := COALESCE(r.width, r.pli_width);
    v_height := COALESCE(r.height, r.pli_height);
    v_length := COALESCE(r.length, r.height, r.pli_height);

    -- Tentar buscar payload normalizado do pcp_import_rows pelo barcode
    SELECT 
      normalized_payload->>'material',
      normalized_payload->>'color',
      (normalized_payload->>'thickness')::numeric,
      (normalized_payload->>'width')::numeric,
      (normalized_payload->>'height')::numeric,
      normalized_payload->>'route'
    INTO 
      v_material, v_color, v_thickness, v_width, v_height, v_route_raw
    FROM public.pcp_import_rows
    WHERE barcode_raw = r.traceability_code 
       OR barcode_raw = r.piece_uid 
       OR barcode_normalized = r.traceability_code
    LIMIT 1;

    IF v_route_raw IS NOT NULL AND v_route_raw <> '' THEN
      v_route_steps := public.parse_pcp_route_tokens(v_route_raw);
    ELSE
      v_route_steps := COALESCE(r.route_steps, ARRAY['cut', 'edge', 'cnc', 'separation', 'packaging']);
    END IF;

    UPDATE public.production_pieces
    SET 
      material = COALESCE(v_material, r.material, 'MDF'),
      color = COALESCE(v_color, r.color, 'Padrão'),
      thickness = COALESCE(v_thickness, r.thickness, 15),
      width = COALESCE(v_width, r.width, 0),
      height = COALESCE(v_height, r.height, 0),
      length = COALESCE(v_length, v_height, r.length, 0),
      route_steps = v_route_steps,
      updated_at = now()
    WHERE id = r.piece_id;
  END LOOP;
END $$;

-- 2. EXPANDIR RESOLVEDOR CANÔNICO DE PEÇAS NO BANCO
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

  -- Busca por piece_uid, traceability_code, tag_value ou barcode em pcp_import_rows
  WITH matches AS (
    SELECT id FROM public.production_pieces
    WHERE piece_uid = v_normalized 
       OR traceability_code = v_normalized
       OR UPPER(piece_uid) = UPPER(v_normalized) 
       OR UPPER(traceability_code) = UPPER(v_normalized)
    UNION
    SELECT piece_id FROM public.production_tags
    WHERE (tag_value = v_normalized OR UPPER(tag_value) = UPPER(v_normalized)) 
      AND active = true AND piece_id IS NOT NULL
    UNION
    SELECT pp.id FROM public.pcp_import_rows pir
    JOIN public.production_pieces pp ON (pp.traceability_code = pir.barcode_raw OR pp.piece_uid = pir.barcode_raw)
    WHERE pir.barcode_raw = v_normalized OR pir.barcode_normalized = v_normalized
  )
  SELECT COUNT(*), (SELECT id FROM matches ORDER BY id LIMIT 1)
  INTO v_count, v_piece.id
  FROM matches;

  IF v_count = 0 THEN
    -- Busca fallback por ilike em traceability_code ou piece_uid
    SELECT id INTO v_piece.id FROM public.production_pieces
    WHERE traceability_code ILIKE '%' || v_normalized || '%' OR piece_uid ILIKE '%' || v_normalized || '%'
    ORDER BY created_at DESC LIMIT 1;
    
    IF v_piece.id IS NULL THEN
      RAISE EXCEPTION 'Peça não localizada para o identificador %', p_identifier USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id;
  RETURN v_piece;
END;
$$;

-- 3. GARANTIR POPULAÇÃO DE CAMPOS FÍSICOS NO COMMIT DO PCP IMPORT
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
  v_length numeric;
  v_environment text;
  v_module text;
  v_step text;
  v_order_seq integer := 1;
  v_inserted_pieces integer := 0;
  v_inserted_items integer := 0;
BEGIN
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

  -- 2. Resolver/Criar Lote de Produção
  SELECT id INTO v_lot_id FROM public.production_lots WHERE UPPER(lot_code) = UPPER(p_lot_code) LIMIT 1;
  IF v_lot_id IS NULL THEN
    INSERT INTO public.production_lots (
      lot_code, order_id, production_order_id, status, created_by, pcp_import_batch_id, customer_name
    ) VALUES (
      p_lot_code, v_order_id, v_order_id, 'planned', v_current_user, p_batch_id, p_customer
    ) RETURNING id INTO v_lot_id;
  ELSE
    UPDATE public.production_lots 
    SET status = 'planned', pcp_import_batch_id = p_batch_id, customer_name = COALESCE(customer_name, p_customer) 
    WHERE id = v_lot_id;
  END IF;

  -- 3. Processar cada linha de peça
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_barcode := TRIM(v_row->>'barcode');
    v_check_barcode := TRIM(v_row->>'checkBarcode');
    v_route := TRIM(v_row->>'route');
    v_piece_code := TRIM(v_row->>'pieceCode');
    v_piece_name := COALESCE(NULLIF(TRIM(v_row->>'pieceName'), ''), 'Sem Nome');
    v_quantity := GREATEST(COALESCE((v_row->>'quantity')::integer, 1), 1);
    v_material := COALESCE(NULLIF(TRIM(v_row->>'material'), ''), 'MDF');
    v_color := COALESCE(NULLIF(TRIM(v_row->>'color'), ''), 'Padrão');
    v_thickness := COALESCE((v_row->>'thickness')::numeric, 15);
    v_width := COALESCE((v_row->>'width')::numeric, 0);
    v_height := COALESCE((v_row->>'height')::numeric, 0);
    v_length := COALESCE(v_height, 0);
    v_environment := TRIM(v_row->>'environmentName');
    v_module := TRIM(v_row->>'moduleName');

    IF v_barcode IS NULL OR v_barcode = '' THEN
      CONTINUE;
    END IF;

    -- Parser de roteamento
    v_route_steps := public.parse_pcp_route_tokens(v_route);

    -- Inserir rota no production_routes se não existir
    v_order_seq := 1;
    FOREACH v_step IN ARRAY v_route_steps LOOP
      INSERT INTO public.production_routes (
        lot_id, step_name, step_order, required, status
      ) VALUES (
        v_lot_id, 
        COALESCE((SELECT name FROM public.routing_steps WHERE code = v_step), v_step),
        v_order_seq, 
        true, 
        'planned'
      ) ON CONFLICT DO NOTHING;
      v_order_seq := v_order_seq + 1;
    END LOOP;

    -- Unidades de peças
    FOR i IN 1..v_quantity LOOP
      DECLARE
        v_suffix text := CASE WHEN v_quantity > 1 THEN '-' || i::text ELSE '' END;
        v_piece_uid text := v_barcode || v_suffix;
        v_traceability text := v_barcode || v_suffix;
      BEGIN
        INSERT INTO public.pcp_import_rows (
          batch_id, row_number, raw_cells, normalized_payload, barcode_raw, barcode_normalized,
          validation_status, mapping_version, row_hash
        ) VALUES (
          p_batch_id, (v_row->>'row_number')::integer, v_row->'raw_cells', v_row, v_barcode, v_barcode,
          'valid', p_mapping_version, md5(v_row::text)
        );

        INSERT INTO public.production_lot_items (
          lot_id, product_code, product_name, quantity, status, current_step,
          material, color, width, height, thickness, created_by
        ) VALUES (
          v_lot_id, v_piece_code, v_piece_name, 1, 'planned', 'Importado',
          v_material, v_color, v_width, v_height, v_thickness, v_current_user
        ) RETURNING id INTO v_lot_item_id;
        
        v_inserted_items := v_inserted_items + 1;

        INSERT INTO public.production_pieces (
          piece_uid, traceability_code, production_order_id, lot_id,
          module_name, environment, piece_name, material, color,
          thickness, width, height, length,
          current_stage, status, source_origin,
          legacy_production_lot_item_id, route_steps, created_by
        ) VALUES (
          v_piece_uid, v_traceability, v_order_id, v_lot_id,
          v_module, v_environment, v_piece_name, v_material, v_color,
          v_thickness, v_width, v_height, v_length,
          COALESCE((SELECT name FROM public.routing_steps WHERE code = v_route_steps[1]), v_route_steps[1], 'Corte'), 
          'planned', 'xlsx',
          v_lot_item_id, v_route_steps, v_current_user
        ) ON CONFLICT (piece_uid) DO UPDATE SET
          material = EXCLUDED.material,
          color = EXCLUDED.color,
          thickness = EXCLUDED.thickness,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          length = EXCLUDED.length,
          route_steps = EXCLUDED.route_steps
        RETURNING id INTO v_piece_id;

        v_inserted_pieces := v_inserted_pieces + 1;
      END;
    END LOOP;
  END LOOP;

  -- Criar capas de cliente para o lote
  PERFORM public.create_customer_covers_for_batch(p_batch_id);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'lot_id', v_lot_id,
    'inserted_pieces', v_inserted_pieces,
    'inserted_items', v_inserted_items
  );
END;
$$;

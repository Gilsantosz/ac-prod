-- ============================================================
-- Migration 052: Baixa Automática em Cascata para Entradas Manuais PCP
-- Ao registrar um Lote Geral no PCP ou ao dar baixa na Embalagem,
-- o sistema gera automaticamente o volume produzido em todas as 4 células:
-- Corte, Bordo, Usinagem e Embalagem.
-- ============================================================

CREATE OR REPLACE FUNCTION public.register_manual_quantitative_production(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_general_lot_code text := UPPER(TRIM(COALESCE(p_payload->>'general_lot_code', p_payload->>'lote_geral', p_payload->>'lot_code', '')));
  v_cell_name text := TRIM(COALESCE(p_payload->>'cell_name', p_payload->>'celula', ''));
  v_shift text := COALESCE(NULLIF(TRIM(p_payload->>'shift'), ''), '1º Turno');
  v_operator text := COALESCE(NULLIF(TRIM(p_payload->>'operator'), ''), 'Operador Manual PCP');
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_unit_of_measure text := COALESCE(NULLIF(TRIM(p_payload->>'unit_of_measure'), ''), 'pecas');
  v_notes text := NULLIF(TRIM(COALESCE(p_payload->>'notes', p_payload->>'observacao', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_cascade boolean := COALESCE((p_payload->>'cascade_all_cells')::boolean, (p_payload->>'cascade')::boolean, LOWER(v_cell_name) = 'embalagem', false);
  
  v_lot_id uuid;
  v_piece_id uuid;
  v_reading_id uuid;
  v_event_id uuid;

  v_target_cells text[] := ARRAY['Corte', 'Bordo', 'Usinagem', 'Embalagem'];
  v_curr_cell text;
  v_created_readings jsonb := '[]'::jsonb;
BEGIN
  IF v_general_lot_code = '' THEN
    RAISE EXCEPTION 'O código do Lote Geral é obrigatório para lançamento manual PCP.';
  END IF;

  -- 1. Localiza ou cria o Lote Geral na tabela production_lots
  SELECT id INTO v_lot_id
  FROM public.production_lots
  WHERE UPPER(TRIM(lot_code)) = v_general_lot_code OR UPPER(TRIM(general_lot_code)) = v_general_lot_code
  LIMIT 1;

  IF v_lot_id IS NULL THEN
    INSERT INTO public.production_lots (
      lot_code,
      general_lot_code,
      total_items,
      status,
      created_at
    ) VALUES (
      v_general_lot_code,
      v_general_lot_code,
      v_quantity,
      'in_progress',
      now()
    )
    RETURNING id INTO v_lot_id;
  END IF;

  -- 2. Cria/Associa uma peça sintética de agrupamento para o lançamento manual do lote
  INSERT INTO public.production_pieces (
    lot_id,
    traceability_code,
    description,
    status,
    created_at
  ) VALUES (
    v_lot_id,
    v_general_lot_code || '-MANUAL-' || to_char(now(), 'HH24MISS'),
    'Lançamento Manual Quantitativo — ' || v_general_lot_code,
    'in_production',
    now()
  )
  RETURNING id INTO v_piece_id;

  -- 3. Se a opção de cascata for verdadeira ou for Embalagem, gera baixa para TODAS as 4 células
  IF v_cascade THEN
    FOREACH v_curr_cell IN ARRAY v_target_cells LOOP
      INSERT INTO public.production_stage_readings (
        piece_id,
        lot_id,
        cell_name,
        step_name,
        quantity,
        status,
        operator,
        shift,
        entry_type,
        traceability_type,
        is_manual,
        unit_of_measure,
        general_lot_code,
        notes,
        created_at
      ) VALUES (
        v_piece_id,
        v_lot_id,
        v_curr_cell,
        v_curr_cell,
        v_quantity,
        'approved',
        v_operator,
        v_shift,
        'manual_quantitativo',
        'quantitativa_simplificada',
        true,
        v_unit_of_measure,
        v_general_lot_code,
        COALESCE(v_notes, 'Baixa automática em cascata por Lote PCP ' || v_general_lot_code),
        (v_date || ' ' || to_char(now(), 'HH24:MI:SS'))::timestamptz
      )
      RETURNING id INTO v_reading_id;

      INSERT INTO public.production_collection_events (
        reading_id,
        piece_id,
        lot_id,
        cell_name,
        operator_name,
        shift,
        status,
        quantity,
        reader_type,
        entry_type,
        traceability_type,
        is_manual,
        unit_of_measure,
        general_lot_code,
        created_at
      ) VALUES (
        v_reading_id,
        v_piece_id,
        v_lot_id,
        v_curr_cell,
        v_operator,
        v_shift,
        'approved',
        v_quantity,
        'manual',
        'manual_quantitativo',
        'quantitativa_simplificada',
        true,
        v_unit_of_measure,
        v_general_lot_code,
        (v_date || ' ' || to_char(now(), 'HH24:MI:SS'))::timestamptz
      );
    END LOOP;
  ELSE
    -- Baixa em célula única
    INSERT INTO public.production_stage_readings (
      piece_id,
      lot_id,
      cell_name,
      step_name,
      quantity,
      status,
      operator,
      shift,
      entry_type,
      traceability_type,
      is_manual,
      unit_of_measure,
      general_lot_code,
      notes,
      created_at
    ) VALUES (
      v_piece_id,
      v_lot_id,
      COALESCE(NULLIF(v_cell_name, ''), 'Corte'),
      COALESCE(NULLIF(v_cell_name, ''), 'Corte'),
      v_quantity,
      'approved',
      v_operator,
      v_shift,
      'manual_quantitativo',
      'quantitativa_simplificada',
      true,
      v_unit_of_measure,
      v_general_lot_code,
      v_notes,
      (v_date || ' ' || to_char(now(), 'HH24:MI:SS'))::timestamptz
    )
    RETURNING id INTO v_reading_id;

    INSERT INTO public.production_collection_events (
      reading_id,
      piece_id,
      lot_id,
      cell_name,
      operator_name,
      shift,
      status,
      quantity,
      reader_type,
      entry_type,
      traceability_type,
      is_manual,
      unit_of_measure,
      general_lot_code,
      created_at
    ) VALUES (
      v_reading_id,
      v_piece_id,
      v_lot_id,
      COALESCE(NULLIF(v_cell_name, ''), 'Corte'),
      v_operator,
      v_shift,
      'approved',
      v_quantity,
      'manual',
      'manual_quantitativo',
      'quantitativa_simplificada',
      true,
      v_unit_of_measure,
      v_general_lot_code,
      (v_date || ' ' || to_char(now(), 'HH24:MI:SS'))::timestamptz
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', v_lot_id,
    'piece_id', v_piece_id,
    'general_lot_code', v_general_lot_code,
    'quantity', v_quantity,
    'unit_of_measure', v_unit_of_measure,
    'cascade', v_cascade,
    'target_cells', CASE WHEN v_cascade THEN v_target_cells ELSE ARRAY[v_cell_name] END,
    'is_manual', true
  );
END;
$$;

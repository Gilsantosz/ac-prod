-- ============================================================
-- Migration 051: Suporte a Entradas Manuais Quantitativas de Produção
-- Permite registrar baixas quantitativas agregadas por Lote Geral
-- com distinção visual de rastreabilidade (coleta_fisica vs manual_quantitativo)
-- ============================================================

-- 1. Novas colunas na tabela production_stage_readings
ALTER TABLE IF EXISTS public.production_stage_readings
  ADD COLUMN IF NOT EXISTS entry_type text DEFAULT 'coleta_fisica',
  ADD COLUMN IF NOT EXISTS traceability_type text DEFAULT 'unitaria',
  ADD COLUMN IF NOT EXISTS is_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_of_measure text DEFAULT 'pecas',
  ADD COLUMN IF NOT EXISTS general_lot_code text,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2. Novas colunas na tabela production_collection_events
ALTER TABLE IF EXISTS public.production_collection_events
  ADD COLUMN IF NOT EXISTS entry_type text DEFAULT 'coleta_fisica',
  ADD COLUMN IF NOT EXISTS traceability_type text DEFAULT 'unitaria',
  ADD COLUMN IF NOT EXISTS is_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_of_measure text DEFAULT 'pecas',
  ADD COLUMN IF NOT EXISTS general_lot_code text;

-- 3. Atualizar a View Canônica collection_stage_facts para incluir as colunas manuais
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
  COALESCE(l.general_lot_code, sr.general_lot_code, l.lot_code) AS general_lot_code,
  COALESCE(sr.entry_type, 'coleta_fisica') AS entry_type,
  COALESCE(sr.traceability_type, 'unitaria') AS traceability_type,
  COALESCE(sr.is_manual, false) AS is_manual,
  COALESCE(sr.unit_of_measure, 'pecas') AS unit_of_measure,
  COALESCE(sr.production_cycle, 1) AS production_cycle
FROM public.production_stage_readings sr
LEFT JOIN public.production_pieces p ON p.id = sr.piece_id
LEFT JOIN public.production_lots l ON l.id = sr.lot_id
WHERE sr.status = 'approved';

-- 4. Função RPC para registrar Baixa Manual Quantitativa
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
  v_operator text := COALESCE(NULLIF(TRIM(p_payload->>'operator'), ''), 'Manual Operator');
  v_operator_id uuid := NULL;
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_unit_of_measure text := COALESCE(NULLIF(TRIM(p_payload->>'unit_of_measure'), ''), 'pecas');
  v_notes text := NULLIF(TRIM(COALESCE(p_payload->>'notes', p_payload->>'observacao', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  
  v_lot_id uuid;
  v_piece_id uuid;
  v_reading_id uuid;
  v_event_id uuid;
BEGIN
  IF v_general_lot_code = '' THEN
    RAISE EXCEPTION 'O código do Lote Geral é obrigatório para lançamento manual.';
  END IF;

  IF v_cell_name = '' THEN
    RAISE EXCEPTION 'A célula produtiva é obrigatória para lançamento manual.';
  END IF;

  -- 4.1. Localiza ou cria o Lote Geral na tabela production_lots
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

  -- 4.2. Cria/Associa uma peça sintética de agrupamento para o lançamento manual
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

  -- 4.3. Insere a leitura de estágio como 'manual_quantitativo'
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
    v_cell_name,
    v_cell_name,
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

  -- 4.4. Insere o evento de coleta para reconciliação e estatísticas
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
    v_cell_name,
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
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'reading_id', v_reading_id,
    'event_id', v_event_id,
    'lot_id', v_lot_id,
    'piece_id', v_piece_id,
    'general_lot_code', v_general_lot_code,
    'cell_name', v_cell_name,
    'quantity', v_quantity,
    'unit_of_measure', v_unit_of_measure,
    'is_manual', true
  );
END;
$$;

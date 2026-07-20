-- ─── MIGRATION 048: PAGINA DE REPOSIÇÃO E ATRASOS ───
-- Criação do RPC para registrar finalizações avulsas de reposição e atrasos sem registro prévio
CREATE OR REPLACE FUNCTION public.register_independent_finish(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_piece_uid text := UPPER(TRIM(p_payload->>'piece_uid'));
  v_piece_name text := COALESCE(NULLIF(TRIM(p_payload->>'piece_name'), ''), 'Peça Avulsa / Sem Registro');
  v_lot_code text := UPPER(TRIM(COALESCE(p_payload->>'lot_code', 'LOT-AVULSO')));
  v_customer_name text := COALESCE(NULLIF(TRIM(p_payload->>'customer_name'), ''), 'Consumidor Final');
  v_cell_name text := COALESCE(NULLIF(TRIM(p_payload->>'cell_name'), ''), 'Coleta');
  v_operator_name text := COALESCE(NULLIF(TRIM(p_payload->>'operator_name'), ''), 'Operador');
  v_operator_id uuid := NULLIF(p_payload->>'operator_id', '')::uuid;
  v_notes text := COALESCE(NULLIF(TRIM(p_payload->>'notes'), ''), 'Finalização avulsa/atraso');
  
  v_lot record;
  v_piece record;
  v_order record;
  v_reading record;
  v_step_code text;
BEGIN
  -- 1. Verificar permissões
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','supervisor','operator') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Usuário sem permissão.');
  END IF;

  IF v_piece_uid = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Código de barras/UID inválido.');
  END IF;

  -- 2. Resolver ou Criar Lote Avulso se necessário
  SELECT * INTO v_lot FROM public.production_lots WHERE UPPER(lot_code) = v_lot_code LIMIT 1;
  IF v_lot.id IS NULL THEN
    -- Criar um novo pedido avulso para associar ao lote
    INSERT INTO public.production_orders (
      order_code, order_number, customer_name, status
    ) VALUES (
      v_lot_code, v_lot_code, v_customer_name, 'in_production'
    ) RETURNING * INTO v_order;
    
    INSERT INTO public.production_lots (
      lot_code, status, current_status, produced_quantity, approved_quantity, pending_quantity, progress_percent, production_order_id
    ) VALUES (
      v_lot_code, 'in_progress', 'in_progress', 0, 0, 1, 0, v_order.id
    ) RETURNING * INTO v_lot;
  ELSE
    SELECT * INTO v_order FROM public.production_orders WHERE id = v_lot.production_order_id;
  END IF;

  -- 3. Buscar peça existente
  SELECT * INTO v_piece FROM public.production_pieces WHERE piece_uid = v_piece_uid OR traceability_code = v_piece_uid LIMIT 1 FOR UPDATE;

  -- Resolver código da etapa
  SELECT code INTO v_step_code FROM public.routing_steps WHERE name = v_cell_name OR code = lower(v_cell_name) LIMIT 1;
  v_step_code := COALESCE(v_step_code, lower(v_cell_name));

  IF v_piece.id IS NOT NULL THEN
    -- Peça existe: atualizar status
    UPDATE public.production_pieces
    SET status = 'completed',
        is_replacement = true,
        replacement_status = 'in_production',
        completed_steps = array_append(array_remove(completed_steps, v_step_code), v_step_code),
        current_stage = 'Concluída',
        updated_at = now()
    WHERE id = v_piece.id
    RETURNING * INTO v_piece;
  ELSE
    -- Peça não existe: criar uma nova com status completed
    INSERT INTO public.production_pieces (
      piece_uid, traceability_code, piece_name, status, is_replacement, replacement_status,
      completed_steps, route_steps, current_stage, lot_id, production_order_id, environment
    ) VALUES (
      v_piece_uid, v_piece_uid, v_piece_name, 'completed', true, 'in_production',
      ARRAY[v_step_code], ARRAY[v_step_code], 'Concluída', v_lot.id, v_lot.production_order_id, 'Avulso'
    ) RETURNING * INTO v_piece;
  END IF;

  -- 4. Registrar leitura na etapa
  INSERT INTO public.production_stage_readings (
    lot_id, item_id, tag_value, reader_type, step_name, cell_name, operator, user_id, date, hour, status, event_type, quantity, notes,
    lot_code, customer_name, piece_code, production_order_id, is_rework
  ) VALUES (
    v_lot.id, v_piece.legacy_production_lot_item_id, v_piece_uid, 'manual', v_step_code, v_cell_name, v_operator_name, auth.uid(), current_date, to_char(now(), 'HH24:MI'), 'approved', 'approved_scan', 1, v_notes,
    v_lot.lot_code, v_customer_name, v_piece_uid, v_lot.production_order_id, false
  ) RETURNING * INTO v_reading;

  -- 5. Registrar entrada MES
  INSERT INTO public.production_entries (
    date, shift, cell, hour, produced, target, scrap, downtime, operator, notes, created_by,
    operator_id, order_id, production_order_id, lot_id, lot_code, customer_name, operation_name
  ) VALUES (
    current_date, 'Não informado', v_cell_name, to_char(now(), 'HH24:MI'), 1, 0, 0, 0, v_operator_name, v_notes, auth.uid(),
    v_operator_id, v_lot.production_order_id, v_lot.production_order_id, v_lot.id, v_lot.lot_code, v_customer_name, v_step_code
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Peça finalizada e registrada com sucesso como reposição!',
    'piece', to_jsonb(v_piece),
    'reading', to_jsonb(v_reading)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_independent_finish(jsonb) TO authenticated, anon;

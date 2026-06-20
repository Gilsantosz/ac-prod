-- ============================================================
-- AC.Prod - Test Helper para Rastreabilidade
-- Função para apagar dados de teste de forma limpa e em cascata.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_traceability_test_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_readings integer := 0;
  v_deleted_entries integer := 0;
  v_deleted_occurrences integer := 0;
  v_deleted_tags integer := 0;
  v_deleted_items integer := 0;
  v_deleted_routes integer := 0;
  v_deleted_lots integer := 0;
  v_deleted_orders integer := 0;
  v_deleted_logs integer := 0;
BEGIN
  -- 1. Verificar permissão (apenas admins e gestores)
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Usuário sem permissão para apagar dados de teste.');
  END IF;

  -- 2. Apagar leituras de produção vinculadas a tags de teste ou lotes de teste
  DELETE FROM production_stage_readings 
  WHERE tag_value LIKE 'BARCODE-TEST-%' 
     OR tag_value LIKE 'QRCODE-TEST-%' 
     OR tag_value LIKE 'RFID-TEST-%'
     OR lot_id IN (
       SELECT id FROM production_lots WHERE lot_code LIKE 'LOTE-TEST-%'
     );
  GET DIAGNOSTICS v_deleted_readings = ROW_COUNT;

  -- 3. Apagar ocorrências vinculadas aos lotes de teste
  DELETE FROM occurrences 
  WHERE notes LIKE '%LOTE-TEST-%' 
     OR notes LIKE '%PECA-TEST-%' 
     OR lot_id IN (
       SELECT id FROM production_lots WHERE lot_code LIKE 'LOTE-TEST-%'
     );
  GET DIAGNOSTICS v_deleted_occurrences = ROW_COUNT;

  -- 4. Apagar entradas de produção geradas automaticamente
  DELETE FROM production_entries 
  WHERE notes LIKE 'Coleta produtiva - tag BARCODE-TEST-%' 
     OR notes LIKE 'Coleta produtiva - tag QRCODE-TEST-%' 
     OR notes LIKE 'Coleta produtiva - tag RFID-TEST-%' 
     OR notes LIKE 'Reprovação vinculada a tag BARCODE-TEST-%'
     OR notes LIKE 'Reprovação vinculada a tag QRCODE-TEST-%'
     OR notes LIKE 'Reprovação vinculada a tag RFID-TEST-%'
     OR notes LIKE '%PECA-TEST-%' 
     OR notes LIKE '%LOTE-TEST-%';
  GET DIAGNOSTICS v_deleted_entries = ROW_COUNT;

  -- 5. Apagar logs de rastreabilidade
  DELETE FROM traceability_logs 
  WHERE details->>'tag' LIKE 'BARCODE-TEST-%' 
     OR details->>'tag' LIKE 'QRCODE-TEST-%' 
     OR details->>'tag' LIKE 'RFID-TEST-%'
     OR entity_id IN (
       SELECT id FROM production_lot_items WHERE item_code LIKE 'PECA-TEST-%'
     );
  GET DIAGNOSTICS v_deleted_logs = ROW_COUNT;

  -- 6. Apagar tags de teste
  DELETE FROM production_tags 
  WHERE tag_value LIKE 'BARCODE-TEST-%' 
     OR tag_value LIKE 'QRCODE-TEST-%' 
     OR tag_value LIKE 'RFID-TEST-%'
     OR lot_id IN (
       SELECT id FROM production_lots WHERE lot_code LIKE 'LOTE-TEST-%'
     );
  GET DIAGNOSTICS v_deleted_tags = ROW_COUNT;

  -- 7. Apagar itens do lote de teste
  DELETE FROM production_lot_items 
  WHERE item_code LIKE 'PECA-TEST-%' 
     OR lot_id IN (
       SELECT id FROM production_lots WHERE lot_code LIKE 'LOTE-TEST-%'
     );
  GET DIAGNOSTICS v_deleted_items = ROW_COUNT;

  -- 8. Apagar rotas de teste
  DELETE FROM production_routes 
  WHERE lot_id IN (
     SELECT id FROM production_lots WHERE lot_code LIKE 'LOTE-TEST-%'
  );
  GET DIAGNOSTICS v_deleted_routes = ROW_COUNT;

  -- 9. Apagar lotes de teste
  DELETE FROM production_lots 
  WHERE lot_code LIKE 'LOTE-TEST-%';
  GET DIAGNOSTICS v_deleted_lots = ROW_COUNT;

  -- 10. Apagar ordens de teste
  DELETE FROM production_orders 
  WHERE order_code LIKE 'ORDEM-TEST-%';
  GET DIAGNOSTICS v_deleted_orders = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Dados de teste limpos com sucesso.',
    'deleted_readings', v_deleted_readings,
    'deleted_entries', v_deleted_entries,
    'deleted_occurrences', v_deleted_occurrences,
    'deleted_tags', v_deleted_tags,
    'deleted_items', v_deleted_items,
    'deleted_routes', v_deleted_routes,
    'deleted_lots', v_deleted_lots,
    'deleted_orders', v_deleted_orders,
    'deleted_logs', v_deleted_logs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_traceability_test_data() TO authenticated;

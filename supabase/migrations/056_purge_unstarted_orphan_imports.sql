-- MIGRATION 056
-- Limpa registros antigos gerados por importações CSV/XLSX que foram apagadas antes da produção.
-- A limpeza só alcança peças sem lote PCP, sem leitura, sem coleta, sem entrada produtiva
-- e sem evento operacional. Eventos automáticos do tipo "note" não caracterizam produção.

DO $$
DECLARE
  v_piece_ids uuid[] := ARRAY[]::uuid[];
  v_lot_ids uuid[] := ARRAY[]::uuid[];
  v_order_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[])
  INTO v_piece_ids
  FROM public.production_pieces p
  JOIN public.production_lots lot ON lot.id = p.lot_id
  WHERE p.pcp_import_batch_id IS NULL
    AND lot.pcp_import_batch_id IS NULL
    AND p.source_origin IN ('csv', 'xlsx')
    AND NOT EXISTS (
      SELECT 1 FROM public.production_stage_readings reading
      WHERE reading.piece_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.production_collection_events event
      WHERE event.piece_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.production_entries entry
      WHERE entry.lot_id = p.lot_id
         OR entry.production_order_id = p.production_order_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.production_events event
      WHERE event.piece_id = p.id
        AND event.event_type <> 'note'
    );

  IF cardinality(v_piece_ids) = 0 THEN
    RETURN;
  END IF;

  -- Um lote só pode ser removido quando todas as suas peças pertencem ao conjunto órfão.
  SELECT COALESCE(array_agg(candidate.lot_id), ARRAY[]::uuid[])
  INTO v_lot_ids
  FROM (
    SELECT DISTINCT p.lot_id
    FROM public.production_pieces p
    WHERE p.id = ANY(v_piece_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.production_pieces other_piece
        WHERE other_piece.lot_id = p.lot_id
          AND NOT (other_piece.id = ANY(v_piece_ids))
      )
  ) candidate;

  -- Restringe novamente as peças aos lotes comprovadamente descartáveis.
  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[])
  INTO v_piece_ids
  FROM public.production_pieces p
  WHERE p.id = ANY(v_piece_ids)
    AND p.lot_id = ANY(v_lot_ids);

  SELECT COALESCE(array_agg(candidate.order_id), ARRAY[]::uuid[])
  INTO v_order_ids
  FROM (
    SELECT DISTINCT p.production_order_id AS order_id
    FROM public.production_pieces p
    WHERE p.id = ANY(v_piece_ids)
      AND p.production_order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.production_lots other_lot
        WHERE (
          other_lot.order_id = p.production_order_id
          OR other_lot.production_order_id = p.production_order_id
        )
          AND NOT (other_lot.id = ANY(v_lot_ids))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.production_pieces other_piece
        WHERE other_piece.production_order_id = p.production_order_id
          AND NOT (other_piece.id = ANY(v_piece_ids))
      )
  ) candidate;

  DELETE FROM public.quality_nonconformities
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.occurrences
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR order_id = ANY(v_order_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_collection_events
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_entries
  WHERE lot_id = ANY(v_lot_ids)
     OR order_id = ANY(v_order_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_events
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_stage_readings
  WHERE piece_id = ANY(v_piece_ids)
     OR lot_id = ANY(v_lot_ids)
     OR production_order_id = ANY(v_order_ids);

  DELETE FROM public.production_search_index
  WHERE entity_id = ANY(v_piece_ids)
     OR entity_id = ANY(v_lot_ids)
     OR entity_id = ANY(v_order_ids);

  DELETE FROM public.backup_files
  WHERE lot_id = ANY(v_lot_ids)
     OR order_id = ANY(v_order_ids);

  DELETE FROM public.production_pieces WHERE id = ANY(v_piece_ids);
  DELETE FROM public.production_lots WHERE id = ANY(v_lot_ids);
  DELETE FROM public.production_orders WHERE id = ANY(v_order_ids);
END;
$$;

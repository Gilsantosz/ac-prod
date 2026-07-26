-- Garante que leituras de reposição sejam vinculadas à peça substituta exata.
-- O vínculo por item do lote permanece apenas como fallback para leituras legadas.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_reading_to_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, extensions
AS $$
DECLARE
  v_piece_id uuid;
  v_tcode text;
  v_notes text;
BEGIN
  IF NEW.piece_id IS NOT NULL THEN
    SELECT
      p.id,
      COALESCE(NULLIF(NEW.piece_code, ''), NULLIF(NEW.tag_value, ''), p.traceability_code)
    INTO v_piece_id, v_tcode
    FROM public.production_pieces p
    WHERE p.id = NEW.piece_id
    LIMIT 1;
  END IF;

  IF v_piece_id IS NULL AND NEW.item_id IS NOT NULL THEN
    SELECT
      p.id,
      COALESCE(NULLIF(NEW.piece_code, ''), NULLIF(NEW.tag_value, ''), p.traceability_code)
    INTO v_piece_id, v_tcode
    FROM public.production_pieces p
    WHERE p.legacy_production_lot_item_id = NEW.item_id
    ORDER BY
      CASE WHEN p.id = NEW.piece_id THEN 0 ELSE 1 END,
      CASE WHEN COALESCE(p.is_replacement, false) THEN 0 ELSE 1 END,
      p.updated_at DESC,
      p.created_at DESC
    LIMIT 1;
  END IF;

  IF NEW.entry_type = 'baixa_reposicao' OR NEW.event_type = 'replacement_approval' THEN
    v_notes := 'Baixa por reposição';
  ELSE
    v_notes := 'Sincronizado via leitura legada';
  END IF;

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
      v_notes,
      NEW.id,
      NEW.created_at
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

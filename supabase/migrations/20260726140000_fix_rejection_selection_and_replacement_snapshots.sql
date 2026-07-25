-- ============================================================================
-- AC.Prod MES — estado canônico da reprovação e contexto da reposição
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Histórico: o badge representa o estado atual da peça, não apenas o
-- resultado da leitura antiga que originou o cartão.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_collection_history(
  p_cell_id uuid DEFAULT NULL,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_cell_name text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, event_id uuid, client_event_id text, created_at timestamptz,
  server_created_at timestamptz, processed_at timestamptz, date date, hour text,
  traceability_code text, raw_value text, piece_id uuid, piece_name text,
  pcp_import_batch_id uuid, pcp_batch_name text, lot_id uuid, lot_code text,
  order_number text, client_name text, current_stage_name text,
  operation_name text, operator_id uuid, operator_name text, registration text,
  cell_name text, machine_id uuid, machine_name text, station_name text,
  shift text, reader_type text, event_status text, result_status text,
  sync_status text, message text, route_steps text[], completed_steps text[],
  result_payload jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH history AS (
    SELECT
      e.id,
      e.id AS event_id,
      e.client_event_id,
      COALESCE(e.created_at_client, e.created_at) AS created_at,
      e.created_at AS server_created_at,
      e.processed_at,
      e.date,
      e.hour,
      COALESCE(NULLIF(e.piece_code, ''), p.traceability_code, p.piece_uid,
               NULLIF(e.normalized_value, ''), e.raw_value) AS traceability_code,
      e.raw_value,
      COALESCE(e.piece_id, sr.piece_id) AS piece_id,
      p.piece_name,
      COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id) AS pcp_import_batch_id,
      COALESCE(batch.general_lot_code, batch.file_name) AS pcp_batch_name,
      COALESCE(e.lot_id, sr.lot_id, p.lot_id) AS lot_id,
      COALESCE(NULLIF(e.lot_code, ''), NULLIF(sr.lot_code, ''),
               NULLIF(p.lot_code, ''), l.lot_code) AS lot_code,
      COALESCE(NULLIF(e.order_number, ''), NULLIF(sr.order_number, ''),
               NULLIF(p.order_number, ''), po.order_number, po.order_code) AS order_number,
      COALESCE(NULLIF(e.customer_name, ''), NULLIF(sr.customer_name, ''),
               NULLIF(p.customer_name, ''), po.customer_name) AS client_name,
      COALESCE(NULLIF(p.current_stage, ''), sr.step_name, e.operation_name,
               e.result_payload #>> '{route,step_name}') AS current_stage_name,
      COALESCE(e.operation_name, sr.operation_name, sr.step_name) AS operation_name,
      e.operator_id,
      COALESCE(e.operator_name, op.name, sr.operator) AS operator_name,
      COALESCE(e.registration, op.registration) AS registration,
      COALESCE(e.cell_name, sr.cell_name) AS cell_name,
      COALESCE(e.machine_id, sr.machine_id) AS machine_id,
      COALESCE(e.machine_name, sr.machine_name) AS machine_name,
      COALESCE(e.station_name, sr.station_name) AS station_name,
      COALESCE(e.shift, sr.shift) AS shift,
      e.reader_type,
      CASE
        WHEN p.status = 'blocked' THEN 'blocked'
        WHEN p.status IN ('rejected', 'replacement_requested')
          OR p.replacement_status = 'requested' THEN 'rejected'
        WHEN p.status IN ('rework', 'rework_pending', 'rework_in_progress') THEN 'rework'
        WHEN p.status = 'replaced' OR p.replacement_status = 'replaced' THEN 'replaced'
        WHEN e.result_status = 'approved' THEN 'approved'
        WHEN e.result_status = 'rejected' THEN 'rejected'
        WHEN e.result_status = 'duplicated' THEN 'duplicated'
        WHEN e.result_status IN ('blocked', 'wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        WHEN e.status = 'error' THEN 'error'
        WHEN e.status = 'synced' THEN 'approved'
        ELSE COALESCE(NULLIF(e.result_status, ''), e.status)
      END AS event_status,
      e.result_status,
      e.status AS sync_status,
      COALESCE(e.result_payload->>'message', e.error_message) AS message,
      COALESCE(p.route_steps, '{}'::text[]) AS route_steps,
      COALESCE(p.completed_steps, '{}'::text[]) AS completed_steps,
      e.result_payload
    FROM public.production_collection_events e
    LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
    LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
    LEFT JOIN public.promob_import_batches batch
      ON batch.id = COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id)
    LEFT JOIN public.production_lots l
      ON l.id = COALESCE(e.lot_id, sr.lot_id, p.lot_id)
    LEFT JOIN public.production_orders po
      ON po.id = COALESCE(e.production_order_id, p.production_order_id,
                          l.production_order_id, l.order_id)
    LEFT JOIN public.operators op ON op.id = e.operator_id
    WHERE (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''))) = lower(trim(p_cell_name)))
      AND (p_cell_id IS NULL OR EXISTS (
        SELECT 1 FROM public.cells c
        WHERE c.id = p_cell_id
          AND lower(trim(c.name)) = lower(trim(COALESCE(e.cell_name, sr.cell_name, '')))
      ))
      AND (p_workstation_id IS NULL OR COALESCE(e.machine_id, sr.machine_id) = p_workstation_id)
      AND (p_operator_id IS NULL OR e.operator_id = p_operator_id)
      AND (p_shift IS NULL OR COALESCE(e.shift, sr.shift) = p_shift)
      AND (p_lot_id IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = p_lot_id)
      AND (p_date_from IS NULL OR COALESCE(e.created_at_client, e.created_at) >= p_date_from)
      AND (p_date_to IS NULL OR COALESCE(e.created_at_client, e.created_at) <= p_date_to)
  )
  SELECT * FROM history h
  WHERE p_status IS NULL OR h.event_status = p_status
  ORDER BY h.created_at DESC, h.server_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_collection_history_count(
  p_cell_id uuid DEFAULT NULL,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_cell_name text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)
  FROM public.production_collection_events e
  LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
  LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
  WHERE (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''))) = lower(trim(p_cell_name)))
    AND (p_cell_id IS NULL OR EXISTS (
      SELECT 1 FROM public.cells c
      WHERE c.id = p_cell_id
        AND lower(trim(c.name)) = lower(trim(COALESCE(e.cell_name, sr.cell_name, '')))
    ))
    AND (p_workstation_id IS NULL OR COALESCE(e.machine_id, sr.machine_id) = p_workstation_id)
    AND (p_operator_id IS NULL OR e.operator_id = p_operator_id)
    AND (p_shift IS NULL OR COALESCE(e.shift, sr.shift) = p_shift)
    AND (p_lot_id IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = p_lot_id)
    AND (p_date_from IS NULL OR COALESCE(e.created_at_client, e.created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(e.created_at_client, e.created_at) <= p_date_to)
    AND (
      p_status IS NULL OR
      CASE
        WHEN p.status = 'blocked' THEN 'blocked'
        WHEN p.status IN ('rejected', 'replacement_requested')
          OR p.replacement_status = 'requested' THEN 'rejected'
        WHEN p.status IN ('rework', 'rework_pending', 'rework_in_progress') THEN 'rework'
        WHEN p.status = 'replaced' OR p.replacement_status = 'replaced' THEN 'replaced'
        WHEN e.result_status = 'approved' THEN 'approved'
        WHEN e.result_status = 'rejected' THEN 'rejected'
        WHEN e.result_status = 'duplicated' THEN 'duplicated'
        WHEN e.result_status IN ('blocked', 'wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        WHEN e.status = 'error' THEN 'error'
        WHEN e.status = 'synced' THEN 'approved'
        ELSE COALESCE(NULLIF(e.result_status, ''), e.status)
      END = p_status
    );
$$;

-- --------------------------------------------------------------------------
-- 2. Toda ordem de reposição recebe automaticamente o contexto canônico da
-- peça, do lote, do pedido e da leitura que foi reprovada.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enrich_replacement_order_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_piece public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_order public.production_orders%ROWTYPE;
  v_event public.production_collection_events%ROWTYPE;
  v_stage text;
  v_general_lot text;
BEGIN
  IF NEW.original_piece_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_piece
  FROM public.production_pieces
  WHERE id = NEW.original_piece_id;
  IF v_piece.id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = COALESCE(v_piece.production_order_id, v_lot.production_order_id, v_lot.order_id);
  SELECT * INTO v_event
  FROM public.production_collection_events
  WHERE piece_id = v_piece.id
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT r.step_name INTO v_stage
  FROM public.production_stage_readings r
  WHERE r.piece_id = v_piece.id
    AND r.status IN ('pending_review', 'rejected', 'approved')
  ORDER BY CASE r.status WHEN 'pending_review' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
           r.created_at DESC
  LIMIT 1;

  v_general_lot := NULLIF(v_event.general_lot_code, '');
  IF v_general_lot IS NULL AND v_piece.pcp_import_batch_id IS NOT NULL THEN
    SELECT general_lot_code INTO v_general_lot
    FROM public.promob_import_batches
    WHERE id = v_piece.pcp_import_batch_id;
  END IF;

  NEW.lot_id := COALESCE(NEW.lot_id, v_piece.lot_id);
  NEW.production_order_id := COALESCE(NEW.production_order_id, v_piece.production_order_id,
                                      v_lot.production_order_id, v_lot.order_id);
  NEW.lot_code := COALESCE(NULLIF(NEW.lot_code, ''), NULLIF(v_piece.lot_code, ''),
                           NULLIF(v_event.lot_code, ''), v_lot.lot_code);
  NEW.general_lot_code := COALESCE(NULLIF(NEW.general_lot_code, ''), v_general_lot);
  NEW.order_number := COALESCE(NULLIF(NEW.order_number, ''), NULLIF(v_piece.order_number, ''),
                                NULLIF(v_event.order_number, ''), v_order.order_number, v_order.order_code);
  NEW.customer_name := COALESCE(NULLIF(NEW.customer_name, ''), NULLIF(v_piece.customer_name, ''),
                                 NULLIF(v_event.customer_name, ''), v_order.customer_name);
  NEW.environment_name := COALESCE(NULLIF(NEW.environment_name, ''),
                                    NULLIF(v_piece.environment_name, ''),
                                    NULLIF(v_piece.environment, ''),
                                    NULLIF(v_event.environment_name, ''), 'Geral / Produção');
  NEW.operator_id := COALESCE(NEW.operator_id, v_event.operator_id);
  NEW.operator_name := COALESCE(NULLIF(NEW.operator_name, ''), NULLIF(v_event.operator_name, ''));
  NEW.origin_cell_name := COALESCE(NULLIF(NEW.origin_cell_name, ''), NULLIF(v_event.cell_name, ''));
  NEW.rejection_stage := CASE
    WHEN NEW.rejection_stage IS NULL
      OR lower(NEW.rejection_stage) IN ('concluída', 'concluida', 'completed', 'created')
      THEN COALESCE(NULLIF(v_stage, ''), NULLIF(v_event.operation_name, ''),
                    NULLIF(v_piece.current_stage, ''), 'Corte')
    ELSE NEW.rejection_stage
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrich_replacement_order_context ON public.replacement_orders;
CREATE TRIGGER trg_enrich_replacement_order_context
BEFORE INSERT OR UPDATE OF original_piece_id, lot_id, production_order_id,
  lot_code, general_lot_code, order_number, customer_name, environment_name,
  operator_id, operator_name, origin_cell_name, rejection_stage
ON public.replacement_orders
FOR EACH ROW EXECUTE FUNCTION public.enrich_replacement_order_context();

-- --------------------------------------------------------------------------
-- 3. Uma leitura reprovada nunca pode herdar event_type de aprovação e deve
-- carregar os mesmos snapshots usados pelo histórico e pela reposição.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enrich_rejected_reading_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_piece public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_order public.production_orders%ROWTYPE;
  v_event public.production_collection_events%ROWTYPE;
BEGIN
  IF NEW.status <> 'rejected' OR NEW.piece_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_piece FROM public.production_pieces WHERE id = NEW.piece_id;
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = COALESCE(v_piece.production_order_id, v_lot.production_order_id, v_lot.order_id);
  SELECT * INTO v_event
  FROM public.production_collection_events
  WHERE piece_id = v_piece.id
  ORDER BY created_at DESC
  LIMIT 1;

  NEW.event_type := 'rejected_scan';
  NEW.tag_value := COALESCE(NULLIF(NEW.tag_value, ''), v_piece.traceability_code, v_piece.piece_uid);
  NEW.piece_code := COALESCE(NULLIF(NEW.piece_code, ''), v_piece.piece_code,
                             v_piece.traceability_code, v_piece.piece_uid);
  NEW.lot_id := COALESCE(NEW.lot_id, v_piece.lot_id);
  NEW.production_order_id := COALESCE(NEW.production_order_id, v_piece.production_order_id,
                                      v_lot.production_order_id, v_lot.order_id);
  NEW.lot_code := COALESCE(NULLIF(NEW.lot_code, ''), NULLIF(v_piece.lot_code, ''),
                           NULLIF(v_event.lot_code, ''), v_lot.lot_code);
  NEW.order_number := COALESCE(NULLIF(NEW.order_number, ''), NULLIF(v_piece.order_number, ''),
                                NULLIF(v_event.order_number, ''), v_order.order_number, v_order.order_code);
  NEW.customer_name := COALESCE(NULLIF(NEW.customer_name, ''), NULLIF(v_piece.customer_name, ''),
                                 NULLIF(v_event.customer_name, ''), v_order.customer_name);
  NEW.environment_name := COALESCE(NULLIF(NEW.environment_name, ''),
                                    NULLIF(v_piece.environment_name, ''),
                                    NULLIF(v_piece.environment, ''),
                                    NULLIF(v_event.environment_name, ''), 'Geral / Produção');
  NEW.step_name := COALESCE(NULLIF(NEW.step_name, ''), NULLIF(v_event.operation_name, ''),
                            NULLIF(v_piece.current_stage, ''), 'Coleta');
  NEW.operation_name := COALESCE(NULLIF(NEW.operation_name, ''), NEW.step_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrich_rejected_reading_context ON public.production_stage_readings;
CREATE TRIGGER trg_enrich_rejected_reading_context
BEFORE INSERT OR UPDATE OF status, piece_id
ON public.production_stage_readings
FOR EACH ROW EXECUTE FUNCTION public.enrich_rejected_reading_context();

-- --------------------------------------------------------------------------
-- 4. Quando uma aprovação vira pending_review por reprovação, o lançamento
-- produtivo ligado ao ledger também é estornado.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reverse_production_entry_after_rejection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  IF NEW.status <> 'pending_review' OR OLD.status <> 'approved' THEN RETURN NEW; END IF;

  v_entry_id := NEW.production_entry_id;
  IF v_entry_id IS NULL THEN
    SELECT production_entry_id INTO v_entry_id
    FROM public.production_collection_events
    WHERE reading_id = NEW.id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_entry_id IS NOT NULL THEN
    UPDATE public.production_entries
    SET approval_status = 'reversed',
        correction_reason = COALESCE(NULLIF(correction_reason, ''),
          'Estorno automático: leitura colocada em revisão por reprovação'),
        corrected_by = COALESCE(NULLIF(corrected_by, ''), 'quality_rejection'),
        corrected_at = COALESCE(corrected_at, now())
    WHERE id = v_entry_id
      AND approval_status IS DISTINCT FROM 'reversed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_production_entry_after_rejection ON public.production_stage_readings;
CREATE TRIGGER trg_reverse_production_entry_after_rejection
AFTER UPDATE OF status ON public.production_stage_readings
FOR EACH ROW EXECUTE FUNCTION public.reverse_production_entry_after_rejection();

-- --------------------------------------------------------------------------
-- 5. Backfill auditável dos registros já existentes.
-- --------------------------------------------------------------------------

UPDATE public.production_stage_readings
SET event_type = 'rejected_scan'
WHERE status = 'rejected'
  AND event_type IS DISTINCT FROM 'rejected_scan';

-- Dispara o trigger de enriquecimento sem alterar o conteúdo funcional da ordem.
UPDATE public.replacement_orders
SET original_piece_id = original_piece_id;

UPDATE public.quality_nonconformities nc
SET lot_id = COALESCE(nc.lot_id, p.lot_id),
    production_order_id = COALESCE(nc.production_order_id, p.production_order_id,
                                   l.production_order_id, l.order_id),
    lot_code = COALESCE(NULLIF(nc.lot_code, ''), NULLIF(p.lot_code, ''),
                        NULLIF(e.lot_code, ''), l.lot_code),
    order_number = COALESCE(NULLIF(nc.order_number, ''), NULLIF(p.order_number, ''),
                            NULLIF(e.order_number, ''), po.order_number, po.order_code),
    customer_name = COALESCE(NULLIF(nc.customer_name, ''), NULLIF(p.customer_name, ''),
                             NULLIF(e.customer_name, ''), po.customer_name),
    environment_name = COALESCE(NULLIF(nc.environment_name, ''),
                                NULLIF(p.environment_name, ''), NULLIF(p.environment, ''),
                                NULLIF(e.environment_name, ''), 'Geral / Produção'),
    stage_name = CASE
      WHEN nc.stage_name IS NULL
        OR lower(nc.stage_name) IN ('concluída', 'concluida', 'completed', 'created')
        THEN COALESCE(NULLIF(r.step_name, ''), NULLIF(e.operation_name, ''),
                      NULLIF(p.current_stage, ''), 'Corte')
      ELSE nc.stage_name
    END,
    operator_id = COALESCE(nc.operator_id, e.operator_id),
    operator_name = COALESCE(NULLIF(nc.operator_name, ''), NULLIF(e.operator_name, '')),
    cell_name = COALESCE(NULLIF(nc.cell_name, ''), NULLIF(e.cell_name, '')),
    updated_at = now()
FROM public.production_pieces p
LEFT JOIN public.production_lots l ON l.id = p.lot_id
LEFT JOIN public.production_orders po
  ON po.id = COALESCE(p.production_order_id, l.production_order_id, l.order_id)
LEFT JOIN LATERAL (
  SELECT ev.* FROM public.production_collection_events ev
  WHERE ev.piece_id = p.id ORDER BY ev.created_at DESC LIMIT 1
) e ON true
LEFT JOIN LATERAL (
  SELECT rd.step_name FROM public.production_stage_readings rd
  WHERE rd.piece_id = p.id AND rd.status IN ('pending_review', 'rejected', 'approved')
  ORDER BY CASE rd.status WHEN 'pending_review' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
           rd.created_at DESC LIMIT 1
) r ON true
WHERE nc.piece_id = p.id;

UPDATE public.production_entries pe
SET approval_status = 'reversed',
    correction_reason = COALESCE(NULLIF(pe.correction_reason, ''),
      'Estorno retroativo: peça atualmente reprovada'),
    corrected_by = COALESCE(NULLIF(pe.corrected_by, ''), 'migration_rejection_consistency'),
    corrected_at = COALESCE(pe.corrected_at, now())
FROM public.production_collection_events e
JOIN public.production_stage_readings r ON r.id = e.reading_id
JOIN public.production_pieces p ON p.id = e.piece_id
WHERE pe.id = e.production_entry_id
  AND p.status IN ('rejected', 'replacement_requested')
  AND r.status = 'pending_review'
  AND pe.approval_status IS DISTINCT FROM 'reversed';

REVOKE ALL ON FUNCTION public.get_collection_history(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamptz,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_collection_history_count(uuid,uuid,uuid,text,text,uuid,timestamptz,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enrich_replacement_order_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enrich_rejected_reading_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_production_entry_after_rejection() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_collection_history(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamptz,timestamptz,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_collection_history_count(uuid,uuid,uuid,text,text,uuid,timestamptz,timestamptz,text) TO authenticated, service_role;

COMMIT;

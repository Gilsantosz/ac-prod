-- ============================================================================
-- AC.Prod MES — backfill final de snapshots e etapa das leituras reprovadas
-- ============================================================================

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
      COALESCE(NULLIF(sr.step_name, ''), NULLIF(e.operation_name, ''),
               NULLIF(p.current_stage, ''), e.result_payload #>> '{route,step_name}') AS current_stage_name,
      COALESCE(NULLIF(sr.operation_name, ''), NULLIF(e.operation_name, ''), sr.step_name) AS operation_name,
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

UPDATE public.production_stage_readings r
SET status = r.status,
    step_name = CASE
      WHEN r.step_name IS NULL
        OR lower(r.step_name) IN ('concluída', 'concluida', 'completed', 'created')
      THEN COALESCE(
        (SELECT prior.step_name
         FROM public.production_stage_readings prior
         WHERE prior.piece_id = r.piece_id
           AND prior.id <> r.id
           AND prior.status = 'pending_review'
         ORDER BY prior.created_at DESC
         LIMIT 1),
        (SELECT ev.operation_name
         FROM public.production_collection_events ev
         WHERE ev.piece_id = r.piece_id
         ORDER BY ev.created_at DESC
         LIMIT 1),
        'Coleta'
      )
      ELSE r.step_name
    END,
    operation_name = CASE
      WHEN r.operation_name IS NULL
        OR lower(r.operation_name) IN ('concluída', 'concluida', 'completed', 'created')
      THEN COALESCE(
        (SELECT prior.step_name
         FROM public.production_stage_readings prior
         WHERE prior.piece_id = r.piece_id
           AND prior.id <> r.id
           AND prior.status = 'pending_review'
         ORDER BY prior.created_at DESC
         LIMIT 1),
        (SELECT ev.operation_name
         FROM public.production_collection_events ev
         WHERE ev.piece_id = r.piece_id
         ORDER BY ev.created_at DESC
         LIMIT 1),
        'Coleta'
      )
      ELSE r.operation_name
    END
WHERE r.status = 'rejected';

REVOKE ALL ON FUNCTION public.get_collection_history(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamptz,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_collection_history(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamptz,timestamptz,text) TO authenticated, service_role;

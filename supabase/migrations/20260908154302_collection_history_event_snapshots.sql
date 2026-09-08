-- Histórico de coleta: decisão e etapa são snapshots do evento.
-- A peça atual permanece disponível no enriquecimento da interface.
-- Não altera dados, assinatura, wrappers de autorização, ownership ou ACL.
-- Executar em transação; a ferramenta de migrations fornece a transação.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE r record; v_oid regprocedure;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_collection_history_count_impl(uuid,uuid,uuid,text,text,uuid,timestamp with time zone,timestamp with time zone,text)', 'a93575476d61fd4375ae427c61a7805b', '{postgres=X/postgres,service_role=X/postgres}', 'postgres'),
    ('public.get_collection_history_impl(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone,text)', '88ac58db6a517328a87078616f75253d', '{postgres=X/postgres,service_role=X/postgres}', 'postgres')
  ) AS baseline(signature, expected_hash, expected_acl, expected_owner)
  LOOP
    v_oid := to_regprocedure(r.signature);
    IF v_oid IS NULL
      OR md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM r.expected_hash
      OR (SELECT proacl::text FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM r.expected_acl
      OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM r.expected_owner
    THEN RAISE EXCEPTION 'COLLECTION_HISTORY_BASELINE_CHANGED: %', r.signature;
    END IF;
  END LOOP;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.get_collection_history_impl(p_cell_id uuid DEFAULT NULL::uuid, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_lot_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cell_name text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, event_id uuid, client_event_id text, created_at timestamp with time zone, server_created_at timestamp with time zone, processed_at timestamp with time zone, date date, hour text, traceability_code text, raw_value text, piece_id uuid, piece_name text, pcp_import_batch_id uuid, pcp_batch_name text, lot_id uuid, lot_code text, order_number text, client_name text, current_stage_name text, operation_name text, operator_id uuid, operator_name text, registration text, cell_name text, machine_id uuid, machine_name text, station_name text, shift text, reader_type text, event_status text, result_status text, sync_status text, message text, route_steps text[], completed_steps text[], result_payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(NULLIF(e.operation_name, ''),
               NULLIF(e.result_payload #>> '{route,step_name}', ''),
               NULLIF(e.result_payload #>> '{result,route,step_name}', ''),
               NULLIF(sr.step_name, ''), NULLIF(sr.operation_name, ''),
               NULLIF(e.cell_name, ''), NULLIF(sr.cell_name, '')) AS current_stage_name,
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
        -- Uma reposição é um evento próprio, nunca a reclassificação retroativa
        -- das leituras da peça original que foi substituída.
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) = 'approved'
          AND COALESCE(NULLIF(e.result_payload->>'entry_type', ''),
          NULLIF(e.result_payload->>'source', ''),
          NULLIF(e.result_payload #>> '{result,entry_type}', '')) IN ('baixa_reposicao', 'replacement_approval')
          THEN 'approved_via_replacement'
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) IN ('wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        ELSE COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status)
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
  WHERE
    -- Filtro: 'approved' inclui tanto 'approved' quanto 'approved_via_replacement'
    CASE
      WHEN p_status = 'approved' THEN h.event_status IN ('approved', 'approved_via_replacement')
      WHEN p_status IS NULL THEN true
      ELSE h.event_status = p_status
    END
  ORDER BY h.created_at DESC, h.server_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_collection_history_count_impl(p_cell_id uuid DEFAULT NULL::uuid, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_lot_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cell_name text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH history AS (
  SELECT CASE
        -- Uma reposição é um evento próprio, nunca a reclassificação retroativa
        -- das leituras da peça original que foi substituída.
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) = 'approved'
          AND COALESCE(NULLIF(e.result_payload->>'entry_type', ''),
          NULLIF(e.result_payload->>'source', ''),
          NULLIF(e.result_payload #>> '{result,entry_type}', '')) IN ('baixa_reposicao', 'replacement_approval')
          THEN 'approved_via_replacement'
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) IN ('wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        ELSE COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status)
      END AS event_status
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
  )
  SELECT count(*) FROM history h
  WHERE CASE
    WHEN p_status = 'approved' THEN h.event_status IN ('approved', 'approved_via_replacement')
    WHEN p_status IS NULL THEN true
    ELSE h.event_status = p_status
  END;
$function$;


DO $postcheck$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_collection_history_count_impl(uuid,uuid,uuid,text,text,uuid,timestamp with time zone,timestamp with time zone,text)', 'a93575476d61fd4375ae427c61a7805b', '{postgres=X/postgres,service_role=X/postgres}', 'postgres'),
    ('public.get_collection_history_impl(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone,text)', '88ac58db6a517328a87078616f75253d', '{postgres=X/postgres,service_role=X/postgres}', 'postgres')
  ) AS baseline(signature, expected_hash, expected_acl, expected_owner)
  LOOP
    IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.signature)) IS DISTINCT FROM r.expected_acl
      OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = to_regprocedure(r.signature)) IS DISTINCT FROM r.expected_owner
    THEN RAISE EXCEPTION 'COLLECTION_HISTORY_PRIVILEGES_CHANGED: %', r.signature;
    END IF;
  END LOOP;
END;
$postcheck$;

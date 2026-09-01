-- AC.Prod Collection Fabric v3 — PGMQ logged queues e ingresso set-based.

SET check_function_bodies = on;

CREATE EXTENSION IF NOT EXISTS pgmq;

DO $queues$
DECLARE
  v_queue text;
BEGIN
  FOREACH v_queue IN ARRAY ARRAY[
    'collection_live_v3',
    'collection_replay_v3',
    'collection_projection_v3',
    'collection_dead_letter_v3'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pgmq.list_queues() queue
      WHERE queue.queue_name = v_queue
    ) THEN
      PERFORM pgmq.create(v_queue);
    END IF;
  END LOOP;
END;
$queues$;

REVOKE ALL ON SCHEMA pgmq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO service_role;

DO $pgmq_public$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgmq_public') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pgmq_public FROM PUBLIC, anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM PUBLIC, anon, authenticated';
  END IF;
END;
$pgmq_public$;

CREATE OR REPLACE FUNCTION private.try_collection_uuid_v3(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN nullif(btrim(p_value), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.try_collection_bigint_v3(p_value text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN nullif(btrim(p_value), '')::bigint;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.try_collection_timestamptz_v3(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN nullif(btrim(p_value), '')::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.try_collection_uuid_v3(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.try_collection_bigint_v3(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.try_collection_timestamptz_v3(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ingest_collection_batch_v3(
  p_batch_id uuid,
  p_device_id uuid,
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pgmq, realtime, pg_temp
AS $$
DECLARE
  v_auth_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_event_array jsonb;
  v_event_count integer;
  v_payload_bytes integer;
  v_session_id uuid;
  v_source_mode text;
  v_app_version text;
  v_session public.operator_sessions%ROWTYPE;
  v_cell_name text;
  v_machine_name text;
  v_rollout_scope jsonb;
  v_ingress_enabled boolean := false;
  v_broadcast_enabled boolean := false;
  v_queue_name text;
  v_oldest_capture timestamptz;
  v_newest_capture timestamptz;
  v_row record;
  v_message_id bigint;
  v_results jsonb;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATED_EDGE_SESSION_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_batch_id IS NULL OR p_device_id IS NULL THEN
    RAISE EXCEPTION 'BATCH_AND_DEVICE_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_events) <> 'object'
     OR jsonb_typeof(p_events -> 'events') <> 'array' THEN
    RAISE EXCEPTION 'COLLECTION_BATCH_ENVELOPE_INVALID'
      USING ERRCODE = '22023',
            HINT = 'p_events deve conter operator_session_id, source_mode e events[].';
  END IF;

  v_event_array := p_events -> 'events';
  v_event_count := jsonb_array_length(v_event_array);
  v_payload_bytes := octet_length(p_events::text);

  IF v_event_count < 1 OR v_event_count > 25 THEN
    RAISE EXCEPTION 'COLLECTION_BATCH_SIZE_INVALID'
      USING ERRCODE = '22023',
            DETAIL = format('Eventos recebidos: %s; limite: 25.', v_event_count);
  END IF;

  IF v_payload_bytes > 262144 THEN
    RAISE EXCEPTION 'COLLECTION_BATCH_PAYLOAD_TOO_LARGE'
      USING ERRCODE = '22023',
            DETAIL = format('Payload: %s bytes; limite: 262144.', v_payload_bytes);
  END IF;

  v_session_id := private.try_collection_uuid_v3(p_events ->> 'operator_session_id');
  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_ID_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  v_source_mode := lower(coalesce(nullif(btrim(p_events ->> 'source_mode'), ''), 'live'));
  IF v_source_mode NOT IN ('live', 'offline_replay') THEN
    RAISE EXCEPTION 'COLLECTION_SOURCE_MODE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_app_version := left(nullif(btrim(p_events ->> 'app_version'), ''), 64);
  v_queue_name := CASE
    WHEN v_source_mode = 'offline_replay' THEN 'collection_replay_v3'
    ELSE 'collection_live_v3'
  END;

  SELECT flag.enabled, flag.rollout_scope
  INTO v_ingress_enabled, v_rollout_scope
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_ingress';

  IF NOT coalesce(v_ingress_enabled, false) THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_V3_INGRESS_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(flag.enabled, false)
  INTO v_broadcast_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_broadcast';

  CREATE TEMP TABLE pg_temp.collection_v3_ingress_input (
    ordinal integer PRIMARY KEY,
    client_event_id text,
    raw_value text,
    normalized_value text,
    reader_type text,
    captured_at_client timestamptz,
    device_sequence bigint,
    quantity integer,
    safe_payload jsonb,
    error_code text,
    receipt_id uuid,
    inserted boolean NOT NULL DEFAULT false,
    is_batch_duplicate boolean NOT NULL DEFAULT false,
    queue_message_id bigint
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.collection_v3_ingress_input (
    ordinal,
    client_event_id,
    raw_value,
    normalized_value,
    reader_type,
    captured_at_client,
    device_sequence,
    quantity,
    safe_payload,
    error_code
  )
  WITH parsed AS (
    SELECT
      event.ordinality::integer AS ordinal,
      event.value,
      nullif(btrim(event.value ->> 'client_event_id'), '') AS client_event_id,
      btrim(coalesce(
        event.value ->> 'raw_value',
        event.value ->> 'rawValue',
        event.value ->> 'tag_lida',
        event.value ->> 'tagValue',
        ''
      )) AS raw_value,
      lower(coalesce(
        nullif(btrim(event.value ->> 'reader_type'), ''),
        nullif(btrim(event.value ->> 'readerType'), ''),
        'keyboard_barcode'
      )) AS reader_type,
      private.try_collection_timestamptz_v3(coalesce(
        event.value ->> 'captured_at_client',
        event.value ->> 'created_at_client',
        event.value ->> 'capturedAtClient'
      )) AS captured_at_client,
      private.try_collection_bigint_v3(event.value ->> 'device_sequence') AS device_sequence,
      greatest(1, least(coalesce(
        private.try_collection_bigint_v3(event.value ->> 'quantity'),
        1
      ), 100))::integer AS quantity
    FROM jsonb_array_elements(v_event_array) WITH ORDINALITY AS event(value, ordinality)
  )
  SELECT
    parsed.ordinal,
    parsed.client_event_id,
    parsed.raw_value,
    public.normalize_collection_scan_code(parsed.raw_value),
    parsed.reader_type,
    parsed.captured_at_client,
    parsed.device_sequence,
    parsed.quantity,
    jsonb_strip_nulls(jsonb_build_object(
      'reader_type', parsed.reader_type,
      'quantity', parsed.quantity,
      'source_mode', v_source_mode,
      'app_version', v_app_version
    )),
    CASE
      WHEN parsed.client_event_id IS NULL THEN 'INVALID_CLIENT_EVENT_ID'
      WHEN length(parsed.client_event_id) > 128 THEN 'INVALID_CLIENT_EVENT_ID'
      WHEN parsed.captured_at_client IS NULL THEN 'INVALID_CAPTURED_AT'
      WHEN parsed.captured_at_client > v_now + interval '5 minutes' THEN 'CAPTURED_AT_IN_FUTURE'
      WHEN parsed.device_sequence IS NULL OR parsed.device_sequence < 1 THEN 'INVALID_DEVICE_SEQUENCE'
      WHEN parsed.reader_type NOT IN (
        'keyboard_barcode', 'camera_qrcode', 'camera_barcode', 'manual'
      ) THEN 'INVALID_READER_TYPE'
      WHEN public.normalize_collection_scan_code(parsed.raw_value) IS NULL THEN 'INVALID_CODE_LENGTH'
      ELSE NULL
    END
  FROM parsed;

  UPDATE pg_temp.collection_v3_ingress_input input
  SET error_code = 'CLIENT_EVENT_ID_CONFLICT'
  WHERE input.error_code IS NULL
    AND EXISTS (
      SELECT 1
      FROM pg_temp.collection_v3_ingress_input prior
      WHERE prior.client_event_id = input.client_event_id
        AND prior.ordinal < input.ordinal
        AND prior.error_code IS NULL
        AND (
          prior.raw_value IS DISTINCT FROM input.raw_value
          OR prior.device_sequence IS DISTINCT FROM input.device_sequence
        )
    );

  UPDATE pg_temp.collection_v3_ingress_input input
  SET is_batch_duplicate = true
  WHERE input.error_code IS NULL
    AND EXISTS (
      SELECT 1
      FROM pg_temp.collection_v3_ingress_input prior
      WHERE prior.ordinal < input.ordinal
        AND prior.error_code IS NULL
        AND prior.client_event_id = input.client_event_id
        AND prior.device_sequence = input.device_sequence
        AND prior.raw_value = input.raw_value
    );

  UPDATE pg_temp.collection_v3_ingress_input input
  SET error_code = 'DEVICE_SEQUENCE_CONFLICT'
  WHERE input.error_code IS NULL
    AND EXISTS (
      SELECT 1
      FROM pg_temp.collection_v3_ingress_input prior
      WHERE prior.device_sequence = input.device_sequence
        AND prior.ordinal < input.ordinal
        AND prior.error_code IS NULL
        AND prior.client_event_id IS DISTINCT FROM input.client_event_id
    );

  SELECT min(captured_at_client), max(captured_at_client)
  INTO v_oldest_capture, v_newest_capture
  FROM pg_temp.collection_v3_ingress_input
  WHERE error_code IS NULL;

  SELECT session.*
  INTO v_session
  FROM public.operator_sessions session
  JOIN public.operators operator_row
    ON operator_row.id = session.operator_id
   AND operator_row.active IS TRUE
  JOIN public.profiles profile
    ON profile.id = v_auth_user_id
   AND profile.active IS DISTINCT FROM false
  WHERE session.id = v_session_id
    AND session.auth_user_id = v_auth_user_id
    AND session.device_id = p_device_id::text
    AND session.revoked_at IS NULL
    AND (
      v_oldest_capture IS NULL
      OR v_oldest_capture >= session.started_at - interval '5 minutes'
    )
    AND (
      (
        v_source_mode = 'live'
        AND session.ended_at IS NULL
        AND session.expires_at > v_now
      )
      OR (
        v_source_mode = 'offline_replay'
        AND coalesce(session.sync_grace_until, session.expires_at) > v_now
        AND (
          session.ended_at IS NULL
          OR v_newest_capture IS NULL
          OR session.ended_at >= v_newest_capture
        )
        AND (
          v_newest_capture IS NULL
          OR v_newest_capture <= coalesce(session.ended_at, session.expires_at)
              + interval '5 minutes'
        )
      )
    )
  LIMIT 1;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF v_session.cell_id IS NULL OR v_session.machine_id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_CONTEXT_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT cell.name INTO v_cell_name
  FROM public.cells cell
  WHERE cell.id = v_session.cell_id
    AND cell.active IS TRUE;

  SELECT machine.name INTO v_machine_name
  FROM public.production_machines machine
  WHERE machine.id = v_session.machine_id
    AND machine.active IS TRUE
    AND public.normalize_production_name(machine.cell_name)
        = public.normalize_production_name(v_cell_name);

  IF v_cell_name IS NULL OR v_machine_name IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_CONTEXT_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.operator_cell_assignments assignment
    WHERE assignment.operator_id = v_session.operator_id
      AND assignment.cell_id = v_session.cell_id
      AND assignment.active IS TRUE
      AND assignment.valid_from <= coalesce(v_oldest_capture, v_now)
      AND (
        assignment.valid_until IS NULL
        OR assignment.valid_until >= coalesce(v_newest_capture, v_now)
      )
  ) THEN
    RAISE EXCEPTION 'OPERATOR_CELL_UNAUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.operator_machine_assignments explicit_assignment
    WHERE explicit_assignment.operator_id = v_session.operator_id
      AND explicit_assignment.active IS TRUE
      AND explicit_assignment.valid_from <= coalesce(v_oldest_capture, v_now)
      AND (
        explicit_assignment.valid_until IS NULL
        OR explicit_assignment.valid_until >= coalesce(v_newest_capture, v_now)
      )
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.operator_machine_assignments assignment
    WHERE assignment.operator_id = v_session.operator_id
      AND assignment.machine_id = v_session.machine_id
      AND assignment.active IS TRUE
      AND assignment.valid_from <= coalesce(v_oldest_capture, v_now)
      AND (
        assignment.valid_until IS NULL
        OR assignment.valid_until >= coalesce(v_newest_capture, v_now)
      )
  ) THEN
    RAISE EXCEPTION 'OPERATOR_MACHINE_UNAUTHORIZED'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_rollout_scope, '{}'::jsonb) ? 'device_ids'
     AND NOT (coalesce(v_rollout_scope -> 'device_ids', '[]'::jsonb) ? p_device_id::text) THEN
    RAISE EXCEPTION 'COLLECTION_V3_DEVICE_OUTSIDE_ROLLOUT'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_rollout_scope, '{}'::jsonb) ? 'cell_ids'
     AND NOT (coalesce(v_rollout_scope -> 'cell_ids', '[]'::jsonb) ? v_session.cell_id::text) THEN
    RAISE EXCEPTION 'COLLECTION_V3_CELL_OUTSIDE_ROLLOUT'
      USING ERRCODE = '42501';
  END IF;

  UPDATE pg_temp.collection_v3_ingress_input input
  SET error_code = CASE
    WHEN existing.auth_user_id <> v_auth_user_id THEN 'CLIENT_EVENT_ID_CONFLICT'
    WHEN existing.device_id IS DISTINCT FROM p_device_id::text THEN 'CLIENT_EVENT_ID_CONFLICT'
    WHEN existing.device_sequence IS DISTINCT FROM input.device_sequence THEN 'CLIENT_EVENT_ID_CONFLICT'
    WHEN existing.tag_lida IS DISTINCT FROM input.normalized_value THEN 'CLIENT_EVENT_ID_CONFLICT'
    ELSE input.error_code
  END,
      receipt_id = CASE
        WHEN existing.auth_user_id = v_auth_user_id
         AND existing.device_id IS NOT DISTINCT FROM p_device_id::text
         AND existing.device_sequence IS NOT DISTINCT FROM input.device_sequence
         AND existing.tag_lida IS NOT DISTINCT FROM input.normalized_value
        THEN existing.id
        ELSE input.receipt_id
      END
  FROM public.coletas_producao existing
  WHERE existing.client_event_id = input.client_event_id
    AND input.error_code IS NULL;

  UPDATE pg_temp.collection_v3_ingress_input input
  SET error_code = 'DEVICE_SEQUENCE_CONFLICT'
  WHERE input.error_code IS NULL
    AND input.receipt_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.coletas_producao existing
      WHERE existing.device_id = p_device_id::text
        AND existing.device_sequence = input.device_sequence
        AND existing.client_event_id <> input.client_event_id
    );

  PERFORM set_config('acprod.collection_v3_ingress_batch', p_batch_id::text, true);

  CREATE TEMP TABLE pg_temp.collection_v3_inserted (
    receipt_id uuid PRIMARY KEY,
    client_event_id text NOT NULL
  ) ON COMMIT DROP;

  WITH inserted AS (
    INSERT INTO public.coletas_producao (
      client_event_id,
      tag_lida,
      timestamp_leitura,
      status_sincronizacao,
      event_kind,
      reader_type,
      device_id,
      device_sequence,
      batch_id,
      batch_sequence,
      payload,
      auth_user_id,
      pipeline_version,
      captured_at_client,
      received_at_db,
      enqueued_at,
      source_mode,
      operator_session_id,
      operator_id,
      cell_id,
      machine_id,
      app_version,
      queue_name
    )
    SELECT
      input.client_event_id,
      input.normalized_value,
      input.captured_at_client,
      'recebida',
      'production_stage',
      input.reader_type,
      p_device_id::text,
      input.device_sequence,
      p_batch_id,
      input.ordinal - 1,
      input.safe_payload,
      v_auth_user_id,
      3,
      input.captured_at_client,
      v_now,
      v_now,
      v_source_mode,
      v_session.id,
      v_session.operator_id,
      v_session.cell_id,
      v_session.machine_id,
      v_app_version,
      v_queue_name
    FROM pg_temp.collection_v3_ingress_input input
    WHERE input.error_code IS NULL
      AND input.receipt_id IS NULL
      AND input.is_batch_duplicate IS FALSE
    ORDER BY input.ordinal
    ON CONFLICT DO NOTHING
    RETURNING id, client_event_id
  )
  INSERT INTO pg_temp.collection_v3_inserted (receipt_id, client_event_id)
  SELECT inserted.id, inserted.client_event_id
  FROM inserted;

  UPDATE pg_temp.collection_v3_ingress_input input
  SET receipt_id = inserted.receipt_id,
      inserted = true
  FROM pg_temp.collection_v3_inserted inserted
  WHERE inserted.client_event_id = input.client_event_id
    AND input.is_batch_duplicate IS FALSE;

  UPDATE pg_temp.collection_v3_ingress_input duplicate_input
  SET receipt_id = original_input.receipt_id,
      queue_message_id = original_input.queue_message_id
  FROM pg_temp.collection_v3_ingress_input original_input
  WHERE duplicate_input.is_batch_duplicate IS TRUE
    AND duplicate_input.error_code IS NULL
    AND original_input.is_batch_duplicate IS FALSE
    AND original_input.error_code IS NULL
    AND original_input.client_event_id = duplicate_input.client_event_id
    AND original_input.device_sequence = duplicate_input.device_sequence
    AND original_input.raw_value = duplicate_input.raw_value
    AND original_input.receipt_id IS NOT NULL;

  -- Resolve corrida concorrente de idempotência sem reenfileirar o recibo vencedor.
  UPDATE pg_temp.collection_v3_ingress_input input
  SET receipt_id = existing.id,
      error_code = CASE
        WHEN existing.auth_user_id = v_auth_user_id
         AND existing.device_id = p_device_id::text
         AND existing.device_sequence = input.device_sequence
         AND existing.tag_lida = input.normalized_value
        THEN NULL
        ELSE 'IDEMPOTENCY_CONFLICT'
      END
  FROM public.coletas_producao existing
  WHERE input.error_code IS NULL
    AND input.receipt_id IS NULL
    AND (
      existing.client_event_id = input.client_event_id
      OR (
        existing.device_id = p_device_id::text
        AND existing.device_sequence = input.device_sequence
      )
    );

  UPDATE pg_temp.collection_v3_ingress_input input
  SET error_code = 'IDEMPOTENCY_CONFLICT'
  WHERE input.error_code IS NULL
    AND input.receipt_id IS NULL;

  FOR v_row IN
    SELECT input.*
    FROM pg_temp.collection_v3_ingress_input input
    WHERE input.inserted IS TRUE
    ORDER BY input.ordinal
  LOOP
    SELECT queued.message_id INTO v_message_id
    FROM pgmq.send(
      v_queue_name,
      jsonb_build_object(
        'receipt_id', v_row.receipt_id,
        'client_event_id', v_row.client_event_id,
        'pipeline_version', 3,
        'source_mode', v_source_mode
      )
    ) AS queued(message_id);

    UPDATE public.coletas_producao receipt
    SET queue_message_id = v_message_id,
        queue_name = v_queue_name,
        enqueued_at = v_now,
        updated_at = v_now
    WHERE receipt.id = v_row.receipt_id;

    UPDATE pg_temp.collection_v3_ingress_input
    SET queue_message_id = v_message_id
    WHERE ordinal = v_row.ordinal;

    IF v_broadcast_enabled
       AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
      PERFORM realtime.send(
        jsonb_build_object(
          'client_event_id', v_row.client_event_id,
          'state', 'DATABASE_ACKNOWLEDGED',
          'received_at_db', v_now,
          'queue_status', 'enqueued'
        ),
        'collection.received',
        'collection:device:' || p_device_id::text,
        true
      );
    END IF;
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'client_event_id', input.client_event_id,
      'persisted', input.receipt_id IS NOT NULL AND input.error_code IS NULL,
      'duplicate_receipt', input.receipt_id IS NOT NULL AND input.inserted IS FALSE,
      'received_at_db', receipt.received_at_db,
      'queue_status', CASE
        WHEN input.error_code IS NOT NULL THEN 'rejected'
        WHEN input.inserted IS TRUE THEN 'enqueued'
        ELSE coalesce(receipt.status_sincronizacao, 'received')
      END,
      'error_code', input.error_code
    ) ORDER BY input.ordinal
  )
  INTO v_results
  FROM pg_temp.collection_v3_ingress_input input
  LEFT JOIN public.coletas_producao receipt ON receipt.id = input.receipt_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'device_id', p_device_id,
    'received_at_db', v_now,
    'results', coalesce(v_results, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_collection_batch_v3(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_collection_batch_v3(uuid, uuid, jsonb)
  TO authenticated;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_ingress',
  'collection-v3-pgmq-logged-live-replay-projection-dlq-set-based-ingress',
  'PGMQ logged, ingresso de até 25 eventos, sessão validada uma vez, contexto server-side e ACK sem decisão produtiva.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

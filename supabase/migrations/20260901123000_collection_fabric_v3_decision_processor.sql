-- AC.Prod Collection Fabric v3 — claim PGMQ 4:1 e decisão em mini-lote.
-- O caminho crítico grava somente recibo, ledger, estado da própria peça e outbox.

SET check_function_bodies = on;

CREATE OR REPLACE FUNCTION private.collection_attempts_are_append_only_v3()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.processing_finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'COLLECTION_ATTEMPT_IS_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.client_event_id IS DISTINCT FROM OLD.client_event_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
     OR NEW.queue_name IS DISTINCT FROM OLD.queue_name
     OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
     OR (
       OLD.processing_started_at IS NOT NULL
       AND NEW.processing_started_at IS DISTINCT FROM OLD.processing_started_at
     )
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'COLLECTION_ATTEMPT_IDENTITY_IS_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collection_attempts_append_only_v3
  ON public.collection_processing_attempts;
CREATE TRIGGER trg_collection_attempts_append_only_v3
  BEFORE UPDATE ON public.collection_processing_attempts
  FOR EACH ROW
  EXECUTE FUNCTION private.collection_attempts_are_append_only_v3();

REVOKE DELETE, TRUNCATE ON TABLE public.collection_processing_attempts
  FROM service_role;

REVOKE ALL ON FUNCTION private.collection_attempts_are_append_only_v3()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.collection_v3_is_retryable_sqlstate(p_sqlstate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT left(coalesce(p_sqlstate, ''), 2) = '08'
      OR p_sqlstate IN ('40001', '40P01', '55P03', '57014', '57P01', '53300');
$$;

CREATE OR REPLACE FUNCTION private.collection_v3_backoff_ms(
  p_client_event_id text,
  p_attempt integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT least(
    60000,
    (power(2::numeric, greatest(coalesce(p_attempt, 1) - 1, 0)) * 1000)::integer
      + abs(hashtextextended(coalesce(p_client_event_id, ''), 0) % 1000)::integer
  );
$$;

REVOKE ALL ON FUNCTION private.collection_v3_is_retryable_sqlstate(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.collection_v3_backoff_ms(text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_collection_batch_v3(
  p_worker_id text,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pgmq, pg_temp
AS $$
DECLARE
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), gen_random_uuid()::text), 160);
  v_limit integer := greatest(5, least(coalesce(p_limit, 10), 25));
  v_live_limit integer;
  v_replay_limit integer;
  v_live jsonb := '[]'::jsonb;
  v_replay jsonb := '[]'::jsonb;
  v_spill jsonb := '[]'::jsonb;
  v_claimed jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_worker_enabled boolean := false;
  v_broadcast_enabled boolean := false;
  v_claim_count integer := 0;
  v_broadcast_row record;
BEGIN
  SELECT coalesce(flag.enabled, false)
  INTO v_worker_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_worker';

  IF NOT coalesce(v_worker_enabled, false) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(flag.enabled, false)
  INTO v_broadcast_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_broadcast';

  IF (
    SELECT count(*)
    FROM private.collection_projection_trigger_registry registry
    WHERE registry.guard_installed IS TRUE
  ) < 3 THEN
    RAISE EXCEPTION 'COLLECTION_V3_TRIGGER_GUARDS_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  v_live_limit := greatest(1, ceil(v_limit * 0.8)::integer);
  v_replay_limit := greatest(1, v_limit - v_live_limit);

  SELECT coalesce(jsonb_agg(to_jsonb(message_row)), '[]'::jsonb)
  INTO v_live
  FROM pgmq.read('collection_live_v3', 45, v_live_limit) AS message_row;

  SELECT coalesce(jsonb_agg(to_jsonb(message_row)), '[]'::jsonb)
  INTO v_replay
  FROM pgmq.read('collection_replay_v3', 45, v_replay_limit) AS message_row;

  -- A proporção 4:1 vale quando as duas filas têm trabalho. Capacidade ociosa
  -- de uma delas é cedida à outra, evitando limitar live a 80% ou drenar replay
  -- a apenas 20% quando não há competição.
  IF jsonb_array_length(v_live) + jsonb_array_length(v_replay) < v_limit THEN
    IF jsonb_array_length(v_live) < v_live_limit THEN
      SELECT coalesce(jsonb_agg(to_jsonb(message_row)), '[]'::jsonb)
      INTO v_spill
      FROM pgmq.read(
        'collection_replay_v3',
        45,
        v_limit - jsonb_array_length(v_live) - jsonb_array_length(v_replay)
      ) AS message_row;
      v_replay := v_replay || v_spill;
    ELSIF jsonb_array_length(v_replay) < v_replay_limit THEN
      SELECT coalesce(jsonb_agg(to_jsonb(message_row)), '[]'::jsonb)
      INTO v_spill
      FROM pgmq.read(
        'collection_live_v3',
        45,
        v_limit - jsonb_array_length(v_live) - jsonb_array_length(v_replay)
      ) AS message_row;
      v_live := v_live || v_spill;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(item.payload), '[]'::jsonb)
  INTO v_claimed
  FROM (
    SELECT jsonb_set(value, '{queue_name}', '"collection_live_v3"'::jsonb, true) AS payload
    FROM jsonb_array_elements(v_live)
    UNION ALL
    SELECT jsonb_set(value, '{queue_name}', '"collection_replay_v3"'::jsonb, true) AS payload
    FROM jsonb_array_elements(v_replay)
  ) item;

  v_claim_count := jsonb_array_length(v_claimed);

  WITH claimed AS (
    SELECT
      item.value ->> 'queue_name' AS queue_name,
      private.try_collection_bigint_v3(item.value ->> 'msg_id') AS msg_id,
      greatest(1, coalesce(private.try_collection_bigint_v3(item.value ->> 'read_ct'), 1))::integer AS attempt_number,
      private.try_collection_timestamptz_v3(item.value ->> 'enqueued_at') AS enqueued_at,
      private.try_collection_uuid_v3(item.value -> 'message' ->> 'receipt_id') AS receipt_id,
      item.value -> 'message' ->> 'client_event_id' AS client_event_id
    FROM jsonb_array_elements(v_claimed) item(value)
  ), updated AS (
    UPDATE public.coletas_producao receipt
    SET status_sincronizacao = 'processando',
        claimed_at = v_now,
        lease_expires_at = v_now + interval '45 seconds',
        worker_id = v_worker_id,
        attempt_count = greatest(receipt.attempt_count, claimed.attempt_number),
        queue_delay_ms = extract(epoch FROM (v_now - coalesce(receipt.enqueued_at, receipt.received_at_db))) * 1000,
        updated_at = v_now
    FROM claimed
    WHERE receipt.id = claimed.receipt_id
      AND receipt.client_event_id = claimed.client_event_id
      AND receipt.pipeline_version = 3
    RETURNING receipt.client_event_id, receipt.queue_delay_ms
  )
  INSERT INTO public.collection_processing_attempts (
    client_event_id,
    attempt_number,
    worker_id,
    queue_name,
    claimed_at,
    queue_delay_ms
  )
  SELECT
    claimed.client_event_id,
    claimed.attempt_number,
    v_worker_id,
    claimed.queue_name,
    v_now,
    updated.queue_delay_ms
  FROM claimed
  JOIN updated USING (client_event_id)
  ON CONFLICT (client_event_id, attempt_number) DO NOTHING;

  INSERT INTO private.collection_worker_heartbeats (
    worker_id, worker_kind, invocation_id, started_at, heartbeat_at,
    finished_at, claimed_count, finalized_count, last_error_code
  ) VALUES (
    v_worker_id, 'decision', split_part(v_worker_id, ':', 2), v_now, v_now,
    NULL, v_claim_count, 0, NULL
  )
  ON CONFLICT (worker_id) DO UPDATE
  SET heartbeat_at = excluded.heartbeat_at,
      finished_at = NULL,
      claimed_count = excluded.claimed_count,
      finalized_count = 0,
      last_error_code = NULL;

  IF v_broadcast_enabled
     AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    FOR v_broadcast_row IN
      SELECT receipt.client_event_id, receipt.device_id, receipt.cell_id
      FROM public.coletas_producao receipt
      WHERE receipt.worker_id = v_worker_id
        AND receipt.pipeline_version = 3
        AND receipt.status_sincronizacao = 'processando'
    LOOP
      IF v_broadcast_row.device_id IS NOT NULL THEN
        PERFORM realtime.send(
          jsonb_build_object(
            'client_event_id', v_broadcast_row.client_event_id,
            'state', 'PROCESSING',
            'processing_started_at', v_now
          ),
          'collection.processing',
          'collection:device:' || v_broadcast_row.device_id,
          true
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_collection_batch_v3(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_collection_batch_v3(text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION private.enqueue_collection_projection_v3(
  p_client_event_id text,
  p_reading_id uuid,
  p_piece_id uuid,
  p_lot_id uuid,
  p_cell_id uuid,
  p_machine_id uuid,
  p_operator_id uuid,
  p_shift_snapshot text,
  p_step_code text,
  p_decision text,
  p_quantity integer,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pgmq, pg_temp
AS $$
DECLARE
  v_outbox_id uuid;
  v_message_id bigint;
  v_existing_message_id bigint;
BEGIN
  INSERT INTO public.collection_projection_outbox (
    client_event_id, projection_revision, projection_kind, previous_decision,
    reading_id, piece_id, lot_id, cell_id, machine_id,
    operator_id, shift_snapshot, step_code, decision, quantity, payload
  ) VALUES (
    p_client_event_id, 0, 'decision', NULL,
    p_reading_id, p_piece_id, p_lot_id, p_cell_id, p_machine_id,
    p_operator_id, p_shift_snapshot, p_step_code, p_decision,
    greatest(coalesce(p_quantity, 1), 1), coalesce(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (client_event_id, projection_revision) DO UPDATE
  SET client_event_id = excluded.client_event_id
  RETURNING id, queue_message_id
  INTO v_outbox_id, v_existing_message_id;

  IF v_existing_message_id IS NOT NULL THEN
    RETURN v_outbox_id;
  END IF;

  SELECT pgmq.send(
    'collection_projection_v3',
    jsonb_build_object(
      'outbox_id', v_outbox_id,
      'client_event_id', p_client_event_id,
      'pipeline_version', 3
    )
  ) INTO v_message_id;

  UPDATE public.collection_projection_outbox
  SET queue_message_id = coalesce(queue_message_id, v_message_id)
  WHERE id = v_outbox_id;

  RETURN v_outbox_id;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_collection_projection_v3(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, jsonb
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.process_collection_batch_v3(
  p_worker_id text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pgmq, realtime, pg_temp
AS $$
DECLARE
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), ''), 160);
  v_item record;
  v_piece public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_order public.production_orders%ROWTYPE;
  v_existing_event public.production_collection_events%ROWTYPE;
  v_existing_reading public.production_stage_readings%ROWTYPE;
  v_validation jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_decision text;
  v_reason_code text;
  v_message text;
  v_step_code text;
  v_reading_id uuid;
  v_outbox_id uuid;
  v_finished_at timestamptz;
  v_started_at timestamptz;
  v_next_step text;
  v_completed_steps text[];
  v_found_current boolean;
  v_broadcast_enabled boolean := false;
  v_retryable boolean;
  v_backoff_ms integer;
  v_sqlstate text;
  v_error_message text;
  v_error_context text;
  v_dead_letter_message_id bigint;
  v_finalized_count integer := 0;
  v_input_count integer;
  v_lock_timeout_ms integer := 500;
  v_statement_timeout_ms integer := 5000;
  v_lock_started_at timestamptz;
  v_lock_wait_ms numeric(14,3) := 0;
  i integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_worker_id = '' THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_ID_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'COLLECTION_BATCH_ITEMS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_input_count := jsonb_array_length(p_items);
  IF v_input_count < 1 OR v_input_count > 25 THEN
    RAISE EXCEPTION 'COLLECTION_PROCESSING_BATCH_SIZE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    greatest(100, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'lock_timeout_ms'), 500
    ), 2000))::integer,
    greatest(1000, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'statement_timeout_ms'), 5000
    ), 15000))::integer
  INTO v_lock_timeout_ms, v_statement_timeout_ms
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_worker'
    AND flag.enabled IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_V3_WORKER_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('lock_timeout', v_lock_timeout_ms::text || 'ms', true);
  PERFORM set_config('statement_timeout', v_statement_timeout_ms::text || 'ms', true);

  SELECT coalesce(flag.enabled, false)
  INTO v_broadcast_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_broadcast';

  -- Toda resolução de recibo, peça, lote, pedido e etapa ocorre antes da
  -- primeira escrita do mini-lote. O lock posterior relê somente a peça.
  CREATE TEMP TABLE pg_temp.collection_v3_decision_input
  ON COMMIT DROP
  AS
  WITH messages AS (
    SELECT
      item.ordinality::integer AS ordinal,
      item.value ->> 'queue_name' AS queue_name,
      private.try_collection_bigint_v3(item.value ->> 'msg_id') AS msg_id,
      greatest(1, coalesce(private.try_collection_bigint_v3(item.value ->> 'read_ct'), 1))::integer AS read_ct,
      private.try_collection_timestamptz_v3(item.value ->> 'enqueued_at') AS queue_enqueued_at,
      private.try_collection_uuid_v3(item.value -> 'message' ->> 'receipt_id') AS receipt_id_from_message,
      item.value -> 'message' ->> 'client_event_id' AS client_event_id_from_message
    FROM jsonb_array_elements(p_items) WITH ORDINALITY item(value, ordinality)
  )
  SELECT
    messages.*,
    receipt.id AS receipt_id,
    receipt.client_event_id,
    receipt.tag_lida AS raw_value,
    receipt.reader_type,
    receipt.timestamp_leitura AS captured_at_client,
    receipt.received_at_db,
    receipt.device_id,
    receipt.operator_session_id,
    receipt.operator_id,
    receipt.cell_id,
    cell.name AS cell_name,
    receipt.machine_id,
    machine.name AS machine_name,
    session.shift_snapshot,
    receipt.source_mode,
    greatest(1, least(coalesce(
      private.try_collection_bigint_v3(receipt.payload ->> 'quantity'), 1
    ), 100))::integer AS quantity,
    resolution.match_count,
    resolution.piece_id,
    piece.lot_id,
    coalesce(piece.production_order_id, lot.production_order_id, lot.order_id) AS production_order_id,
    public.resolve_production_stage_for_cell(receipt.cell_id, cell.name) AS step_code,
    operator_row.name AS operator_name,
    piece.pcp_import_batch_id,
    piece.current_stage AS prelock_current_stage,
    piece.route_steps AS prelock_route_steps,
    piece.completed_steps AS prelock_completed_steps,
    lot.lot_code,
    coalesce(production_order.order_number, production_order.order_code) AS order_number,
    production_order.load_number,
    production_order.customer_name
  FROM messages
  LEFT JOIN public.coletas_producao receipt
    ON receipt.id = messages.receipt_id_from_message
   AND receipt.client_event_id = messages.client_event_id_from_message
   AND receipt.pipeline_version = 3
  LEFT JOIN public.cells cell ON cell.id = receipt.cell_id
  LEFT JOIN public.production_machines machine ON machine.id = receipt.machine_id
  LEFT JOIN public.operator_sessions session ON session.id = receipt.operator_session_id
  LEFT JOIN public.operators operator_row ON operator_row.id = receipt.operator_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS match_count,
      (array_agg(candidate.id ORDER BY candidate.id))[1] AS piece_id
    FROM (
      SELECT direct_piece.id
      FROM public.production_pieces direct_piece
      WHERE upper(direct_piece.piece_uid) = upper(receipt.tag_lida)
         OR upper(direct_piece.traceability_code) = upper(receipt.tag_lida)
      UNION
      SELECT tag.piece_id
      FROM public.production_tags tag
      WHERE tag.active IS TRUE
        AND tag.piece_id IS NOT NULL
        AND upper(tag.tag_value) = upper(receipt.tag_lida)
    ) candidate
  ) resolution ON true
  LEFT JOIN public.production_pieces piece ON piece.id = resolution.piece_id
  LEFT JOIN public.production_lots lot ON lot.id = piece.lot_id
  LEFT JOIN public.production_orders production_order
    ON production_order.id = coalesce(piece.production_order_id, lot.production_order_id, lot.order_id);

  FOR v_item IN
    SELECT *
    FROM pg_temp.collection_v3_decision_input
    ORDER BY piece_id NULLS LAST, client_event_id NULLS LAST, ordinal
  LOOP
    v_started_at := clock_timestamp();
    v_sqlstate := NULL;
    v_error_message := NULL;
    v_error_context := NULL;
    v_reading_id := NULL;
    v_outbox_id := NULL;
    v_decision := NULL;
    v_reason_code := NULL;
    v_message := NULL;
    v_step_code := NULL;
    v_validation := NULL;
    v_lock_started_at := NULL;
    v_lock_wait_ms := 0;
    v_existing_event := NULL;
    v_existing_reading := NULL;
    v_piece := NULL;
    v_lot := NULL;
    v_order := NULL;

    UPDATE public.collection_processing_attempts
    SET processing_started_at = v_started_at
    WHERE client_event_id = v_item.client_event_id
      AND attempt_number = v_item.read_ct
      AND processing_started_at IS NULL
      AND processing_finished_at IS NULL;

    BEGIN
      IF v_item.queue_name NOT IN ('collection_live_v3', 'collection_replay_v3')
         OR v_item.msg_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_QUEUE_MESSAGE_INVALID'
          USING ERRCODE = '22023';
      END IF;

      IF v_item.receipt_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_RECEIPT_NOT_FOUND'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_item.client_event_id IS DISTINCT FROM v_item.client_event_id_from_message THEN
        RAISE EXCEPTION 'COLLECTION_QUEUE_RECEIPT_MISMATCH'
          USING ERRCODE = '22023';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.coletas_producao receipt
        WHERE receipt.id = v_item.receipt_id
          AND receipt.worker_id = v_worker_id
          AND receipt.status_sincronizacao = 'processando'
      ) THEN
        RAISE EXCEPTION 'COLLECTION_RECEIPT_LEASE_MISMATCH'
          USING ERRCODE = '55P03';
      END IF;

      UPDATE public.coletas_producao
      SET processing_started_at = v_started_at,
          updated_at = v_started_at
      WHERE id = v_item.receipt_id;

      SELECT event.*
      INTO v_existing_event
      FROM public.production_collection_events event
      WHERE event.client_event_id = v_item.client_event_id
        AND event.pipeline_version = 3;

      IF v_existing_event.id IS NOT NULL
         AND v_existing_event.result_status IN (
           'approved', 'rejected', 'blocked', 'duplicated', 'pending_review'
         ) THEN
        v_finished_at := clock_timestamp();
        v_result := coalesce(v_existing_event.result_payload, '{}'::jsonb)
          || jsonb_build_object(
            'client_event_id', v_item.client_event_id,
            'decision', v_existing_event.result_status,
            'reason_code', coalesce(v_existing_event.final_reason_code, 'IDEMPOTENT_REPLAY'),
            'reading_id', v_existing_event.reading_id,
            'piece_id', v_existing_event.piece_id,
            'lot_id', v_existing_event.lot_id,
            'step_code', v_existing_event.operation_name,
            'committed_at', v_existing_event.decision_committed_at,
            'idempotent_replay', true
          );

        UPDATE public.coletas_producao
        SET status_sincronizacao = 'sincronizada',
            resultado = v_result,
            erro = NULL,
            retryable = false,
            processado_em = coalesce(v_existing_event.decision_committed_at, v_finished_at),
            decision_committed_at = coalesce(v_existing_event.decision_committed_at, v_finished_at),
            processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
            lease_expires_at = NULL,
            worker_id = NULL,
            updated_at = v_finished_at
        WHERE id = v_item.receipt_id;

        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);

        UPDATE public.collection_processing_attempts
        SET processing_finished_at = v_finished_at,
            processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
            reason_code = 'IDEMPOTENT_REPLAY',
            retryable = false,
            lock_wait_ms = v_lock_wait_ms
        WHERE client_event_id = v_item.client_event_id
          AND attempt_number = v_item.read_ct
          AND processing_finished_at IS NULL;

        v_results := v_results || jsonb_build_array(v_result);
        v_finalized_count := v_finalized_count + 1;
        CONTINUE;
      END IF;

      IF coalesce(v_item.match_count, 0) = 0 THEN
        v_decision := 'rejected';
        v_reason_code := 'PIECE_NOT_FOUND';
        v_message := 'Peça não localizada para o código informado.';
        v_step_code := v_item.step_code;
      ELSIF v_item.match_count > 1 THEN
        v_decision := 'pending_review';
        v_reason_code := 'PIECE_IDENTIFIER_AMBIGUOUS';
        v_message := 'O código corresponde a mais de uma peça e requer revisão.';
        v_step_code := v_item.step_code;
      ELSE
        -- Lock estritamente por peça e em ordem estável do mini-lote.
        v_lock_started_at := clock_timestamp();
        PERFORM pg_advisory_xact_lock(hashtextextended(v_item.piece_id::text, 0));
        v_lock_wait_ms := extract(
          epoch FROM (clock_timestamp() - v_lock_started_at)
        ) * 1000;

        SELECT piece.*
        INTO v_piece
        FROM public.production_pieces piece
        WHERE piece.id = v_item.piece_id
        FOR UPDATE;

        IF v_piece.id IS NULL THEN
          RAISE EXCEPTION 'COLLECTION_PIECE_DISAPPEARED'
            USING ERRCODE = 'P0002';
        END IF;

        -- Rechecagem após o lock fecha a corrida de duas entregas idênticas.
        SELECT event.*
        INTO v_existing_event
        FROM public.production_collection_events event
        WHERE event.client_event_id = v_item.client_event_id
          AND event.pipeline_version = 3;

        IF v_existing_event.id IS NOT NULL THEN
          v_finished_at := clock_timestamp();
          v_result := coalesce(v_existing_event.result_payload, '{}'::jsonb)
            || jsonb_build_object('idempotent_replay', true);

          UPDATE public.coletas_producao
          SET status_sincronizacao = 'sincronizada',
              resultado = v_result,
              retryable = false,
              processado_em = coalesce(v_existing_event.decision_committed_at, v_finished_at),
              decision_committed_at = coalesce(v_existing_event.decision_committed_at, v_finished_at),
              lease_expires_at = NULL,
              worker_id = NULL,
              updated_at = v_finished_at
          WHERE id = v_item.receipt_id;

          PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
          UPDATE public.collection_processing_attempts
          SET processing_finished_at = v_finished_at,
              processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
              reason_code = 'IDEMPOTENT_REPLAY',
              retryable = false,
              lock_wait_ms = v_lock_wait_ms
          WHERE client_event_id = v_item.client_event_id
            AND attempt_number = v_item.read_ct
            AND processing_finished_at IS NULL;
          v_results := v_results || jsonb_build_array(v_result);
          v_finalized_count := v_finalized_count + 1;
          CONTINUE;
        END IF;

        SELECT lot.* INTO v_lot
        FROM public.production_lots lot
        WHERE lot.id = v_piece.lot_id;

        SELECT production_order.* INTO v_order
        FROM public.production_orders production_order
        WHERE production_order.id = coalesce(
          v_piece.production_order_id,
          v_lot.production_order_id,
          v_lot.order_id
        );

        v_step_code := public.resolve_production_stage_for_cell(v_item.cell_id, v_item.cell_name);
        IF v_step_code IS NULL THEN
          v_decision := 'blocked';
          v_reason_code := 'TARGET_STEP_UNRESOLVED';
          v_message := 'A célula autenticada não possui etapa produtiva resolvida.';
        ELSE
          v_validation := public.validar_fluxo_da_peca(v_piece.id, v_step_code);

          IF coalesce((v_validation ->> 'success')::boolean, false)
             AND coalesce(v_validation ->> 'status', 'approved') <> 'duplicated' THEN
            SELECT reading.*
            INTO v_existing_reading
            FROM public.production_stage_readings reading
            WHERE reading.piece_id = v_piece.id
              AND reading.step_name = v_step_code
              AND reading.production_cycle = 1
              AND reading.status = 'approved'
            ORDER BY reading.created_at, reading.id
            LIMIT 1;

            IF v_existing_reading.id IS NOT NULL THEN
              v_decision := 'duplicated';
              v_reason_code := 'PIECE_STAGE_ALREADY_APPROVED';
              v_message := 'Peça já aprovada nesta etapa; nenhum efeito produtivo foi duplicado.';
            ELSE
              v_decision := 'approved';
              v_reason_code := 'APPROVED';
              v_message := coalesce(v_validation ->> 'message', 'Peça aprovada para a etapa.');
            END IF;
          ELSIF v_validation ->> 'status' = 'duplicated' THEN
            v_decision := 'duplicated';
            v_reason_code := 'PIECE_STAGE_ALREADY_APPROVED';
            v_message := coalesce(v_validation ->> 'message', 'Peça já aprovada nesta etapa.');
          ELSE
            v_decision := 'blocked';
            v_reason_code := 'PRODUCTION_FLOW_BLOCKED';
            v_message := coalesce(v_validation ->> 'message', 'Fluxo produtivo bloqueado.');
          END IF;
        END IF;
      END IF;

      IF v_piece.id IS NOT NULL AND v_piece.lot_id IS NOT NULL THEN
        INSERT INTO public.production_stage_readings (
          client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
          operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
          step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
          lot_code, load_number, order_number, customer_name, environment_name,
          operation_name, piece_code, production_cycle, pipeline_version
        ) VALUES (
          v_item.client_event_id, v_piece.piece_uid,
          CASE WHEN v_item.reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
          v_item.reader_type, v_item.machine_name, v_item.cell_name,
          v_item.operator_name, v_item.shift_snapshot,
          v_item.captured_at_client::date,
          to_char(v_item.captured_at_client, 'HH24:MI'),
          v_piece.legacy_production_lot_item_id, v_piece.id, v_piece.lot_id,
          v_piece.production_order_id, v_step_code, v_item.quantity,
          v_decision,
          CASE v_decision
            WHEN 'approved' THEN 'approved_scan'
            WHEN 'duplicated' THEN 'duplicated_scan'
            ELSE 'wrong_step'
          END,
          v_item.operator_id, v_item.machine_id, v_item.machine_name,
          v_lot.lot_code, v_order.load_number,
          coalesce(v_order.order_number, v_order.order_code), v_order.customer_name,
          v_piece.environment, v_step_code, v_piece.traceability_code, 1, 3
        )
        RETURNING id INTO v_reading_id;
      END IF;

      IF v_decision = 'approved' THEN
        v_completed_steps := coalesce(v_piece.completed_steps, '{}'::text[]);
        IF NOT (v_step_code = ANY(v_completed_steps)) THEN
          v_completed_steps := array_append(v_completed_steps, v_step_code);
        END IF;

        v_next_step := NULL;
        v_found_current := false;
        IF array_length(v_piece.route_steps, 1) IS NOT NULL THEN
          FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
            IF v_found_current THEN
              v_next_step := v_piece.route_steps[i];
              EXIT;
            END IF;
            IF lower(v_piece.route_steps[i]) = lower(v_step_code) THEN
              v_found_current := true;
            END IF;
          END LOOP;
        END IF;

        UPDATE public.production_pieces
        SET completed_steps = v_completed_steps,
            current_stage = coalesce(v_next_step, 'Concluída'),
            status = CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_progress' END,
            updated_at = clock_timestamp()
        WHERE id = v_piece.id;
      END IF;

      v_finished_at := clock_timestamp();
      v_result := jsonb_strip_nulls(jsonb_build_object(
        'success', v_decision = 'approved',
        'client_event_id', v_item.client_event_id,
        'decision', v_decision,
        'status', v_decision,
        'reason_code', v_reason_code,
        'message', v_message,
        'reading_id', v_reading_id,
        'piece_id', v_piece.id,
        'lot_id', v_piece.lot_id,
        'step_code', v_step_code,
        'committed_at', v_finished_at
      ));

      INSERT INTO public.production_collection_events (
        client_event_id, raw_value, normalized_value, reader_type,
        operator_id, operator_name, cell_name, shift, date, hour,
        status, result_status, reading_id, lot_id, production_order_id,
        error_message, payload, created_at_client, processed_at,
        machine_id, machine_name, piece_id, device_id, pcp_import_batch_id,
        result_payload, attempt_count, last_attempt_at, operator_session_id,
        cell_id, shift_snapshot, server_received_at, pipeline_version,
        decision_committed_at, final_reason_code, operation_name
      ) VALUES (
        v_item.client_event_id, v_item.raw_value, v_item.raw_value, v_item.reader_type,
        v_item.operator_id, v_item.operator_name, v_item.cell_name, v_item.shift_snapshot,
        v_item.captured_at_client::date, to_char(v_item.captured_at_client, 'HH24:MI'),
        CASE WHEN v_decision = 'approved' THEN 'synced' ELSE 'ignored' END,
        v_decision, v_reading_id, v_piece.lot_id, v_piece.production_order_id,
        CASE WHEN v_decision = 'approved' THEN NULL ELSE v_message END,
        '{}'::jsonb, v_item.captured_at_client, v_finished_at,
        v_item.machine_id, v_item.machine_name, v_piece.id, v_item.device_id,
        v_piece.pcp_import_batch_id, v_result, v_item.read_ct, v_finished_at,
        v_item.operator_session_id, v_item.cell_id, v_item.shift_snapshot,
        v_item.received_at_db, 3, v_finished_at, v_reason_code, v_step_code
      )
      ON CONFLICT (client_event_id) DO NOTHING;

      v_outbox_id := private.enqueue_collection_projection_v3(
        v_item.client_event_id,
        v_reading_id,
        v_piece.id,
        v_piece.lot_id,
        v_item.cell_id,
        v_item.machine_id,
        v_item.operator_id,
        v_item.shift_snapshot,
        v_step_code,
        v_decision,
        v_item.quantity,
        jsonb_strip_nulls(jsonb_build_object(
          'device_id', v_item.device_id,
          'source_mode', v_item.source_mode,
          'reason_code', v_reason_code,
          'committed_at', v_finished_at
        ))
      );

      UPDATE public.coletas_producao
      SET status_sincronizacao = 'sincronizada',
          resultado = v_result,
          erro = NULL,
          retryable = false,
          final_reason_code = v_reason_code,
          processado_em = v_finished_at,
          decision_committed_at = v_finished_at,
          processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
          lease_expires_at = NULL,
          worker_id = NULL,
          last_error_code = NULL,
          last_error_at = NULL,
          updated_at = v_finished_at
      WHERE id = v_item.receipt_id;

      PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);

      UPDATE public.collection_processing_attempts
      SET processing_finished_at = v_finished_at,
          processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
          reason_code = v_reason_code,
          retryable = false,
          lock_wait_ms = v_lock_wait_ms
      WHERE client_event_id = v_item.client_event_id
        AND attempt_number = v_item.read_ct
        AND processing_finished_at IS NULL;

      IF v_broadcast_enabled
         AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
        PERFORM realtime.send(
          jsonb_build_object(
            'client_event_id', v_item.client_event_id,
            'state', upper(v_decision),
            'decision', v_decision,
            'reason_code', v_reason_code,
            'reading_id', v_reading_id,
            'committed_at', v_finished_at
          ),
          'collection.finalized',
          'collection:device:' || v_item.device_id,
          true
        );

        PERFORM realtime.send(
          jsonb_build_object(
            'client_event_id', v_item.client_event_id,
            'state', upper(v_decision),
            'decision', v_decision,
            'reason_code', v_reason_code,
            'reading_id', v_reading_id,
            'committed_at', v_finished_at
          ),
          'collection.finalized',
          'collection:event:' || v_item.client_event_id,
          true
        );

        UPDATE public.coletas_producao
        SET broadcasted_at = v_finished_at,
            updated_at = v_finished_at
        WHERE id = v_item.receipt_id;
      END IF;

      v_results := v_results || jsonb_build_array(v_result);
      v_finalized_count := v_finalized_count + 1;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT,
        v_error_context = PG_EXCEPTION_CONTEXT;

      v_finished_at := clock_timestamp();
      IF v_lock_started_at IS NOT NULL AND v_lock_wait_ms = 0 THEN
        v_lock_wait_ms := extract(
          epoch FROM (v_finished_at - v_lock_started_at)
        ) * 1000;
      END IF;
      v_retryable := private.collection_v3_is_retryable_sqlstate(v_sqlstate);

      IF v_retryable AND coalesce(v_item.read_ct, 1) < 5 THEN
        v_backoff_ms := private.collection_v3_backoff_ms(
          coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          v_item.read_ct
        );

        PERFORM pgmq.set_vt(
          v_item.queue_name,
          v_item.msg_id,
          greatest(1, ceil(v_backoff_ms / 1000.0)::integer)
        );

        UPDATE public.coletas_producao
        SET status_sincronizacao = 'recebida',
            retryable = true,
            erro = left(v_error_message, 500),
            last_error_code = v_sqlstate,
            last_error_at = v_finished_at,
            next_attempt_at = v_finished_at + make_interval(secs => v_backoff_ms / 1000.0),
            lease_expires_at = NULL,
            worker_id = NULL,
            updated_at = v_finished_at
        WHERE id = v_item.receipt_id;

        UPDATE public.collection_processing_attempts
        SET processing_finished_at = v_finished_at,
            processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
            sqlstate = v_sqlstate,
            reason_code = 'RETRY_SCHEDULED',
            retryable = true,
            backoff_ms = v_backoff_ms,
            lock_wait_ms = v_lock_wait_ms,
            error_message = left(v_error_message, 500)
        WHERE client_event_id = v_item.client_event_id
          AND attempt_number = v_item.read_ct
          AND processing_finished_at IS NULL;

        v_result := jsonb_build_object(
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'decision', 'retrying',
          'reason_code', v_sqlstate,
          'message', 'Falha transitória; nova tentativa agendada.',
          'retry_in_ms', v_backoff_ms
        );
      ELSE
        SELECT pgmq.send(
          'collection_dead_letter_v3',
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'decision',
            'source_queue', v_item.queue_name,
            'source_message_id', v_item.msg_id,
            'receipt_id', v_item.receipt_id,
            'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
            'attempts', coalesce(v_item.read_ct, 1),
            'sqlstate', v_sqlstate,
            'reason_code', CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE 'PERMANENT_PROCESSING_ERROR' END,
            'failed_at', v_finished_at
          ))
        ) INTO v_dead_letter_message_id;

        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);

        v_result := jsonb_build_object(
          'success', false,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'decision', 'dead_lettered',
          'status', 'dead_lettered',
          'reason_code', CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE v_sqlstate END,
          'message', 'A leitura foi preservada para revisão operacional.',
          'committed_at', v_finished_at
        );

        UPDATE public.coletas_producao
        SET status_sincronizacao = 'erro',
            retryable = false,
            erro = left(v_error_message, 500),
            resultado = v_result,
            final_reason_code = CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE v_sqlstate END,
            last_error_code = v_sqlstate,
            last_error_at = v_finished_at,
            processado_em = v_finished_at,
            dead_lettered_at = v_finished_at,
            processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
            lease_expires_at = NULL,
            worker_id = NULL,
            updated_at = v_finished_at
        WHERE id = v_item.receipt_id;

        UPDATE public.collection_processing_attempts
        SET processing_finished_at = v_finished_at,
            processing_duration_ms = extract(epoch FROM (v_finished_at - v_started_at)) * 1000,
            sqlstate = v_sqlstate,
            reason_code = CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE 'PERMANENT_PROCESSING_ERROR' END,
            retryable = false,
            lock_wait_ms = v_lock_wait_ms,
            error_message = left(v_error_message, 500)
        WHERE client_event_id = v_item.client_event_id
          AND attempt_number = v_item.read_ct
          AND processing_finished_at IS NULL;

        IF v_broadcast_enabled
           AND v_item.device_id IS NOT NULL
           AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
              'state', 'DEAD_LETTERED',
              'reason_code', CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE v_sqlstate END,
              'committed_at', v_finished_at
            ),
            'collection.dead_lettered',
            'collection:device:' || v_item.device_id,
            true
          );
        END IF;

        v_finalized_count := v_finalized_count + 1;
      END IF;

      v_results := v_results || jsonb_build_array(v_result);
    END;
  END LOOP;

  UPDATE private.collection_worker_heartbeats
  SET heartbeat_at = clock_timestamp(),
      finished_at = clock_timestamp(),
      finalized_count = v_finalized_count,
      last_error_code = NULL
  WHERE worker_id = v_worker_id;

  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION private.process_collection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_collection_batch_v3(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.process_collection_batch_v3(
  p_worker_id text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
  SELECT private.process_collection_batch_v3(p_worker_id, p_items);
$$;

REVOKE ALL ON FUNCTION public.process_collection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_collection_batch_v3(text, jsonb)
  TO service_role;

-- Uma decisão pode ser revista depois do commit (por exemplo, aprovação que
-- entra em pending_review após reprovação de qualidade). Os triggers pesados
-- do ledger ficam deliberadamente guardados no pipeline v3; por isso a
-- compensação também precisa entrar no outbox, na mesma transação da revisão.
CREATE OR REPLACE FUNCTION private.enqueue_collection_projection_correction_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pgmq, pg_temp
AS $$
DECLARE
  v_pending public.collection_projection_outbox%ROWTYPE;
  v_template public.collection_projection_outbox%ROWTYPE;
  v_previous_decision text;
  v_revision integer;
  v_outbox_id uuid;
  v_message_id bigint;
  v_now timestamptz := clock_timestamp();
  v_correction_payload jsonb;
BEGIN
  IF coalesce(NEW.pipeline_version, OLD.pipeline_version, 2) <> 3
     OR NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status IS NULL
     OR NEW.status NOT IN (
       'approved', 'rejected', 'blocked', 'duplicated', 'pending_review'
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    RAISE EXCEPTION 'COLLECTION_V3_REAPPROVAL_REQUIRES_NEW_READING'
      USING ERRCODE = '55000';
  END IF;

  SELECT outbox.*
  INTO v_template
  FROM public.collection_projection_outbox outbox
  WHERE outbox.reading_id = NEW.id
  ORDER BY outbox.projection_revision DESC
  LIMIT 1
  FOR UPDATE;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_V3_CORRECTION_OUTBOX_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  v_correction_payload := jsonb_strip_nulls(
    coalesce(v_template.payload, '{}'::jsonb)
    || jsonb_build_object(
      'projection_kind', 'correction',
      'previous_decision', OLD.status,
      'decision', NEW.status,
      'corrected_at', v_now,
      'reason_code', coalesce(nullif(NEW.rework_reason, ''), 'STATUS_CORRECTED')
    )
  );

  SELECT outbox.*
  INTO v_pending
  FROM public.collection_projection_outbox outbox
  WHERE outbox.reading_id = NEW.id
    AND outbox.projected_at IS NULL
    AND outbox.dead_lettered_at IS NULL
  ORDER BY outbox.projection_revision DESC
  LIMIT 1
  FOR UPDATE;

  IF v_pending.id IS NOT NULL THEN
    -- Se nenhuma projeção foi aplicada para esta revisão, colapsar mudanças
    -- sucessivas preserva como base a última decisão efetivamente projetada.
    UPDATE public.collection_projection_outbox
    SET decision = NEW.status,
        projection_kind = 'correction',
        payload = v_correction_payload,
        available_at = least(available_at, v_now),
        last_error_code = NULL
    WHERE id = v_pending.id;
    v_outbox_id := v_pending.id;
  ELSE
    SELECT outbox.decision
    INTO v_previous_decision
    FROM public.collection_projection_outbox outbox
    WHERE outbox.reading_id = NEW.id
      AND outbox.projected_at IS NOT NULL
    ORDER BY outbox.projection_revision DESC
    LIMIT 1;

    SELECT coalesce(max(outbox.projection_revision), -1) + 1
    INTO v_revision
    FROM public.collection_projection_outbox outbox
    WHERE outbox.client_event_id = v_template.client_event_id;

    INSERT INTO public.collection_projection_outbox (
      client_event_id, projection_revision, projection_kind, previous_decision,
      reading_id, piece_id, lot_id, cell_id, machine_id, operator_id,
      shift_id, shift_snapshot, step_code, decision, quantity, payload,
      created_at, available_at
    ) VALUES (
      v_template.client_event_id, v_revision, 'correction', v_previous_decision,
      v_template.reading_id, v_template.piece_id, v_template.lot_id,
      v_template.cell_id, v_template.machine_id, v_template.operator_id,
      v_template.shift_id, v_template.shift_snapshot, v_template.step_code,
      NEW.status, greatest(coalesce(NEW.quantity, v_template.quantity, 1), 1),
      v_correction_payload, v_now, v_now
    )
    RETURNING id INTO v_outbox_id;

    SELECT pgmq.send(
      'collection_projection_v3',
      jsonb_build_object(
        'outbox_id', v_outbox_id,
        'client_event_id', v_template.client_event_id,
        'projection_revision', v_revision,
        'pipeline_version', 3
      )
    ) INTO v_message_id;

    UPDATE public.collection_projection_outbox
    SET queue_message_id = v_message_id
    WHERE id = v_outbox_id;
  END IF;

  UPDATE public.production_collection_events
  SET status = CASE WHEN NEW.status = 'approved' THEN 'synced' ELSE 'ignored' END,
      result_status = NEW.status,
      final_reason_code = coalesce(nullif(NEW.rework_reason, ''), 'STATUS_CORRECTED'),
      result_payload = coalesce(result_payload, '{}'::jsonb) || jsonb_build_object(
        'success', NEW.status = 'approved',
        'status', NEW.status,
        'decision', NEW.status,
        'collection_state', upper(NEW.status),
        'reason_code', coalesce(nullif(NEW.rework_reason, ''), 'STATUS_CORRECTED'),
        'corrected_at', v_now
      ),
      updated_at = v_now
  WHERE client_event_id = v_template.client_event_id
    AND pipeline_version = 3;

  UPDATE public.coletas_producao
  SET resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object(
        'success', NEW.status = 'approved',
        'status', NEW.status,
        'decision', NEW.status,
        'collection_state', upper(NEW.status),
        'reason_code', coalesce(nullif(NEW.rework_reason, ''), 'STATUS_CORRECTED'),
        'corrected_at', v_now
      ),
      final_reason_code = coalesce(nullif(NEW.rework_reason, ''), 'STATUS_CORRECTED'),
      projected_at = NULL,
      updated_at = v_now
  WHERE client_event_id = v_template.client_event_id
    AND pipeline_version = 3;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_collection_projection_correction_v3()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collection_v3_projection_correction
  ON public.production_stage_readings;
CREATE TRIGGER trg_collection_v3_projection_correction
AFTER UPDATE OF status ON public.production_stage_readings
FOR EACH ROW
WHEN (
  coalesce(NEW.pipeline_version, OLD.pipeline_version, 2) = 3
  AND NEW.status IS DISTINCT FROM OLD.status
)
EXECUTE FUNCTION private.enqueue_collection_projection_correction_v3();

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_decision',
  'collection-v3-pgmq-priority-mini-batch-piece-lock-ledger-outbox-retry-dlq',
  'Claim PGMQ 4:1, decisão por peça, idempotência, tentativas imutáveis, outbox transacional, retry com jitter e DLQ em cinco tentativas.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

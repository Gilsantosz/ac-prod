-- AC.Prod Collection Fabric v3 — projetor idempotente e reconciliação.

SET check_function_bodies = on;

CREATE OR REPLACE FUNCTION public.claim_collection_projection_batch_v3(
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
  v_claimed jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.collection_pipeline_flags flag
    WHERE flag.flag_name = 'collection_pipeline_v3_projection'
      AND flag.enabled IS TRUE
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_set(to_jsonb(message_row), '{queue_name}', '"collection_projection_v3"'::jsonb, true)
  ), '[]'::jsonb)
  INTO v_claimed
  FROM pgmq.read('collection_projection_v3', 60, v_limit) AS message_row;

  WITH claimed AS (
    SELECT
      private.try_collection_uuid_v3(item.value -> 'message' ->> 'outbox_id') AS outbox_id,
      greatest(1, coalesce(private.try_collection_bigint_v3(item.value ->> 'read_ct'), 1))::integer AS read_ct
    FROM jsonb_array_elements(v_claimed) item(value)
  )
  UPDATE public.collection_projection_outbox outbox
  SET attempt_count = greatest(outbox.attempt_count, claimed.read_ct),
      available_at = v_now
  FROM claimed
  WHERE outbox.id = claimed.outbox_id
    AND outbox.projected_at IS NULL
    AND outbox.dead_lettered_at IS NULL;

  INSERT INTO private.collection_worker_heartbeats (
    worker_id, worker_kind, invocation_id, started_at, heartbeat_at,
    finished_at, claimed_count, finalized_count, last_error_code
  ) VALUES (
    v_worker_id, 'projection', split_part(v_worker_id, ':', 2), v_now, v_now,
    NULL, jsonb_array_length(v_claimed), 0, NULL
  )
  ON CONFLICT (worker_id) DO UPDATE
  SET heartbeat_at = excluded.heartbeat_at,
      finished_at = NULL,
      claimed_count = excluded.claimed_count,
      finalized_count = 0,
      last_error_code = NULL;

  RETURN v_claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_collection_projection_batch_v3(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_collection_projection_batch_v3(text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION private.mark_collection_projection_v3(
  p_outbox_id uuid,
  p_projection_type text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_inserted uuid;
BEGIN
  INSERT INTO public.collection_projection_applied (
    outbox_id, projection_type, payload_checksum
  ) VALUES (
    p_outbox_id,
    p_projection_type,
    encode(digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex')
  )
  ON CONFLICT (outbox_id, projection_type) DO NOTHING
  RETURNING outbox_id INTO v_inserted;

  RETURN v_inserted IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.mark_collection_projection_v3(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.process_collection_projection_batch_v3(
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
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_now timestamptz;
  v_shard smallint;
  v_entry_id uuid;
  v_retryable boolean;
  v_backoff_ms integer;
  v_sqlstate text;
  v_error_message text;
  v_dead_letter_message_id bigint;
  v_broadcast_enabled boolean := false;
  v_finalized_count integer := 0;
  v_input_count integer;
  v_lock_timeout_ms integer := 1000;
  v_statement_timeout_ms integer := 10000;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_worker_id = '' THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTOR_ID_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_ITEMS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_input_count := jsonb_array_length(p_items);
  IF v_input_count < 1 OR v_input_count > 25 THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_BATCH_SIZE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    greatest(100, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'lock_timeout_ms'), 1000
    ), 5000))::integer,
    greatest(1000, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'statement_timeout_ms'), 10000
    ), 30000))::integer
  INTO v_lock_timeout_ms, v_statement_timeout_ms
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_projection'
    AND flag.enabled IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_V3_PROJECTION_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('lock_timeout', v_lock_timeout_ms::text || 'ms', true);
  PERFORM set_config('statement_timeout', v_statement_timeout_ms::text || 'ms', true);

  SELECT coalesce(flag.enabled, false)
  INTO v_broadcast_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_broadcast';

  CREATE TEMP TABLE pg_temp.collection_v3_projection_input
  ON COMMIT DROP
  AS
  WITH messages AS (
    SELECT
      item.ordinality::integer AS ordinal,
      item.value ->> 'queue_name' AS queue_name,
      private.try_collection_bigint_v3(item.value ->> 'msg_id') AS msg_id,
      greatest(1, coalesce(private.try_collection_bigint_v3(item.value ->> 'read_ct'), 1))::integer AS read_ct,
      private.try_collection_uuid_v3(item.value -> 'message' ->> 'outbox_id') AS outbox_id_from_message,
      item.value -> 'message' ->> 'client_event_id' AS client_event_id_from_message
    FROM jsonb_array_elements(p_items) WITH ORDINALITY item(value, ordinality)
  )
  SELECT
    messages.*,
    outbox.id AS outbox_id,
    outbox.client_event_id,
    outbox.projection_revision,
    outbox.projection_kind,
    outbox.previous_decision,
    outbox.reading_id,
    outbox.piece_id,
    outbox.lot_id,
    outbox.cell_id,
    outbox.machine_id,
    outbox.operator_id,
    outbox.shift_snapshot,
    outbox.step_code,
    outbox.decision,
    outbox.quantity,
    outbox.payload,
    outbox.created_at AS outbox_created_at,
    reading.date AS reading_date,
    reading.hour AS reading_hour,
    reading.cell_name,
    reading.machine_name,
    reading.operator AS operator_name,
    reading.reader_type,
    reading.tag_value,
    reading.lot_code,
    reading.load_number,
    reading.order_number,
    reading.production_order_id,
    reading.customer_name,
    reading.environment_name,
    piece.traceability_code,
    piece.current_stage,
    piece.legacy_production_lot_item_id,
    piece.pcp_import_batch_id,
    receipt.device_id
  FROM messages
  LEFT JOIN public.collection_projection_outbox outbox
    ON outbox.id = messages.outbox_id_from_message
   AND outbox.client_event_id = messages.client_event_id_from_message
  LEFT JOIN public.production_stage_readings reading ON reading.id = outbox.reading_id
  LEFT JOIN public.production_pieces piece ON piece.id = outbox.piece_id
  LEFT JOIN public.coletas_producao receipt
    ON receipt.client_event_id = outbox.client_event_id
   AND receipt.pipeline_version = 3;

  FOR v_item IN
    -- Ordem estável das chaves compartilhadas reduz ciclos entre projetores
    -- concorrentes; a coleta já foi decidida e não espera estes locks.
    SELECT *
    FROM pg_temp.collection_v3_projection_input
    ORDER BY lot_id NULLS LAST,
             step_code NULLS LAST,
             cell_id NULLS LAST,
             machine_id NULLS LAST,
             piece_id NULLS LAST,
             outbox_id NULLS LAST,
             ordinal
  LOOP
    v_sqlstate := NULL;
    v_error_message := NULL;
    v_entry_id := NULL;

    BEGIN
      IF v_item.queue_name <> 'collection_projection_v3'
         OR v_item.msg_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_QUEUE_MESSAGE_INVALID'
          USING ERRCODE = '22023';
      END IF;

      IF v_item.outbox_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_OUTBOX_NOT_FOUND'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_item.client_event_id IS DISTINCT FROM v_item.client_event_id_from_message THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_MESSAGE_MISMATCH'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.collection_projection_outbox outbox
        WHERE outbox.id = v_item.outbox_id
          AND outbox.projected_at IS NOT NULL
      ) THEN
        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', v_item.client_event_id,
          'projected', true,
          'idempotent_replay', true
        ));
        CONTINUE;
      END IF;

      IF v_item.lot_id IS NOT NULL
         AND v_item.step_code IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id,
           'lot_stage_shard',
           jsonb_build_object(
             'decision', v_item.decision,
             'previous_decision', v_item.previous_decision,
             'quantity', v_item.quantity,
             'projection_revision', v_item.projection_revision
           )
         ) THEN
        v_shard := (
          (
            hashtextextended(
              coalesce(v_item.piece_id::text, v_item.client_event_id), 0
            ) % 16
          ) + 16
        ) % 16;

        INSERT INTO public.production_lot_stage_counter_shards (
          lot_id, step_code, shard_number,
          approved_count, rejected_count, blocked_count,
          duplicated_count, pending_review_count, quantity_total,
          state_version, updated_at
        ) VALUES (
          v_item.lot_id, v_item.step_code, v_shard,
          CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
          1,
          clock_timestamp()
        )
        ON CONFLICT (lot_id, step_code, shard_number) DO UPDATE
        SET approved_count = public.production_lot_stage_counter_shards.approved_count + excluded.approved_count,
            rejected_count = public.production_lot_stage_counter_shards.rejected_count + excluded.rejected_count,
            blocked_count = public.production_lot_stage_counter_shards.blocked_count + excluded.blocked_count,
            duplicated_count = public.production_lot_stage_counter_shards.duplicated_count + excluded.duplicated_count,
            pending_review_count = public.production_lot_stage_counter_shards.pending_review_count + excluded.pending_review_count,
            quantity_total = public.production_lot_stage_counter_shards.quantity_total + excluded.quantity_total,
            state_version = public.production_lot_stage_counter_shards.state_version + 1,
            updated_at = excluded.updated_at;
      END IF;

      IF v_item.previous_decision = 'approved'
         AND v_item.decision <> 'approved'
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_entry_reversal', v_item.payload
         ) THEN
        -- A função de reprovação já pode ter feito este estorno. O predicado
        -- torna a compensação idempotente e também cobre correções emitidas
        -- por outros fluxos administrativos.
        UPDATE public.production_entries
        SET approval_status = 'reversed',
            correction_reason = coalesce(
              nullif(correction_reason, ''),
              'Estorno assíncrono Collection Fabric v3'
            ),
            corrected_by = coalesce(nullif(corrected_by, ''), 'collection_fabric_v3'),
            corrected_at = coalesce(corrected_at, clock_timestamp()),
            updated_at = clock_timestamp()
        WHERE client_event_id = v_item.client_event_id
          AND coalesce(approval_status, 'valid') = 'valid';
      END IF;

      IF v_item.reading_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'realtime_counter', v_item.payload
         ) THEN
        -- Aprovações são contabilizadas pelo trigger de production_entries.
        -- Aqui entram somente categorias não aprovadas e suas compensações;
        -- assim uma aprovação não soma duas vezes (projetor + entry trigger).
        IF v_item.decision <> 'approved'
           OR (
             v_item.previous_decision IS NOT NULL
             AND v_item.previous_decision <> 'approved'
           ) THEN
          PERFORM public.adjust_production_realtime_counter(
            coalesce(v_item.reading_date, current_date),
            v_item.lot_id,
            v_item.lot_code,
            v_item.load_number,
            v_item.order_number,
            v_item.customer_name,
            v_item.environment_name,
            v_item.cell_name,
            v_item.machine_id,
            v_item.machine_name,
            public.production_metric_unit_for_cell(
              v_item.cell_name, v_item.step_code, v_item.step_code
            ),
            NULL,
            0,
            0,
            CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
            CASE WHEN v_item.decision IN ('blocked', 'duplicated') THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision IN ('blocked', 'duplicated') THEN v_item.quantity ELSE 0 END,
            CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
          );
        END IF;
      END IF;

      IF v_item.decision = 'approved'
         AND v_item.reading_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_entry', v_item.payload
         ) THEN
        INSERT INTO public.production_entries (
          date, shift, cell, hour, produced, target, scrap, downtime,
          operator, notes, client_event_id, operator_id, production_order_id,
          order_id, lot_id, step_code, order_number, lot_code, load_number,
          customer_name, process_step, station_name, entry_mode, source,
          machine_id, machine_name, environment_name, operation_name,
          pcp_import_batch_id, metric_unit, metric_unit_label,
          realized_quantity, pieces_quantity
        ) VALUES (
          coalesce(v_item.reading_date, current_date),
          coalesce(nullif(v_item.shift_snapshot, ''), 'Não informado'),
          coalesce(nullif(v_item.cell_name, ''), 'Não informada'),
          coalesce(nullif(v_item.reading_hour, ''), to_char(clock_timestamp(), 'HH24:MI')),
          v_item.quantity, 0, 0, 0,
          v_item.operator_name,
          'Projeção assíncrona Collection Fabric v3',
          v_item.client_event_id, v_item.operator_id, v_item.production_order_id,
          v_item.production_order_id, v_item.lot_id, v_item.step_code,
          v_item.order_number, v_item.lot_code, v_item.load_number,
          v_item.customer_name, v_item.step_code, v_item.machine_name,
          'automatic', 'collection_fabric_v3',
          v_item.machine_id, v_item.machine_name,
          v_item.environment_name, v_item.step_code, v_item.pcp_import_batch_id,
          public.production_metric_unit_for_cell(v_item.cell_name, v_item.step_code, v_item.step_code),
          public.production_metric_unit_label(
            public.production_metric_unit_for_cell(v_item.cell_name, v_item.step_code, v_item.step_code)
          ),
          v_item.quantity, v_item.quantity
        )
        ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL
        DO UPDATE SET
          approval_status = 'valid',
          correction_reason = NULL,
          corrected_by = NULL,
          corrected_at = NULL,
          updated_at = clock_timestamp()
        RETURNING id INTO v_entry_id;

        UPDATE public.production_collection_events
        SET production_entry_id = v_entry_id,
            updated_at = clock_timestamp()
        WHERE client_event_id = v_item.client_event_id;

        UPDATE public.production_stage_readings
        SET production_entry_id = v_entry_id
        WHERE id = v_item.reading_id
          AND pipeline_version = 3;
      END IF;

      IF v_item.piece_id IS NOT NULL
         AND v_item.traceability_code IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_event', v_item.payload
         ) THEN
        INSERT INTO public.production_events (
          piece_id, traceability_code, production_order_id, lot_id,
          event_type, from_stage, to_stage, cell_name, machine_id, device_id,
          operator_id, event_status, rejection_reason, reading_source,
          barcode_raw_value, notes, metadata, legacy_stage_reading_id, created_at
        ) VALUES (
          v_item.piece_id, v_item.traceability_code, v_item.production_order_id, v_item.lot_id,
          CASE WHEN v_item.decision = 'approved' THEN 'stage_advance' ELSE 'block' END,
          NULL, v_item.step_code, v_item.cell_name, v_item.machine_id::text,
          v_item.device_id, v_item.operator_id,
          CASE v_item.decision
            WHEN 'approved' THEN 'accepted'
            WHEN 'rejected' THEN 'rejected'
            WHEN 'blocked' THEN 'blocked'
            WHEN 'duplicated' THEN 'duplicated'
            ELSE 'warning'
          END,
          CASE WHEN v_item.decision = 'approved' THEN NULL ELSE v_item.payload ->> 'reason_code' END,
          v_item.reader_type, v_item.tag_value,
          'Projeção assíncrona Collection Fabric v3',
          jsonb_build_object(
            'collection_pipeline_version', 3,
            'outbox_id', v_item.outbox_id,
            'client_event_id', v_item.client_event_id,
            'projection_revision', v_item.projection_revision,
            'projection_kind', v_item.projection_kind,
            'previous_decision', v_item.previous_decision
          ),
          v_item.reading_id,
          v_item.outbox_created_at
        );
      END IF;

      IF v_item.lot_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_lot_lifecycle', v_item.payload
         ) THEN
        -- O fechamento/troca de lote continua usando as regras legadas já
        -- homologadas, mas agora fora da transação que decide e trava a peça.
        IF v_item.decision = 'approved'
           AND v_item.legacy_production_lot_item_id IS NOT NULL THEN
          UPDATE public.production_lot_items legacy_item
          SET current_step = coalesce(
                (
                  SELECT routing_step.name
                  FROM public.routing_steps routing_step
                  WHERE routing_step.code = v_item.current_stage
                  LIMIT 1
                ),
                v_item.current_stage
              ),
              status = CASE
                WHEN v_item.current_stage = 'Concluída' THEN 'completed'
                ELSE 'in_progress'
              END,
              updated_at = clock_timestamp()
          WHERE legacy_item.id = v_item.legacy_production_lot_item_id;
        END IF;

        IF v_item.decision = 'approved'
           AND v_item.cell_name IS NOT NULL
           AND v_item.step_code IS NOT NULL
           AND to_regprocedure(
             'public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid)'
           ) IS NOT NULL THEN
          EXECUTE
            'SELECT public.switch_cell_active_lot_context($1, $2, $3, $4, $5)'
          USING v_item.cell_name, v_item.step_code, v_item.machine_id,
                v_item.lot_id, v_item.pcp_import_batch_id;
        END IF;

        IF v_item.cell_name IS NOT NULL
           AND v_item.step_code IS NOT NULL
           AND to_regprocedure(
             'public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)'
           ) IS NOT NULL THEN
          EXECUTE
            'SELECT public.recalculate_cell_lot_state($1, $2, $3, $4, $5)'
          USING v_item.lot_id, v_item.cell_name, v_item.step_code,
                v_item.machine_id, v_item.operator_id;
        END IF;

        IF to_regprocedure(
          'public.refresh_collection_lot_state(uuid,uuid)'
        ) IS NOT NULL THEN
          EXECUTE 'SELECT public.refresh_collection_lot_state($1, $2)'
          USING v_item.lot_id, v_item.operator_id;
        END IF;
      END IF;

      IF v_item.pcp_import_batch_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'pcp_batch_progress', v_item.payload
         ) THEN
        PERFORM public.refresh_pcp_batch_progress(v_item.pcp_import_batch_id);
      END IF;

      v_now := clock_timestamp();
      UPDATE public.collection_projection_outbox
      SET projected_at = v_now,
          projection_lag_ms = extract(epoch FROM (v_now - created_at)) * 1000,
          last_error_code = NULL
      WHERE id = v_item.outbox_id;

      UPDATE public.production_collection_events
      SET projected_at = v_now,
          updated_at = v_now
      WHERE client_event_id = v_item.client_event_id
        AND pipeline_version = 3;

      UPDATE public.coletas_producao
      SET projected_at = v_now,
          updated_at = v_now
      WHERE client_event_id = v_item.client_event_id
        AND pipeline_version = 3;

      PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);

      IF v_broadcast_enabled
         AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
        IF v_item.device_id IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', v_item.client_event_id,
              'outbox_id', v_item.outbox_id,
              'projection_revision', v_item.projection_revision,
              'projection_kind', v_item.projection_kind,
              'previous_decision', v_item.previous_decision,
              'decision', v_item.decision,
              'quantity', v_item.quantity,
              'cell_name', v_item.cell_name,
              'machine_id', v_item.machine_id,
              'operator_id', v_item.operator_id,
              'pcp_import_batch_id', v_item.pcp_import_batch_id,
              'delta', jsonb_build_object(
                'total', CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
                'approved',
                  CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
                'rejected',
                  CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
                'blocked',
                  CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
                'duplicated',
                  CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
                'pending',
                  CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              ),
              'projection_lag_ms', extract(epoch FROM (v_now - v_item.outbox_created_at)) * 1000,
              'projected_at', v_now
            ),
            'collection.projection_delta',
            'collection:device:' || v_item.device_id,
            true
          );
        END IF;

        IF v_item.cell_id IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', v_item.client_event_id,
              'outbox_id', v_item.outbox_id,
              'projection_revision', v_item.projection_revision,
              'projection_kind', v_item.projection_kind,
              'previous_decision', v_item.previous_decision,
              'decision', v_item.decision,
              'lot_id', v_item.lot_id,
              'step_code', v_item.step_code,
              'quantity', v_item.quantity,
              'cell_name', v_item.cell_name,
              'machine_id', v_item.machine_id,
              'operator_id', v_item.operator_id,
              'pcp_import_batch_id', v_item.pcp_import_batch_id,
              'delta', jsonb_build_object(
                'total', CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
                'approved',
                  CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
                'rejected',
                  CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
                'blocked',
                  CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
                'duplicated',
                  CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
                'pending',
                  CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              ),
              'projected_at', v_now
            ),
            'collection.projection_delta',
            'collection:cell:' || v_item.cell_id::text,
            true
          );
        END IF;
      END IF;

      v_result := jsonb_build_object(
        'outbox_id', v_item.outbox_id,
        'client_event_id', v_item.client_event_id,
        'projected', true,
        'projected_at', v_now
      );
      v_results := v_results || jsonb_build_array(v_result);
      v_finalized_count := v_finalized_count + 1;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      v_now := clock_timestamp();
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
        UPDATE public.collection_projection_outbox
        SET available_at = v_now + make_interval(secs => v_backoff_ms / 1000.0),
            attempt_count = greatest(attempt_count, v_item.read_ct),
            last_error_code = v_sqlstate
        WHERE id = v_item.outbox_id;

        v_result := jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'projected', false,
          'state', 'retrying',
          'reason_code', v_sqlstate,
          'retry_in_ms', v_backoff_ms
        );
      ELSE
        SELECT pgmq.send(
          'collection_dead_letter_v3',
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'projection',
            'source_queue', v_item.queue_name,
            'source_message_id', v_item.msg_id,
            'outbox_id', v_item.outbox_id,
            'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
            'attempts', coalesce(v_item.read_ct, 1),
            'sqlstate', v_sqlstate,
            'failed_at', v_now
          ))
        ) INTO v_dead_letter_message_id;

        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
        UPDATE public.collection_projection_outbox
        SET attempt_count = greatest(attempt_count, v_item.read_ct),
            last_error_code = v_sqlstate,
            dead_lettered_at = v_now
        WHERE id = v_item.outbox_id;

        v_result := jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'projected', false,
          'state', 'dead_lettered',
          'reason_code', CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE v_sqlstate END
        );
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

REVOKE ALL ON FUNCTION private.process_collection_projection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_collection_projection_batch_v3(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.process_collection_projection_batch_v3(
  p_worker_id text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
  SELECT private.process_collection_projection_batch_v3(p_worker_id, p_items);
$$;

REVOKE ALL ON FUNCTION public.process_collection_projection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_collection_projection_batch_v3(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_collection_projection_shards_v3(
  p_lot_id uuid DEFAULT NULL,
  p_step_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.collection_pipeline_flags flag
    WHERE flag.flag_name = 'collection_pipeline_v3_projection'
      AND flag.enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'PAUSE_COLLECTION_V3_PROJECTION_BEFORE_RECONCILIATION'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.production_lot_stage_counter_shards shard
  SET approved_count = 0,
      rejected_count = 0,
      blocked_count = 0,
      duplicated_count = 0,
      pending_review_count = 0,
      quantity_total = 0,
      state_version = shard.state_version + 1,
      updated_at = v_now
  WHERE (p_lot_id IS NULL OR shard.lot_id = p_lot_id)
    AND (p_step_code IS NULL OR shard.step_code = p_step_code);

  WITH canonical AS (
    SELECT
      reading.lot_id,
      reading.step_name AS step_code,
      (
        (
          hashtextextended(
            coalesce(reading.piece_id::text, reading.client_event_id), 0
          ) % 16
        ) + 16
      ) % 16 AS shard_number,
      sum(reading.quantity) FILTER (WHERE reading.status = 'approved')::bigint AS approved_count,
      sum(reading.quantity) FILTER (WHERE reading.status = 'rejected')::bigint AS rejected_count,
      sum(reading.quantity) FILTER (WHERE reading.status = 'blocked')::bigint AS blocked_count,
      sum(reading.quantity) FILTER (WHERE reading.status = 'duplicated')::bigint AS duplicated_count,
      sum(reading.quantity) FILTER (WHERE reading.status = 'pending_review')::bigint AS pending_review_count,
      sum(reading.quantity)::bigint AS quantity_total
    FROM public.production_stage_readings reading
    WHERE reading.pipeline_version = 3
      AND reading.lot_id IS NOT NULL
      AND reading.step_name IS NOT NULL
      AND (p_lot_id IS NULL OR reading.lot_id = p_lot_id)
      AND (p_step_code IS NULL OR reading.step_name = p_step_code)
    GROUP BY reading.lot_id, reading.step_name, shard_number
  )
  INSERT INTO public.production_lot_stage_counter_shards (
    lot_id, step_code, shard_number,
    approved_count, rejected_count, blocked_count, duplicated_count,
    pending_review_count, quantity_total, state_version, updated_at
  )
  SELECT
    canonical.lot_id, canonical.step_code, canonical.shard_number,
    coalesce(canonical.approved_count, 0), coalesce(canonical.rejected_count, 0),
    coalesce(canonical.blocked_count, 0), coalesce(canonical.duplicated_count, 0),
    coalesce(canonical.pending_review_count, 0), coalesce(canonical.quantity_total, 0),
    1, v_now
  FROM canonical
  ON CONFLICT (lot_id, step_code, shard_number) DO UPDATE
  SET approved_count = excluded.approved_count,
      rejected_count = excluded.rejected_count,
      blocked_count = excluded.blocked_count,
      duplicated_count = excluded.duplicated_count,
      pending_review_count = excluded.pending_review_count,
      quantity_total = excluded.quantity_total,
      state_version = public.production_lot_stage_counter_shards.state_version + 1,
      updated_at = excluded.updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'reconciled', true,
    'lot_id', p_lot_id,
    'step_code', p_step_code,
    'shards_written', v_rows,
    'reconciled_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_collection_projection_shards_v3(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_collection_projection_shards_v3(uuid, text)
  TO service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260901_acprod_collection_fabric_v3_projector',
  'collection-v3-idempotent-projector-shards-legacy-counters-reconciliation-dlq',
  'Projetor em lote, aplicação idempotente por tipo, shards módulo 16, espelhos legados, retry/DLQ e reconciliação a partir do ledger.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

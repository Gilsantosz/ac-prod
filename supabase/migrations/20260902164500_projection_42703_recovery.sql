-- Recuperação auditável e idempotente dos outboxes bloqueados pelo drift 42703.

SET check_function_bodies = on;

CREATE TABLE IF NOT EXISTS private.collection_projection_recovery_audit (
  run_id text NOT NULL,
  outbox_id uuid NOT NULL,
  client_event_id text NOT NULL,
  original_error_code text NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recovery_message_id bigint,
  status text NOT NULL,
  detail text,
  PRIMARY KEY (run_id, outbox_id),
  CONSTRAINT collection_projection_recovery_status_check
    CHECK (status IN ('requeued', 'skipped'))
);

REVOKE ALL ON TABLE private.collection_projection_recovery_audit
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recover_collection_projection_42703_v3(
  p_run_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pgmq, pg_temp
AS $$
DECLARE
  v_outbox record;
  v_message_id bigint;
  v_requeued integer := 0;
  v_skipped integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$' THEN
    RAISE EXCEPTION 'CAPACITY_RUN_ID_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.collection_pipeline_flags
    WHERE flag_name = 'collection_pipeline_v3_projection' AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'PAUSE_COLLECTION_V3_PROJECTION_BEFORE_RECOVERY' USING ERRCODE = '55000';
  END IF;

  FOR v_outbox IN
    SELECT outbox.*
    FROM public.collection_projection_outbox outbox
    WHERE outbox.projected_at IS NULL
      AND outbox.dead_lettered_at IS NOT NULL
      AND outbox.last_error_code = '42703'
    ORDER BY outbox.created_at, outbox.id
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.collection_projection_applied applied
      WHERE applied.outbox_id = v_outbox.id
    ) OR EXISTS (
      SELECT 1 FROM public.production_entries entry
      WHERE entry.client_event_id = v_outbox.client_event_id
    ) THEN
      INSERT INTO private.collection_projection_recovery_audit (
        run_id, outbox_id, client_event_id, original_error_code, status, detail
      ) VALUES (
        p_run_id, v_outbox.id, v_outbox.client_event_id, '42703', 'skipped',
        'canonical projection already exists'
      ) ON CONFLICT (run_id, outbox_id) DO NOTHING;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT pgmq.send(
      'collection_projection_v3',
      jsonb_build_object(
        'outbox_id', v_outbox.id,
        'client_event_id', v_outbox.client_event_id,
        'projection_revision', v_outbox.projection_revision,
        'recovery_run_id', p_run_id
      )
    ) INTO v_message_id;

    UPDATE public.collection_projection_outbox
    SET available_at = clock_timestamp(),
        dead_lettered_at = NULL,
        last_error_code = NULL
    WHERE id = v_outbox.id;

    PERFORM pgmq.archive('collection_dead_letter_v3', queue.msg_id)
    FROM pgmq.q_collection_dead_letter_v3 queue
    WHERE queue.message ->> 'kind' = 'projection'
      AND queue.message ->> 'sqlstate' = '42703'
      AND private.try_collection_uuid_v3(queue.message ->> 'outbox_id') = v_outbox.id;

    INSERT INTO private.collection_projection_recovery_audit (
      run_id, outbox_id, client_event_id, original_error_code,
      recovery_message_id, status, detail
    ) VALUES (
      p_run_id, v_outbox.id, v_outbox.client_event_id, '42703',
      v_message_id, 'requeued', 'schema contract restored; same outbox and client_event_id'
    ) ON CONFLICT (run_id, outbox_id) DO NOTHING;
    v_requeued := v_requeued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'requeued', v_requeued,
    'skipped', v_skipped,
    'recovered_at', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recover_collection_projection_42703_v3(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_collection_projection_42703_v3(text)
  TO service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260902_acprod_projection_42703_recovery',
  'projection-42703-idempotent-audited-requeue-v1',
  'Recuperação restrita aos outboxes 42703 sem projeção canônica, preservando IDs e evidência em arquivo PGMQ.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

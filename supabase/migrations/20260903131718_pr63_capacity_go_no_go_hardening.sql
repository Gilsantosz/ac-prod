-- PR #63: plano de controle executável, lease renovável e diagnóstico do
-- despacho dos workers para a próxima homologação GO/NO-GO.

SET check_function_bodies = on;

ALTER TABLE public.capacity_test_runs
  ADD COLUMN IF NOT EXISTS executor_id text,
  ADD COLUMN IF NOT EXISTS executor_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS control_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stop_reason text;

ALTER TABLE public.capacity_test_runs
  DROP CONSTRAINT IF EXISTS capacity_test_runs_status_check;
ALTER TABLE public.capacity_test_runs
  ADD CONSTRAINT capacity_test_runs_status_check
    CHECK (status IN (
      'requested', 'running', 'paused', 'cancel_requested', 'cancelled',
      'emergency_stopped', 'completed', 'failed'
    ));

ALTER TABLE public.capacity_test_runs
  DROP CONSTRAINT IF EXISTS capacity_test_runs_executor_id_check;
ALTER TABLE public.capacity_test_runs
  ADD CONSTRAINT capacity_test_runs_executor_id_check
    CHECK (
      executor_id IS NULL
      OR executor_id ~ '^[a-zA-Z0-9:_-]{1,160}$'
    );

ALTER TABLE public.capacity_test_runs
  DROP CONSTRAINT IF EXISTS capacity_test_runs_stop_reason_check;
ALTER TABLE public.capacity_test_runs
  ADD CONSTRAINT capacity_test_runs_stop_reason_check
    CHECK (stop_reason IS NULL OR length(stop_reason) BETWEEN 1 AND 240);

CREATE INDEX IF NOT EXISTS capacity_test_runs_created_by_idx
  ON public.capacity_test_runs (created_by);
CREATE UNIQUE INDEX IF NOT EXISTS capacity_test_runs_single_active_idx
  ON public.capacity_test_runs ((true))
  WHERE status IN ('requested', 'running', 'paused', 'cancel_requested');

DROP POLICY IF EXISTS capacity_test_runs_admin_select ON public.capacity_test_runs;
CREATE POLICY capacity_test_runs_admin_select ON public.capacity_test_runs
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1
  FROM public.profiles profile
  WHERE profile.id = (SELECT auth.uid())
    AND profile.active IS TRUE
    AND profile.role = 'admin'
));

CREATE OR REPLACE FUNCTION public.request_capacity_test_run(
  p_run_id text,
  p_config jsonb,
  p_confirmation text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.capacity_test_runs;
  v_profile text := coalesce(p_config ->> 'profile', '');
  v_target text := coalesce(p_config ->> 'target', '');
  v_sequence_base text := coalesce(p_config ->> 'sequence_base', '');
  v_devices integer;
  v_operators integer;
  v_pieces integer;
  v_duration_minutes integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.active IS TRUE
      AND profile.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'INICIAR TESTE CONTROLADO' THEN
    RAISE EXCEPTION 'CAPACITY_TEST_CONFIRMATION_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_run_id !~ '^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$'
     OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'CAPACITY_TEST_CONFIG_INVALID' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_config ->> 'devices', '') !~ '^[0-9]{1,6}$'
     OR coalesce(p_config ->> 'operators', '') !~ '^[0-9]{1,6}$'
     OR coalesce(p_config ->> 'pieces', '') !~ '^[0-9]{1,6}$'
     OR coalesce(p_config ->> 'duration_minutes', '') !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'CAPACITY_TEST_LIMIT_INVALID' USING ERRCODE = '22023';
  END IF;
  v_devices := (p_config ->> 'devices')::integer;
  v_operators := (p_config ->> 'operators')::integer;
  v_pieces := (p_config ->> 'pieces')::integer;
  v_duration_minutes := (p_config ->> 'duration_minutes')::integer;
  IF v_devices NOT BETWEEN 1 AND 100
     OR v_operators NOT BETWEEN 1 AND 14
     OR v_pieces NOT BETWEEN 1 AND 18000
     OR v_duration_minutes NOT BETWEEN 1 AND 60
     OR v_sequence_base !~ '^[1-9][0-9]{0,15}$'
     OR v_sequence_base::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'CAPACITY_TEST_LIMIT_EXCEEDED' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_profile = ANY (ARRAY[
    'smoke', 'idempotency', 'microbatch', 'priority', 'contention_piece',
    'contention_cell_lot', 'atomic8', 'nominal', 'burst'
  ]::text[])) OR v_target NOT IN ('staging', 'test-production') THEN
    RAISE EXCEPTION 'CAPACITY_TEST_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    (v_profile = 'smoke' AND v_devices = 1 AND v_pieces = 1 AND v_duration_minutes = 1)
    OR (v_profile = 'idempotency' AND v_devices = 20 AND v_pieces = 20 AND v_duration_minutes = 1)
    OR (v_profile = 'microbatch' AND v_devices = 5 AND v_pieces = 125 AND v_duration_minutes = 1)
    OR (v_profile = 'priority' AND v_devices = 100 AND v_pieces = 1625 AND v_duration_minutes = 1)
    OR (v_profile = 'contention_piece' AND v_devices = 20 AND v_pieces = 1 AND v_duration_minutes = 1)
    OR (v_profile = 'contention_cell_lot' AND v_devices = 50 AND v_pieces = 50 AND v_duration_minutes = 1)
    OR (v_profile = 'atomic8' AND v_devices = 8 AND v_pieces = 1 AND v_duration_minutes = 1)
    OR (v_profile = 'nominal' AND v_devices = 100 AND v_pieces = 18000 AND v_duration_minutes = 10)
    OR (v_profile = 'burst' AND v_devices = 100 AND v_pieces = 6000 AND v_duration_minutes = 1)
  ) THEN
    RAISE EXCEPTION 'CAPACITY_TEST_PROFILE_CONFIG_MISMATCH' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.capacity_test_runs (run_id, config, app_version)
  VALUES (p_run_id, p_config, left(p_config ->> 'app_version', 80))
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_capacity_test_run(text, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_capacity_test_run(text, jsonb, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.control_capacity_test_run(
  p_run_id text,
  p_action text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_next_status text;
  v_row public.capacity_test_runs;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.active IS TRUE
      AND profile.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.capacity_test_runs
  WHERE run_id = p_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RUN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_next_status := CASE
    WHEN p_action = 'pause' AND v_row.status = 'running' THEN 'paused'
    WHEN p_action = 'resume' AND v_row.status = 'paused' THEN 'running'
    WHEN p_action = 'cancel' AND v_row.status = 'requested' THEN 'cancelled'
    WHEN p_action = 'cancel' AND v_row.status IN ('running', 'paused') THEN 'cancel_requested'
    WHEN p_action = 'emergency_stop'
      AND v_row.status IN ('requested', 'running', 'paused', 'cancel_requested')
      THEN 'emergency_stopped'
    ELSE NULL
  END;
  IF v_next_status IS NULL THEN
    RAISE EXCEPTION 'CAPACITY_TEST_TRANSITION_INVALID' USING ERRCODE = '55000';
  END IF;

  UPDATE public.capacity_test_runs
  SET status = v_next_status,
      finished_at = CASE
        WHEN v_next_status IN ('cancelled', 'emergency_stopped')
          THEN clock_timestamp()
        ELSE finished_at
      END,
      stop_reason = CASE
        WHEN v_next_status = 'cancelled' THEN 'operator_cancel_before_claim'
        WHEN v_next_status = 'cancel_requested' THEN 'operator_cancel'
        WHEN v_next_status = 'emergency_stopped' THEN 'operator_emergency_stop'
        ELSE stop_reason
      END,
      control_revision = control_revision + 1,
      updated_at = clock_timestamp()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.control_capacity_test_run(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.control_capacity_test_run(text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.inspect_capacity_test_run_v3(
  p_run_id text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.capacity_test_runs;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row
  FROM public.capacity_test_runs
  WHERE run_id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RUN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_capacity_test_run_v3(
  p_run_id text,
  p_executor_id text
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_executor_id text := btrim(coalesce(p_executor_id, ''));
  v_row public.capacity_test_runs;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_executor_id !~ '^[a-zA-Z0-9:_-]{1,160}$' THEN
    RAISE EXCEPTION 'CAPACITY_EXECUTOR_ID_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.capacity_test_runs
  SET status = 'running',
      executor_id = v_executor_id,
      executor_heartbeat_at = clock_timestamp(),
      started_at = coalesce(started_at, clock_timestamp()),
      control_revision = control_revision + 1,
      updated_at = clock_timestamp()
  WHERE run_id = p_run_id
    AND status = 'requested'
    AND executor_id IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row
    FROM public.capacity_test_runs
    WHERE run_id = p_run_id
      AND executor_id = v_executor_id
      AND status = 'running';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RUN_NOT_CLAIMABLE' USING ERRCODE = '55000';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.observe_capacity_test_run_v3(
  p_run_id text,
  p_executor_id text,
  p_touch_heartbeat boolean DEFAULT false
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row public.capacity_test_runs;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF coalesce(p_touch_heartbeat, false) THEN
    UPDATE public.capacity_test_runs
    SET executor_heartbeat_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE run_id = p_run_id
      AND executor_id = p_executor_id
    RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_row
    FROM public.capacity_test_runs
    WHERE run_id = p_run_id
      AND executor_id = p_executor_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_EXECUTOR_OWNERSHIP_LOST' USING ERRCODE = '55000';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_capacity_test_run_v3(
  p_run_id text,
  p_executor_id text,
  p_outcome text,
  p_metrics jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT NULL
)
RETURNS public.capacity_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_final_status text;
  v_row public.capacity_test_runs;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object'
     OR octet_length(coalesce(p_metrics, '{}'::jsonb)::text) > 65536
     OR length(coalesce(nullif(btrim(p_reason), ''), 'ok')) > 240 THEN
    RAISE EXCEPTION 'CAPACITY_TEST_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.capacity_test_runs
  WHERE run_id = p_run_id
    AND executor_id = p_executor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAPACITY_EXECUTOR_OWNERSHIP_LOST' USING ERRCODE = '55000';
  END IF;

  IF v_row.status IN ('completed', 'failed', 'cancelled', 'emergency_stopped') THEN
    v_final_status := v_row.status;
  ELSIF v_row.status = 'cancel_requested' THEN
    v_final_status := 'cancelled';
  ELSIF p_outcome = 'completed' AND v_row.status = 'running' THEN
    v_final_status := 'completed';
  ELSIF p_outcome IN ('failed', 'cancelled', 'emergency_stopped')
        AND v_row.status IN ('running', 'paused') THEN
    v_final_status := p_outcome;
  ELSE
    RAISE EXCEPTION 'CAPACITY_TEST_FINISH_INVALID' USING ERRCODE = '55000';
  END IF;

  UPDATE public.capacity_test_runs
  SET status = v_final_status,
      metrics = coalesce(p_metrics, '{}'::jsonb),
      stop_reason = coalesce(nullif(left(btrim(p_reason), 240), ''), stop_reason),
      executor_heartbeat_at = clock_timestamp(),
      finished_at = coalesce(finished_at, clock_timestamp()),
      control_revision = control_revision + 1,
      updated_at = clock_timestamp()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.inspect_capacity_test_run_v3(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_capacity_test_run_v3(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.observe_capacity_test_run_v3(text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_capacity_test_run_v3(text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_capacity_test_run_v3(text),
  public.claim_capacity_test_run_v3(text, text),
  public.observe_capacity_test_run_v3(text, text, boolean),
  public.finish_capacity_test_run_v3(text, text, text, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.renew_collection_worker_lease_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_rows integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_worker_kind NOT IN ('decision', 'projection')
     OR coalesce(p_lease_owner, '') !~ '^[a-zA-Z0-9:_-]{1,160}$' THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_LEASE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE private.collection_worker_leases_v3
  SET heartbeat_at = v_now,
      expires_at = v_now + make_interval(
        secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))
      ),
      updated_at = v_now
  WHERE worker_kind = p_worker_kind
    AND lease_owner = p_lease_owner
    AND expires_at > v_now;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_collection_worker_lease_v3(
  p_secret text,
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_worker_kind NOT IN ('decision', 'projection')
     OR coalesce(p_lease_owner, '') !~ '^[a-zA-Z0-9:_-]{1,160}$' THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_LEASE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT public.verify_collection_worker_cron_secret(p_secret) THEN
    RETURN 'unauthorized';
  END IF;
  IF private.try_acquire_collection_worker_lease_v3(
    p_worker_kind, p_lease_owner, p_ttl_seconds
  ) THEN
    RETURN 'acquired';
  END IF;
  RETURN 'coalesced';
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_collection_worker_batch_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_worker_id text,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.renew_collection_worker_lease_v3(
    p_worker_kind, p_lease_owner, 120
  ) THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_LEASE_LOST' USING ERRCODE = '55000';
  END IF;

  IF p_worker_kind = 'decision' THEN
    RETURN public.claim_collection_batch_v3(p_worker_id, p_limit);
  ELSIF p_worker_kind = 'projection' THEN
    RETURN public.claim_collection_projection_batch_v3(p_worker_id, p_limit);
  END IF;
  RAISE EXCEPTION 'COLLECTION_V3_WORKER_KIND_INVALID' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.renew_collection_worker_lease_v3(text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_collection_worker_lease_v3(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_collection_worker_batch_v3(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_collection_worker_lease_v3(text, text, integer),
  public.begin_collection_worker_lease_v3(text, text, text, integer),
  public.claim_collection_worker_batch_v3(text, text, text, integer)
  TO service_role;

-- Mantém o wake transacional e acrescenta o instante de enfileiramento do
-- pg_net. O worker registra apenas a duração numérica, sem payload ou segredo.
CREATE OR REPLACE FUNCTION private.wake_collection_v3_worker(
  p_worker_kind text,
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 25
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, net, pgmq, pg_temp
AS $$
DECLARE
  v_url_name text;
  v_flag_name text;
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_has_work boolean := false;
  v_lease_owner text := 'wake:' || gen_random_uuid()::text;
  v_wake_enqueued_at timestamptz := clock_timestamp();
BEGIN
  IF p_worker_kind = 'decision' THEN
    v_url_name := 'acprod_collection_v3_decision_url';
    v_flag_name := 'collection_pipeline_v3_worker';
    SELECT EXISTS (
      SELECT 1 FROM pgmq.q_collection_live_v3 queue WHERE queue.vt <= clock_timestamp()
      UNION ALL
      SELECT 1 FROM pgmq.q_collection_replay_v3 queue WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSIF p_worker_kind = 'projection' THEN
    v_url_name := 'acprod_collection_v3_projection_url';
    v_flag_name := 'collection_pipeline_v3_projection';
    SELECT EXISTS (
      SELECT 1 FROM pgmq.q_collection_projection_v3 queue WHERE queue.vt <= clock_timestamp()
    ) INTO v_has_work;
  ELSE
    RAISE EXCEPTION 'COLLECTION_V3_WORKER_KIND_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT v_has_work OR NOT EXISTS (
    SELECT 1 FROM private.collection_pipeline_flags flag
    WHERE flag.flag_name = v_flag_name AND flag.enabled IS TRUE
  ) THEN
    RETURN NULL;
  END IF;

  IF current_setting('acprod.collection_v3_wake_' || p_worker_kind, true) = 'sent' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('acprod.collection_v3_wake_' || p_worker_kind, 'sent', true);

  IF NOT private.try_acquire_collection_worker_lease_v3(
    p_worker_kind, v_lease_owner, 45
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = v_url_name LIMIT 1;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    DELETE FROM private.collection_worker_leases_v3
    WHERE worker_kind = p_worker_kind AND lease_owner = v_lease_owner;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(5, least(coalesce(p_limit, 25), 25)),
      'max_rounds', 5,
      'lease_owner', v_lease_owner,
      'wake_enqueued_at', v_wake_enqueued_at
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_v3_worker(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.wake_collection_v3_worker(text, text, integer)
  TO postgres, service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260903_pr63_capacity_go_no_go_hardening',
  'capacity-control-executor-worker-lease-dispatch-observability-v1',
  'Executor controlado, transições fail-closed, heartbeat de lease e telemetria do despacho para homologação.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

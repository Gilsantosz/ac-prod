-- AC.Prod2 v8.8b — KPIs sem join, índices de leitura e worker contido.

CREATE OR REPLACE FUNCTION public.get_operator_shift_kpis_v2(
  p_operator_session_token text,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_session public.operator_sessions%ROWTYPE;
  v_window jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_inside boolean;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_blocked bigint := 0;
BEGIN
  IF auth.uid() IS NULL
     OR nullif(btrim(p_operator_session_token), '') IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session
  FROM public.operator_sessions session
  WHERE session.token_hash = encode(
      extensions.digest(p_operator_session_token, 'sha256'),
      'hex'
    )
    AND session.auth_user_id = auth.uid()
    AND session.ended_at IS NULL
    AND session.revoked_at IS NULL
    AND session.sync_grace_until > clock_timestamp()
  LIMIT 1;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  v_window := public.resolve_operator_shift_window(
    v_session.operator_id,
    p_reference_time
  );
  v_inside := coalesce(
    (v_window ->> 'is_inside_shift')::boolean,
    false
  );
  v_start := (v_window ->> 'shift_started_at')::timestamptz;
  v_end := (v_window ->> 'shift_ends_at')::timestamptz;

  IF v_inside THEN
    SELECT
      count(DISTINCT coalesce(reading.client_event_id, reading.id::text))
        FILTER (WHERE reading.status = 'approved'),
      count(DISTINCT coalesce(reading.client_event_id, reading.id::text))
        FILTER (WHERE reading.status = 'rejected'),
      count(DISTINCT coalesce(reading.client_event_id, reading.id::text))
        FILTER (WHERE reading.status IN ('blocked', 'duplicated'))
    INTO v_approved, v_rejected, v_blocked
    FROM public.production_stage_readings reading
    WHERE reading.operator_id = v_session.operator_id
      AND reading.created_at >= v_start
      AND reading.created_at < v_end;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'operator_id', v_session.operator_id,
    'shift_work_date', v_window ->> 'shift_work_date',
    'shift_started_at', v_start,
    'shift_ends_at', v_end,
    'is_inside_shift', v_inside,
    'approved', v_approved,
    'produced_this_shift', v_approved,
    'rejected', v_rejected,
    'blocked', v_blocked,
    'server_time', clock_timestamp()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_operator_shift_kpis_v2(
  p_operator_id uuid,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_window jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_inside boolean;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_blocked bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR p_operator_id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.operator_sessions session
    WHERE session.operator_id = p_operator_id
      AND session.auth_user_id = auth.uid()
      AND session.ended_at IS NULL
      AND session.revoked_at IS NULL
      AND session.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'OPERATOR_SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  v_window := public.resolve_operator_shift_window(
    p_operator_id,
    p_reference_time
  );
  v_inside := coalesce(
    (v_window ->> 'is_inside_shift')::boolean,
    false
  );
  v_start := (v_window ->> 'shift_started_at')::timestamptz;
  v_end := (v_window ->> 'shift_ends_at')::timestamptz;

  IF v_inside THEN
    SELECT
      count(DISTINCT coalesce(reading.client_event_id, reading.id::text))
        FILTER (WHERE reading.status = 'approved'),
      count(DISTINCT coalesce(reading.client_event_id, reading.id::text))
        FILTER (WHERE reading.status = 'rejected'),
      count(DISTINCT coalesce(reading.client_event_id, reading.id::text))
        FILTER (WHERE reading.status IN ('blocked', 'duplicated'))
    INTO v_approved, v_rejected, v_blocked
    FROM public.production_stage_readings reading
    WHERE reading.operator_id = p_operator_id
      AND reading.created_at >= v_start
      AND reading.created_at < v_end;
  END IF;

  RETURN jsonb_build_object(
    'operator_id', p_operator_id,
    'shift_work_date', v_window ->> 'shift_work_date',
    'shift_started_at', v_start,
    'shift_ends_at', v_end,
    'is_inside_shift', v_inside,
    'approved', v_approved,
    'produced_this_shift', v_approved,
    'rejected', v_rejected,
    'blocked', v_blocked,
    'server_time', clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(
  text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(
  text, timestamptz
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(
  uuid, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(
  uuid, timestamptz
) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_collection_events_history_cell_machine_time
  ON public.production_collection_events (
    lower(btrim(cell_name)),
    machine_id,
    coalesce(created_at_client, created_at) DESC,
    id DESC
  )
  INCLUDE (
    operator_id,
    shift,
    lot_id,
    result_status,
    status,
    reading_id,
    piece_id
  );

CREATE INDEX IF NOT EXISTS idx_stage_readings_operator_created_status
  ON public.production_stage_readings (
    operator_id,
    created_at DESC,
    status
  )
  INCLUDE (client_event_id);

CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker(
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 40
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret'
  LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(1, least(coalesce(p_limit, 40), 100)),
      'concurrency', 4,
      'max_rounds', 4
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 2000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'run-process-collection-inbox'
  ) THEN
    PERFORM cron.unschedule('run-process-collection-inbox');
  END IF;

  PERFORM cron.schedule(
    'run-process-collection-inbox',
    '* * * * *',
    $cron$
      SELECT private.wake_collection_inbox_worker(
        'cron-fallback',
        100
      );
    $cron$
  );
END;
$$;;

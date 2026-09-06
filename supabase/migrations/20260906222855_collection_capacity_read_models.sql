-- Restore capacity-test read model RPCs from the canonical v8.8/v8.9 contract.
-- Access is still scoped; no data rewriting or anonymous access.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.resolve_operator_shift_window(
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
  v_op public.operators%ROWTYPE;
  v_tz text;
  v_local_ref timestamp;
  v_local_date date;
  v_local_time time;
  v_work_date date;
  v_start_local timestamp;
  v_end_local timestamp;
  v_inside boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_op
  FROM public.operators
  WHERE id = p_operator_id;

  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  v_tz := coalesce(nullif(v_op.timezone, ''), 'America/Sao_Paulo');
  BEGIN
    v_local_ref := p_reference_time AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'America/Sao_Paulo';
    v_local_ref := p_reference_time AT TIME ZONE v_tz;
  END;

  v_local_date := v_local_ref::date;
  v_local_time := v_local_ref::time;

  IF v_op.shift_start_time < v_op.shift_end_time THEN
    v_work_date := v_local_date;
    v_start_local := v_local_date + v_op.shift_start_time;
    v_end_local := v_local_date + v_op.shift_end_time;
    v_inside := v_local_time >= v_op.shift_start_time
      AND v_local_time < v_op.shift_end_time;
  ELSE
    IF v_local_time >= v_op.shift_start_time THEN
      v_work_date := v_local_date;
      v_start_local := v_local_date + v_op.shift_start_time;
      v_end_local := (v_local_date + 1) + v_op.shift_end_time;
      v_inside := true;
    ELSIF v_local_time < v_op.shift_end_time THEN
      v_work_date := v_local_date - 1;
      v_start_local := (v_local_date - 1) + v_op.shift_start_time;
      v_end_local := v_local_date + v_op.shift_end_time;
      v_inside := true;
    ELSE
      v_work_date := v_local_date;
      v_start_local := v_local_date + v_op.shift_start_time;
      v_end_local := (v_local_date + 1) + v_op.shift_end_time;
      v_inside := false;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'operator_id', v_op.id,
    'shift_name', v_op.shift,
    'shift_start_time', v_op.shift_start_time,
    'shift_end_time', v_op.shift_end_time,
    'timezone', v_tz,
    'shift_work_date', v_work_date,
    'shift_started_at', v_start_local AT TIME ZONE v_tz,
    'shift_ends_at', v_end_local AT TIME ZONE v_tz,
    'is_inside_shift', v_inside
  );
END;
$$;

-- Internal helper is callable only through the scoped KPI endpoints.
REVOKE ALL ON FUNCTION public.resolve_operator_shift_window(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_operator_shift_window(uuid, timestamptz)
  TO service_role;

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
  IF auth.uid() IS NULL OR nullif(btrim(p_operator_session_token), '') IS NULL THEN
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
  v_inside := coalesce((v_window ->> 'is_inside_shift')::boolean, false);
  v_start := (v_window ->> 'shift_started_at')::timestamptz;
  v_end := (v_window ->> 'shift_ends_at')::timestamptz;

  IF v_inside THEN
    SELECT
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'approved'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'rejected'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status IN ('blocked', 'duplicated'))
    INTO v_approved, v_rejected, v_blocked
    FROM public.production_collection_events event
    WHERE event.operator_id = v_session.operator_id
      AND event.occurred_at >= v_start
      AND event.occurred_at < v_end;
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

  v_window := public.resolve_operator_shift_window(p_operator_id, p_reference_time);
  v_inside := coalesce((v_window ->> 'is_inside_shift')::boolean, false);
  v_start := (v_window ->> 'shift_started_at')::timestamptz;
  v_end := (v_window ->> 'shift_ends_at')::timestamptz;

  IF v_inside THEN
    SELECT
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'approved'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status = 'rejected'),
      count(DISTINCT coalesce(event.client_event_id, event.id::text))
        FILTER (WHERE event.result_status IN ('blocked', 'duplicated'))
    INTO v_approved, v_rejected, v_blocked
    FROM public.production_collection_events event
    WHERE event.operator_id = p_operator_id
      AND event.occurred_at >= v_start
      AND event.occurred_at < v_end;
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

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(text, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(text, timestamptz)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_operator_shift_kpis_v2(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_shift_kpis_v2(uuid, timestamptz)
  TO authenticated, service_role;


CREATE INDEX IF NOT EXISTS idx_collection_events_operator_window_cover_v89
  ON public.production_collection_events (operator_id, occurred_at DESC)
  INCLUDE (client_event_id, result_status, status);

CREATE INDEX IF NOT EXISTS idx_collection_lot_state_batch_scope_capacity
  ON public.production_cell_lot_states (
    pcp_import_batch_id, lower(btrim(cell_name)), lower(btrim(step_code)),
    coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  INCLUDE (expected_count, approved_count, rejected_count, pending_count,
           rework_count, replacement_count, state_version);

CREATE OR REPLACE FUNCTION public.get_collection_dashboard_snapshot_v3(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_pcp_import_batch_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $$
DECLARE
  v_step_code text;
  v_context public.production_cell_active_contexts%ROWTYPE;
  v_target_lot_id uuid;
  v_target_batch_id uuid;
  v_expected bigint := 0;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_state_version bigint := 0;
  v_cache_rows bigint := 0;
  v_fallback jsonb;
  v_metrics_source text := 'production_cell_lot_states';
BEGIN
  PERFORM private.assert_collection_read_scope(NULL, p_cell_name);

  v_step_code := coalesce(
    public.resolve_production_stage_for_cell(NULL, p_cell_name),
    '__unmapped_cell__'
  );

  SELECT * INTO v_context
  FROM public.production_cell_active_contexts context
  WHERE lower(btrim(context.cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(context.step_code)) = lower(btrim(v_step_code))
    AND coalesce(
          context.machine_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          p_workstation_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
  LIMIT 1;

  IF p_lot_id IS NOT NULL THEN
    v_target_lot_id := p_lot_id;
    v_target_batch_id := coalesce(
      p_pcp_import_batch_id,
      (
        SELECT lot.pcp_import_batch_id
        FROM public.production_lots lot
        WHERE lot.id = p_lot_id
      )
    );
  ELSIF p_pcp_import_batch_id IS NOT NULL THEN
    v_target_batch_id := p_pcp_import_batch_id;
  ELSIF v_context.active_pcp_import_batch_id IS NOT NULL THEN
    v_target_batch_id := v_context.active_pcp_import_batch_id;
  ELSIF v_context.active_lot_id IS NOT NULL THEN
    v_target_lot_id := v_context.active_lot_id;
  END IF;

  SELECT
    count(*),
    coalesce(sum(state.expected_count), 0),
    coalesce(sum(state.approved_count), 0),
    coalesce(sum(state.rejected_count), 0),
    coalesce(sum(state.pending_count), 0),
    coalesce(sum(state.rework_count), 0),
    coalesce(sum(state.replacement_count), 0),
    coalesce(max(state.state_version), 0)
  INTO
    v_cache_rows,
    v_expected,
    v_approved,
    v_rejected,
    v_pending,
    v_rework,
    v_replacement,
    v_state_version
  FROM public.production_cell_lot_states state
  WHERE lower(btrim(state.cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(state.step_code)) = lower(btrim(v_step_code))
    AND coalesce(
          state.machine_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          p_workstation_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
    AND (
      (v_target_lot_id IS NOT NULL AND state.lot_id = v_target_lot_id)
      OR (
        v_target_lot_id IS NULL
        AND v_target_batch_id IS NOT NULL
        AND state.pcp_import_batch_id = v_target_batch_id
      )
    );

  IF v_cache_rows = 0 THEN
    v_metrics_source := 'route_metrics_fallback';
    v_fallback := public.get_collection_route_stage_metrics(
      v_target_batch_id,
      v_target_lot_id,
      v_step_code
    );
    v_expected := coalesce((v_fallback ->> 'expected')::bigint, 0);
    v_approved := coalesce((v_fallback ->> 'approved')::bigint, 0);
    v_rejected := coalesce((v_fallback ->> 'rejected')::bigint, 0);
    v_pending := coalesce((v_fallback ->> 'pending')::bigint, 0);
    v_rework := coalesce((v_fallback ->> 'rework')::bigint, 0);
    v_replacement := coalesce((v_fallback ->> 'replacement')::bigint, 0);
  END IF;

  v_state_version := greatest(
    coalesce(v_state_version, 0),
    coalesce(v_context.state_version, 0)
  );

  RETURN jsonb_build_object(
    'server_time', clock_timestamp(),
    'reference_time', p_reference_time,
    'state_version', v_state_version,
    'step_code', v_step_code,
    'metrics_source', v_metrics_source,
    'active_context', CASE
      WHEN v_context.id IS NULL THEN NULL
      ELSE to_jsonb(v_context)
    END,
    'active_general_lots', CASE
      WHEN v_context.id IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'id', v_context.active_pcp_import_batch_id,
        'general_lot_code', v_context.active_general_lot_code,
        'lot_id', v_context.active_lot_id,
        'lot_code', v_context.active_lot_code,
        'state_version', v_context.state_version
      ))
    END,
    'lot_kpis', jsonb_build_object(
      'expected', v_expected,
      'approved', v_approved,
      'rejected', v_rejected,
      'pending', v_pending,
      'rework', v_rework,
      'replacement', v_replacement
    ),
    'expected', v_expected,
    'approved', v_approved,
    'rejected', v_rejected,
    'pending', v_pending,
    'rework', v_rework,
    'replacement', v_replacement,
    'total', v_expected
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_dashboard_snapshot_v3(
  text, uuid, uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_dashboard_snapshot_v3(
  text, uuid, uuid, uuid, uuid, timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_collection_dashboard_snapshot_v2(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_pcp_import_batch_id uuid DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_reference_time timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT public.get_collection_dashboard_snapshot_v3(
    p_cell_name,
    p_workstation_id,
    p_operator_id,
    p_pcp_import_batch_id,
    p_lot_id,
    p_reference_time
  );
$$;

REVOKE ALL ON FUNCTION public.get_collection_dashboard_snapshot_v2(
  text, uuid, uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_dashboard_snapshot_v2(
  text, uuid, uuid, uuid, uuid, timestamptz
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

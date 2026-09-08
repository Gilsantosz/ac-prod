-- Promotion reviewed against production uozuzdfvnufsjsonswag on 2026-09-07.
-- Apply as ONE transaction through apply_migration. No flags, timeouts of
-- application roles, user sessions, production readings or API routes changed.
-- The eight staging patches are consolidated so intermediate definitions that
-- reference an absent batch.updated_at column are never visible after commit.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
DO $production_preconditions$
DECLARE item record;
BEGIN
  IF to_regclass('private.collection_dashboard_batch_snapshots') IS NOT NULL THEN
    RAISE EXCEPTION 'CAPACITY_PROMOTION_ALREADY_PRESENT_OR_SCHEMA_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM pgmq.q_collection_live_v3)
     OR EXISTS (SELECT 1 FROM pgmq.q_collection_replay_v3)
     OR EXISTS (SELECT 1 FROM pgmq.q_collection_projection_v3)
     OR EXISTS (SELECT 1 FROM pgmq.q_collection_dead_letter_v3)
     OR EXISTS (SELECT 1 FROM public.collection_projection_outbox
                WHERE projected_at IS NULL AND dead_lettered_at IS NULL) THEN
    RAISE EXCEPTION 'CAPACITY_PROMOTION_REQUIRES_DRAINED_QUEUES';
  END IF;
  -- regprocedure accepts argument types only; pg_get_function_identity_arguments
  -- also includes parameter names and must not be passed through unchanged.
  FOR item IN SELECT * FROM (VALUES
      ('private.process_collection_batch_v3(text, jsonb)', '2a97588896ae453ff00d75757ded779a'),
      ('private.process_collection_projection_batch_v3(text, jsonb)', '5037a27cef142d08f51e2374a78ef002'),
      ('private.release_collection_worker_slot_v3(text, text)', '475095a55981d6ffaf7f3d6d9f1dbb1c'),
      ('private.try_acquire_collection_worker_slot_v3(text, text, integer, integer)', '4cbca233fb6ff489cd8035a54f034e83'),
      ('public.get_collection_dashboard_snapshot_v2(text, uuid, uuid, uuid, uuid, timestamp with time zone)', '723030054fc7f7fef2f693220c669881'),
      ('public.get_collection_dashboard_snapshot_v3(text, uuid, uuid, uuid, uuid, timestamp with time zone)', 'c691854dd163b81892c04f1f97131c30'),
      ('public.get_collection_dashboard_snapshot_v3(text, uuid, text, uuid, uuid, timestamp with time zone)', 'b386004cd44b40858a7785da53af76ab'),
      ('public.get_lot_route_stage_progress(uuid)', 'a67b54f1bb0f29287ed8e54e1e13c6a7'),
      ('public.get_operator_shift_kpis_v2(uuid, timestamp with time zone)', '78dc31f16cf5f3bdab7f32fdbe1599b1'),
      ('public.get_operator_shift_kpis_v2(text, timestamp with time zone)', '61c91e31dd23c6ab3db52b6dad00acc9'),
      ('public.process_collection_batch_v3(text, jsonb)', 'abc465ff561f061f4b52e0d9712097c3'),
      ('public.process_collection_projection_batch_v3(text, jsonb)', 'b6343a37bca6a8651f28c51bfd67a5fb'),
      ('public.release_collection_worker_slot_v3(text, text)', '90260a8159d20cf4e13e37f1ed87afc3'),
      ('public.resolve_operator_shift_window(uuid, timestamp with time zone)', 'da352c76cf3ab29eb9a306b12cd036a5'),
      ('public.run_collection_worker_cycle_v3(text, text, text, text, integer)', '906581049c72a66ed9f568d2ec152b57'),
      ('public.sync_pcp_batch_progress_from_piece()', '1ddb194bc8eae5b900812c1225e4c388')
    ) baseline(signature, definition_md5)
  LOOP
    IF to_regprocedure(item.signature) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(item.signature)))
            IS DISTINCT FROM item.definition_md5 THEN
      RAISE EXCEPTION 'CAPACITY_PRODUCTION_BASELINE_CHANGED: %', item.signature;
    END IF;
  END LOOP;
END;
$production_preconditions$;

-- Source: 20260906222855_collection_capacity_read_models.sql
-- Restore capacity-test read model RPCs from the canonical v8.8/v8.9 contract.
-- Access is still scoped; no data rewriting or anonymous access.
-- Inherits the transaction's bounded lock_timeout.

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


-- Source: 20260906223156_collection_capacity_batch_read_model.sql
-- Complete batch read model: no partial-lot sum and no machine double count.
-- Inherits the transaction's bounded lock_timeout.
CREATE TABLE IF NOT EXISTS private.collection_dashboard_batch_snapshots (
  pcp_import_batch_id uuid NOT NULL REFERENCES public.promob_import_batches(id) ON DELETE CASCADE,
  cell_name text NOT NULL,
  step_code text NOT NULL,
  expected_count bigint NOT NULL DEFAULT 0,
  approved_count bigint NOT NULL DEFAULT 0,
  rejected_count bigint NOT NULL DEFAULT 0,
  pending_count bigint NOT NULL DEFAULT 0,
  rework_count bigint NOT NULL DEFAULT 0,
  replacement_count bigint NOT NULL DEFAULT 0,
  state_version bigint NOT NULL DEFAULT 1,
  snapshot_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (pcp_import_batch_id, cell_name, step_code)
);
ALTER TABLE private.collection_dashboard_batch_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.collection_dashboard_batch_snapshots FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.refresh_collection_dashboard_batch_snapshot(
  p_pcp_import_batch_id uuid, p_cell_name text, p_step_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $fn$
DECLARE
  v_metrics jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_pcp_import_batch_id IS NULL OR nullif(btrim(p_cell_name), '') IS NULL
     OR nullif(btrim(p_step_code), '') IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_BATCH_SNAPSHOT_SCOPE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  v_metrics := public.get_collection_route_stage_metrics(p_pcp_import_batch_id, NULL, p_step_code);
  INSERT INTO private.collection_dashboard_batch_snapshots AS cached (
    pcp_import_batch_id, cell_name, step_code,
    expected_count, approved_count, rejected_count, pending_count,
    rework_count, replacement_count, snapshot_at
  ) VALUES (
    p_pcp_import_batch_id, lower(btrim(p_cell_name)), lower(btrim(p_step_code)),
    coalesce((v_metrics->>'expected')::bigint,0), coalesce((v_metrics->>'approved')::bigint,0),
    coalesce((v_metrics->>'rejected')::bigint,0), coalesce((v_metrics->>'pending')::bigint,0),
    coalesce((v_metrics->>'rework')::bigint,0), coalesce((v_metrics->>'replacement')::bigint,0),
    statement_timestamp()
  ) ON CONFLICT (pcp_import_batch_id, cell_name, step_code) DO UPDATE SET
    expected_count = excluded.expected_count, approved_count = excluded.approved_count,
    rejected_count = excluded.rejected_count, pending_count = excluded.pending_count,
    rework_count = excluded.rework_count, replacement_count = excluded.replacement_count,
    state_version = cached.state_version + 1,
    snapshot_at = excluded.snapshot_at, updated_at = clock_timestamp()
  -- An older concurrent SQL snapshot must not overwrite a newer projection.
  WHERE cached.snapshot_at <= excluded.snapshot_at;
END;
$fn$;
REVOKE ALL ON FUNCTION private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)
  TO service_role;

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
    AND (p_workstation_id IS NULL OR context.machine_id = p_workstation_id)
  ORDER BY context.last_event_occurred_at DESC NULLS LAST, context.updated_at DESC
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

  IF v_target_lot_id IS NULL AND v_target_batch_id IS NOT NULL THEN
    -- A batch must include ALL its lots, including lots not scanned yet.
    -- Summing only workstation/lot caches silently truncates the planned universe.
    SELECT 1, cache.expected_count, cache.approved_count, cache.rejected_count,
           cache.pending_count, cache.rework_count, cache.replacement_count,
           cache.state_version
    INTO v_cache_rows, v_expected, v_approved, v_rejected, v_pending,
         v_rework, v_replacement, v_state_version
    FROM private.collection_dashboard_batch_snapshots cache
    WHERE cache.pcp_import_batch_id = v_target_batch_id
      AND cache.cell_name = lower(btrim(p_cell_name))
      AND cache.step_code = lower(btrim(v_step_code));
    IF NOT FOUND THEN v_cache_rows := 0; END IF;
    v_metrics_source := 'collection_dashboard_batch_snapshots';
  ELSE
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
  END IF;

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


-- Source: 20260906223310_collection_capacity_backend.sql
-- Reviewed against the installed V3 functions, 2026-09-06.
-- No feature flags, SLOs, session policies or production data are changed.
-- Claim + effects + idempotency checkpoints + queue archive remain atomic.
SET check_function_bodies = on;

-- Only the authenticated V3 worker may defer the shared PCP projection.
-- Piece validation, unique approval and per-piece locks remain unchanged.
CREATE OR REPLACE FUNCTION public.process_collection_batch_v3(
  p_worker_id text, p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $function$
DECLARE
  v_previous text := coalesce(current_setting('acprod.collection_v3_decision', true), '');
  v_result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('acprod.collection_v3_decision', 'on', true);
  v_result := private.process_collection_batch_v3(p_worker_id, p_items);
  PERFORM set_config('acprod.collection_v3_decision', v_previous, true);
  RETURN v_result;
EXCEPTION WHEN OTHERS OR query_canceled THEN
  PERFORM set_config('acprod.collection_v3_decision', v_previous, true);
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_collection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_collection_batch_v3(text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_pcp_batch_progress_from_piece()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF current_setting('acprod.collection_v3_decision', true) = 'on'
     AND coalesce(auth.role(), '') = 'service_role' THEN
    -- The decision writes its durable projection outbox in the same transaction.
    -- No shared import-batch row is updated while the piece locks are held.
    RETURN NEW;
  END IF;
  -- Preserve production's existing import guard: the import RPC performs
  -- one authoritative batch refresh after attaching its new pieces.
  IF OLD.pcp_import_batch_id IS NULL AND NEW.pcp_import_batch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.pcp_import_batch_id IS DISTINCT FROM NEW.pcp_import_batch_id
     AND OLD.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(OLD.pcp_import_batch_id);
  END IF;
  IF NEW.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(NEW.pcp_import_batch_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_pcp_batch_progress_from_piece()
  FROM PUBLIC, anon, authenticated;

-- Preserve the public function OID/ACL and its INVOKER security semantics.
-- Only service-role projectors enter the private transaction-local cache;
-- ordinary callers keep executing the original canonical query under RLS.
DO $capacity_route_cache$
DECLARE
  v_definition text;
  v_source text;
BEGIN
  IF to_regprocedure('private.get_lot_route_stage_progress_uncached_capacity(uuid)') IS NULL THEN
    SELECT pg_get_functiondef(p.oid), p.prosrc INTO v_definition, v_source
    FROM pg_proc p WHERE p.oid = 'public.get_lot_route_stage_progress(uuid)'::regprocedure;
    IF position('LANGUAGE sql' IN v_definition) = 0
       OR position('SECURITY DEFINER' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'COLLECTION_V3_CAPACITY_ROUTE_QUERY_SHAPE_CHANGED';
    END IF;
    EXECUTE replace(v_definition,
      'FUNCTION public.get_lot_route_stage_progress(',
      'FUNCTION private.get_lot_route_stage_progress_uncached_capacity(');
    EXECUTE format($wrapper$
      CREATE OR REPLACE FUNCTION public.get_lot_route_stage_progress(p_batch_id uuid)
      RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
      AS $function$
      DECLARE v_result jsonb;
      BEGIN
        IF coalesce(auth.role(), '') = 'service_role'
           AND current_setting('acprod.collection_v3_projection_cache', true) = 'on' THEN
          -- Dynamic resolution keeps private-schema privileges out of normal
          -- API calls; no SECURITY DEFINER/RLS bypass is introduced.
          EXECUTE 'SELECT private.get_lot_route_stage_progress_cached_capacity($1)'
            INTO v_result USING p_batch_id;
          RETURN v_result;
        END IF;
        RETURN (%s);
      END;
      $function$;
    $wrapper$, regexp_replace(v_source, ';[[:space:]]*$', ''));
  END IF;
END;
$capacity_route_cache$;

CREATE OR REPLACE FUNCTION private.get_lot_route_stage_progress_cached_capacity(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, private, pg_temp
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     OR coalesce(current_setting('acprod.collection_v3_projection_cache', true), '') <> 'on' THEN
    RAISE EXCEPTION 'COLLECTION_V3_PROJECTION_CACHE_CONTEXT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_batch_id IS NULL THEN
    RETURN private.get_lot_route_stage_progress_uncached_capacity(p_batch_id);
  END IF;
  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache
  WHERE batch_id = p_batch_id;
  IF FOUND THEN RETURN v_result; END IF;
  v_result := private.get_lot_route_stage_progress_uncached_capacity(p_batch_id);
  INSERT INTO pg_temp.collection_v3_route_progress_cache(batch_id, progress)
    VALUES(p_batch_id, v_result);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.get_lot_route_stage_progress_uncached_capacity(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_lot_route_stage_progress_cached_capacity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_lot_route_stage_progress_uncached_capacity(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.get_lot_route_stage_progress_cached_capacity(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.process_collection_projection_batch_v3(
  p_worker_id text, p_items jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $function$
DECLARE
  v_previous text := coalesce(current_setting('acprod.collection_v3_projection_cache', true), '');
  v_result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_result := private.process_collection_projection_batch_v3(p_worker_id, p_items);
  PERFORM set_config('acprod.collection_v3_projection_cache', v_previous, true);
  RETURN v_result;
EXCEPTION WHEN OTHERS OR query_canceled THEN
  PERFORM set_config('acprod.collection_v3_projection_cache', v_previous, true);
  RAISE;
END;
$function$;
REVOKE ALL ON FUNCTION public.process_collection_projection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_collection_projection_batch_v3(text, jsonb)
  TO service_role;

-- Installed projector contains compatibility patches; preserve them and fail
-- closed if its exact structural markers changed. Do not overwrite a runtime
-- with an older copied migration.
DO $capacity_projection$
DECLARE
  v_definition text := pg_get_functiondef(
    'private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure
  );
  v_start integer;
  v_end integer;
  v_broadcast text;
  v_finalize text;
BEGIN
  IF position('collection_v3_capacity_coalesced_v1' IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF to_regprocedure('private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_V3_CAPACITY_BATCH_SNAPSHOT_REQUIRED';
  END IF;

  v_start := position(E'        IF v_item.decision = ''approved''\n           AND v_item.cell_name IS NOT NULL' IN v_definition);
  v_end := position(E'      v_now := clock_timestamp();\n      UPDATE public.collection_projection_outbox' IN v_definition);
  IF v_start = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'COLLECTION_V3_CAPACITY_PROJECTOR_LIFECYCLE_SHAPE_CHANGED';
  END IF;
  -- Keep each legacy-item update, but consolidate context, lifecycle and PCP
  -- once per affected scope after all successful row-level projections.
  v_definition := left(v_definition, v_start - 1)
    || E'      END IF;\n\n'
    || substring(v_definition FROM v_end);

  v_start := position(E'      IF v_broadcast_enabled\n         AND to_regprocedure(''realtime.send(jsonb,text,text,boolean)'') IS NOT NULL THEN' IN v_definition);
  v_end := position(E'      v_result := jsonb_build_object(\n        ''outbox_id'', v_item.outbox_id,\n        ''client_event_id'', v_item.client_event_id,\n        ''projected'', true,' IN v_definition);
  IF v_start = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'COLLECTION_V3_CAPACITY_PROJECTOR_BROADCAST_SHAPE_CHANGED';
  END IF;
  v_broadcast := substring(v_definition FROM v_start FOR v_end - v_start);
  v_definition := left(v_definition, v_start - 1) || substring(v_definition FROM v_end);

  v_finalize := $finalize$
  -- collection_v3_capacity_coalesced_v1
  -- This is still the SAME database transaction. Any failure rolls back the
  -- checkpoints, effects and archives together; replay cannot double-count.
  CREATE TEMP TABLE pg_temp.collection_v3_projection_success
  ON COMMIT DROP AS
  SELECT input.*, outbox.projected_at
  FROM pg_temp.collection_v3_projection_input input
  JOIN public.collection_projection_outbox outbox ON outbox.id = input.outbox_id
  JOIN jsonb_to_recordset(v_results) result(
    outbox_id uuid, projected boolean, idempotent_replay boolean
  ) ON result.outbox_id = input.outbox_id
  WHERE result.projected IS TRUE
    AND coalesce(result.idempotent_replay, false) IS FALSE;

  -- Activate only AFTER row-level effects. All downstream calculations see one
  -- canonical route snapshot per import, discarded on commit/rollback.
  CREATE TEMP TABLE pg_temp.collection_v3_route_progress_cache (
    batch_id uuid PRIMARY KEY, progress jsonb NOT NULL
  ) ON COMMIT DROP;
  PERFORM set_config('acprod.collection_v3_projection_cache', 'on', true);

  -- Latest event wins for each station; delayed replay cannot restore an old lot.
  FOR v_item IN
    SELECT DISTINCT ON (cell_name, step_code, machine_id) *
    FROM pg_temp.collection_v3_projection_success
    WHERE decision = 'approved' AND lot_id IS NOT NULL
      AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY cell_name, step_code, machine_id,
             outbox_created_at DESC, client_event_id DESC
  LOOP
    PERFORM public.switch_cell_active_lot_context(
      v_item.cell_name, v_item.step_code, v_item.machine_id,
      v_item.lot_id, v_item.pcp_import_batch_id,
      v_item.outbox_created_at, v_item.client_event_id
    );
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT ON (lot_id, cell_name, step_code, machine_id) *
    FROM pg_temp.collection_v3_projection_success
    WHERE lot_id IS NOT NULL AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY lot_id, cell_name, step_code, machine_id,
             outbox_created_at DESC, client_event_id DESC
  LOOP
    PERFORM public.recalculate_cell_lot_state(
      v_item.lot_id, v_item.cell_name, v_item.step_code,
      v_item.machine_id, v_item.operator_id
    );
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT lot_id FROM pg_temp.collection_v3_projection_success
    WHERE lot_id IS NOT NULL ORDER BY lot_id
  LOOP
    -- Parameter two is a reading UUID, NOT an operator UUID. NULL deliberately
    -- requests a single canonical rebuild for all readings of this batch/lot.
    PERFORM public.refresh_collection_lot_state(v_item.lot_id, NULL::uuid);
    UPDATE public.production_stage_readings reading
    SET lot_state_version = lot.state_version
    FROM public.production_lots lot,
         pg_temp.collection_v3_projection_success success
    WHERE lot.id = v_item.lot_id AND success.lot_id = lot.id
      AND reading.id = success.reading_id AND reading.pipeline_version = 3;
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT success.pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success success
    WHERE success.pcp_import_batch_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.production_lots lot
        JOIN pg_temp.collection_v3_projection_success refreshed ON refreshed.lot_id = lot.id
        WHERE lot.pcp_import_batch_id = success.pcp_import_batch_id
      )
    ORDER BY success.pcp_import_batch_id
  LOOP
    PERFORM public.refresh_pcp_batch_progress(v_item.pcp_import_batch_id);
  END LOOP;
  PERFORM private.mark_collection_projection_v3(
    success.outbox_id, 'pcp_batch_progress', success.payload
  )
  FROM pg_temp.collection_v3_projection_success success
  WHERE success.pcp_import_batch_id IS NOT NULL;

  -- The batch dashboard must cover every required lot, including untouched
  -- lots. Summing only populated per-machine lot states undercounts planning.
  FOR v_item IN
    SELECT DISTINCT pcp_import_batch_id, cell_name, step_code
    FROM pg_temp.collection_v3_projection_success
    WHERE pcp_import_batch_id IS NOT NULL
      AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY pcp_import_batch_id, cell_name, step_code
  LOOP
    PERFORM private.refresh_collection_dashboard_batch_snapshot(
      v_item.pcp_import_batch_id, v_item.cell_name, v_item.step_code
    );
  END LOOP;

  -- Timestamp the COMPLETED projection, not the earlier row-level checkpoint.
  -- All three public surfaces and emitted deltas share this same final time.
  v_now := clock_timestamp();
  UPDATE public.collection_projection_outbox outbox
  SET projected_at = v_now,
      projection_lag_ms = extract(epoch FROM (v_now - outbox.created_at)) * 1000
  FROM pg_temp.collection_v3_projection_success success
  WHERE outbox.id = success.outbox_id;
  UPDATE public.production_collection_events event
  SET projected_at = v_now, updated_at = v_now
  FROM pg_temp.collection_v3_projection_success success
  WHERE event.client_event_id = success.client_event_id AND event.pipeline_version = 3;
  UPDATE public.coletas_producao receipt
  SET projected_at = v_now, updated_at = v_now
  FROM pg_temp.collection_v3_projection_success success
  WHERE receipt.client_event_id = success.client_event_id AND receipt.pipeline_version = 3;
  UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now;
  SELECT coalesce(jsonb_agg(
    CASE WHEN success.outbox_id IS NOT NULL THEN
      result.value || jsonb_build_object('projected_at', v_now)
    ELSE result.value END ORDER BY result.ordinality
  ), '[]'::jsonb) INTO v_results
  FROM jsonb_array_elements(v_results) WITH ORDINALITY result(value, ordinality)
  LEFT JOIN pg_temp.collection_v3_projection_success success
    ON success.outbox_id = (result.value ->> 'outbox_id')::uuid;

  -- Enqueue broadcasts only after all snapshots and lifecycle state agree.
  FOR v_item IN SELECT * FROM pg_temp.collection_v3_projection_success LOOP
    v_now := v_item.projected_at;
$finalize$ || v_broadcast || E'  END LOOP;\n\n';

  v_start := position(E'  UPDATE private.collection_worker_heartbeats\n  SET heartbeat_at' IN v_definition);
  IF v_start = 0 THEN
    RAISE EXCEPTION 'COLLECTION_V3_CAPACITY_PROJECTOR_FINALIZE_SHAPE_CHANGED';
  END IF;
  v_definition := left(v_definition, v_start - 1) || v_finalize
    || substring(v_definition FROM v_start);
  EXECUTE v_definition;
END;
$capacity_projection$;

-- A mixed-scope batch must fit the EXISTING eight-second PostgREST timeout.
-- Decision still accepts 25 lightweight events; projection caps at five.
DO $capacity_cycle$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.run_collection_worker_cycle_v3(text,text,text,text,integer)'::regprocedure
  );
  v_old text := E'    v_flag_name := ''collection_pipeline_v3_projection'';\n    v_default_slots := 4;';
  v_new text := E'    v_flag_name := ''collection_pipeline_v3_projection'';\n    v_default_slots := 4;\n    v_limit := least(v_limit, 5); -- bounded projection budget';
BEGIN
  IF position('bounded projection budget' IN v_definition) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'COLLECTION_V3_CAPACITY_CYCLE_SHAPE_CHANGED';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$capacity_cycle$;

REVOKE ALL ON FUNCTION private.process_collection_projection_batch_v3(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_collection_projection_batch_v3(text, jsonb)
  TO service_role;
NOTIFY pgrst, 'reload schema';


-- Source: 20260906223719_collection_capacity_cache_revision.sql
-- A cached dashboard is valid only for the import revision it actually read.
-- External PCP/quality edits invalidate it without serving indefinitely stale totals.
ALTER TABLE private.collection_dashboard_batch_snapshots
  ADD COLUMN IF NOT EXISTS source_batch_updated_at timestamptz;

DO $revision$
DECLARE v_definition text;
BEGIN
  v_definition := pg_get_functiondef('private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)'::regprocedure);
  IF position('source_batch_updated_at' IN v_definition) = 0 THEN
    IF position('rework_count, replacement_count, snapshot_at' IN v_definition) = 0
       OR position('statement_timestamp()' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'COLLECTION_BATCH_CACHE_REVISION_SHAPE_CHANGED';
    END IF;
    v_definition := replace(v_definition, 'rework_count, replacement_count, snapshot_at',
      'rework_count, replacement_count, source_batch_updated_at, snapshot_at');
    v_definition := replace(v_definition, E'    statement_timestamp()\n',
      E'    (SELECT batch.updated_at FROM public.promob_import_batches batch WHERE batch.id = p_pcp_import_batch_id),\n    statement_timestamp()\n');
    v_definition := replace(v_definition, 'snapshot_at = excluded.snapshot_at,',
      'source_batch_updated_at = excluded.source_batch_updated_at, snapshot_at = excluded.snapshot_at,');
    EXECUTE v_definition;
  END IF;

  v_definition := pg_get_functiondef('public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure);
  IF position('source_batch_updated_at' IN v_definition) = 0 THEN
    IF position('FROM private.collection_dashboard_batch_snapshots cache' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'COLLECTION_BATCH_CACHE_READ_SHAPE_CHANGED';
    END IF;
    v_definition := replace(v_definition,
      'FROM private.collection_dashboard_batch_snapshots cache',
      E'FROM private.collection_dashboard_batch_snapshots cache\n    JOIN public.promob_import_batches batch ON batch.id = cache.pcp_import_batch_id\n      AND cache.source_batch_updated_at IS NOT DISTINCT FROM batch.updated_at');
    EXECUTE v_definition;
  END IF;
END;
$revision$;
NOTIFY pgrst, 'reload schema';


-- Source: 20260906223903_collection_capacity_revision_clock.sql
-- Import batches predate updated_at. Add an explicit read-model revision clock
-- without relying on a column that does not exist in the isolated schema.
ALTER TABLE public.promob_import_batches
  ADD COLUMN IF NOT EXISTS collection_snapshot_updated_at timestamptz;

CREATE OR REPLACE FUNCTION private.stamp_collection_batch_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $stamp$
BEGIN
  NEW.collection_snapshot_updated_at := clock_timestamp();
  RETURN NEW;
END;
$stamp$;
REVOKE ALL ON FUNCTION private.stamp_collection_batch_revision() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_collection_batch_revision
  BEFORE INSERT OR UPDATE ON public.promob_import_batches
  FOR EACH ROW EXECUTE FUNCTION private.stamp_collection_batch_revision();

DO $fix$
DECLARE v_definition text;
BEGIN
  v_definition := pg_get_functiondef('private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)'::regprocedure);
  EXECUTE replace(v_definition, 'SELECT batch.updated_at FROM public.promob_import_batches',
     'SELECT batch.collection_snapshot_updated_at FROM public.promob_import_batches');
  v_definition := pg_get_functiondef('public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure);
  EXECUTE replace(v_definition, 'cache.source_batch_updated_at IS NOT DISTINCT FROM batch.updated_at',
     'cache.source_batch_updated_at IS NOT DISTINCT FROM batch.collection_snapshot_updated_at');
END;
$fix$;
NOTIFY pgrst, 'reload schema';


-- Source: 20260906224341_collection_capacity_safeupdate.sql
-- Keep pg-safeupdate enabled in PostgREST sessions. The success worktable is
-- transaction-local, but UPDATE still requires an explicit qualified scope.
DO $patch$
DECLARE
  v_definition text := pg_get_functiondef(
    'private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure
  );
  v_unqualified text := 'UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now;';
BEGIN
  IF position(v_unqualified IN v_definition) = 0 THEN
    RAISE EXCEPTION 'COLLECTION_V3_SAFEUPDATE_PROJECTOR_SHAPE_CHANGED';
  END IF;
  v_definition := replace(v_definition, v_unqualified,
    'UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now WHERE outbox_id IS NOT NULL;');
  EXECUTE v_definition;
END;
$patch$;

NOTIFY pgrst, 'reload schema';


-- Source: 20260906224745_collection_capacity_nonblocking_slots.sql
-- Slot ownership remains a persisted, expiring lease. Advisory try-locks only
-- coordinate attempts inside a transaction so occupied slot 1 cannot serialize
-- unrelated workers before they can inspect slots 2..N.
CREATE OR REPLACE FUNCTION private.try_acquire_collection_worker_slot_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45,
  p_max_slots integer DEFAULT 4
)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_owner text := left(btrim(coalesce(p_lease_owner, '')), 160);
  v_max_slots integer := greatest(1, least(coalesce(p_max_slots, 4), 16));
  v_slot smallint;
  v_candidate integer;
BEGIN
  IF p_worker_kind NOT IN ('decision', 'projection') OR v_owner = '' THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_SLOT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- One lease owner cannot claim two slots through concurrent retries.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'acprod:v3:worker-owner:' || p_worker_kind || ':' || v_owner, 0
  )) THEN
    RETURN NULL;
  END IF;

  SELECT slot_number INTO v_slot FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind AND lease_owner = v_owner;
  IF FOUND THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(
      'acprod:v3:worker-slot:' || p_worker_kind || ':' || v_slot::text, 0
    )) THEN
      RETURN NULL;
    END IF;
    UPDATE private.collection_worker_slots_v3
    SET heartbeat_at = v_now,
        expires_at = v_now + make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))),
        updated_at = v_now
    WHERE worker_kind = p_worker_kind AND slot_number = v_slot AND lease_owner = v_owner
    RETURNING slot_number INTO v_slot;
    IF FOUND THEN RETURN v_slot; END IF;
  END IF;

  FOR v_candidate IN 1..v_max_slots LOOP
    -- Do not even acquire a lock on a healthy lease owned by another worker.
    IF EXISTS (SELECT 1 FROM private.collection_worker_slots_v3
      WHERE worker_kind = p_worker_kind AND slot_number = v_candidate
        AND expires_at > v_now) THEN
      CONTINUE;
    END IF;
    BEGIN
      IF NOT pg_try_advisory_xact_lock(hashtextextended(
        'acprod:v3:worker-slot:' || p_worker_kind || ':' || v_candidate::text, 0
      )) THEN
        CONTINUE;
      END IF;
      v_slot := NULL;
      INSERT INTO private.collection_worker_slots_v3 (
        worker_kind, slot_number, lease_owner,
        acquired_at, heartbeat_at, expires_at, updated_at
      ) VALUES (
        p_worker_kind, v_candidate, v_owner, v_now, v_now,
        v_now + make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))), v_now
      )
      ON CONFLICT (worker_kind, slot_number) DO UPDATE
      SET lease_owner = excluded.lease_owner,
          acquired_at = excluded.acquired_at,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      WHERE private.collection_worker_slots_v3.expires_at <= v_now
      RETURNING slot_number INTO v_slot;
      IF v_slot IS NOT NULL THEN RETURN v_slot; END IF;

      -- A lease may have renewed between the initial read and try-lock. Roll
      -- back this candidate subtransaction to release its unused lock before
      -- processing another slot for a potentially long worker transaction.
      RAISE EXCEPTION 'COLLECTION_WORKER_SLOT_RACED' USING ERRCODE = 'ZV301';
    EXCEPTION WHEN SQLSTATE 'ZV301' THEN
      CONTINUE;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.release_collection_worker_slot_v3(
  p_worker_kind text, p_lease_owner text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
DECLARE
  v_owner text := left(btrim(coalesce(p_lease_owner, '')), 160);
  v_slot smallint;
  v_rows integer;
BEGIN
  -- Same order as acquire: owner then slot. A duplicate/release request never
  -- waits on an in-flight worker; its lease will be released later or expire.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'acprod:v3:worker-owner:' || p_worker_kind || ':' || v_owner, 0
  )) THEN RETURN false; END IF;
  SELECT slot_number INTO v_slot FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind AND lease_owner = v_owner;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'acprod:v3:worker-slot:' || p_worker_kind || ':' || v_slot::text, 0
  )) THEN RETURN false; END IF;
  DELETE FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind AND slot_number = v_slot AND lease_owner = v_owner;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION private.try_acquire_collection_worker_slot_v3(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.release_collection_worker_slot_v3(text, text)
  FROM PUBLIC, anon, authenticated, service_role;


-- Source: 20260906225452_collection_capacity_route_precedence.sql
-- Explicit routes are authoritative over legacy requires flags. Changes only
-- derived route counts; no piece, reading, session or authorization writes.
-- Inherits the transaction's bounded lock_timeout.

DO $route_precedence$
DECLARE
  v_signature text;
  v_definition text;
  -- Match the exact production baseline, which names its canonical array route_steps.
  v_old_required text := $old$
    case stage.stage_code
      when 'cut' then coalesce(piece.requires_cut, false) or stage.stage_code = any(piece.route_steps)
      when 'edge' then coalesce(piece.requires_edge, false) or stage.stage_code = any(piece.route_steps)
      when 'drill' then stage.stage_code = any(piece.route_steps)
      when 'cnc' then coalesce(piece.requires_cnc, false) or stage.stage_code = any(piece.route_steps)
      when 'joinery' then coalesce(piece.requires_joinery, false) or coalesce(piece.manual_joinery, false) or stage.stage_code = any(piece.route_steps)
      when 'separation' then coalesce(piece.requires_separation, false) or stage.stage_code = any(piece.route_steps)
      when 'packaging' then coalesce(piece.requires_packaging, false) or stage.stage_code = any(piece.route_steps)
      else false
    end as is_required,$old$;
  v_new_required text := $new$
    -- collection_route_precedence_v1: explicit routes beat stale requires flags.
    case when piece.has_explicit_route then
      stage.stage_code = any(piece.route_steps)
    else public.piece_requires_routing_step(
      stage.stage_code, NULL::text[], piece.requires_cut, piece.requires_edge,
      piece.requires_cnc,
      coalesce(piece.requires_joinery,false) or coalesce(piece.manual_joinery,false),
      piece.requires_separation, piece.requires_packaging
    ) end as is_required,$new$;
BEGIN
  -- Both bodies embed the same canonical query: the public fallback executes
  -- under its caller's RLS; the private original feeds the worker-only cache.
  FOREACH v_signature IN ARRAY ARRAY[
    'private.get_lot_route_stage_progress_uncached_capacity(uuid)',
    'public.get_lot_route_stage_progress(uuid)'
  ] LOOP
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
    IF position('collection_route_precedence_v1' IN v_definition)>0 THEN CONTINUE; END IF;
    IF position(v_old_required IN v_definition)=0
       OR position('    root.manual_joinery,' IN v_definition)=0
       OR (SELECT procedure.prosecdef FROM pg_proc procedure WHERE procedure.oid=v_signature::regprocedure) THEN
      RAISE EXCEPTION 'COLLECTION_ROUTE_PRECEDENCE_QUERY_SHAPE_CHANGED: %',v_signature;
    END IF;
    v_definition:=replace(v_definition,'    root.manual_joinery,',
      E'    root.manual_joinery,\n    cardinality(coalesce(root.route_steps, ''{}''::text[])) > 0 as has_explicit_route,');
    v_definition:=replace(v_definition,v_old_required,v_new_required);
    EXECUTE v_definition;
  END LOOP;

  -- A deployment may become visible between two statements of a worker
  -- transaction. Clear only its OWN temporary memoization once for this rule
  -- version; never reuse a previous rule's result for another batch refresh.
  v_definition:=pg_get_functiondef('private.get_lot_route_stage_progress_cached_capacity(uuid)'::regprocedure);
  IF position('collection_route_precedence_v1' IN v_definition)=0 THEN
    IF position('  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache' IN v_definition)=0 THEN
      RAISE EXCEPTION 'COLLECTION_ROUTE_PRECEDENCE_TEMP_CACHE_SHAPE_CHANGED';
    END IF;
    v_definition:=replace(v_definition,
      '  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache',
      E'  IF coalesce(current_setting(''acprod.collection_route_precedence_v1'',true),'''') <> ''on'' THEN\n    DELETE FROM pg_temp.collection_v3_route_progress_cache WHERE batch_id IS NOT NULL;\n    PERFORM set_config(''acprod.collection_route_precedence_v1'',''on'',true);\n  END IF;\n  SELECT progress INTO v_result FROM pg_temp.collection_v3_route_progress_cache');
    EXECUTE v_definition;
  END IF;
END;
$route_precedence$;

-- Only derived caches are invalidated. -infinity cannot match a real import
-- revision (including NULL), so the scoped RPC falls back until safely warmed.
UPDATE private.collection_dashboard_batch_snapshots
SET source_batch_updated_at='-infinity'::timestamptz
WHERE source_batch_updated_at IS DISTINCT FROM '-infinity'::timestamptz;

NOTIFY pgrst,'reload schema';

-- Verify the final candidate in this same transaction before publication.
DO $production_postconditions$
BEGIN
  IF position('collection_v3_capacity_coalesced_v1' IN pg_get_functiondef('private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure)) = 0
     OR position('WHERE outbox_id IS NOT NULL' IN pg_get_functiondef('private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure)) = 0
     OR position('bounded projection budget' IN pg_get_functiondef('public.run_collection_worker_cycle_v3(text,text,text,text,integer)'::regprocedure)) = 0
     OR position('collection_route_precedence_v1' IN pg_get_functiondef('public.get_lot_route_stage_progress(uuid)'::regprocedure)) = 0
     OR position('collection_snapshot_updated_at' IN pg_get_functiondef('public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)) = 0
     OR position('OLD.pcp_import_batch_id IS NULL AND NEW.pcp_import_batch_id IS NOT NULL' IN pg_get_functiondef('public.sync_pcp_batch_progress_from_piece()'::regprocedure)) = 0
     OR position('pg_try_advisory_xact_lock' IN pg_get_functiondef('private.try_acquire_collection_worker_slot_v3(text,text,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CAPACITY_PRODUCTION_POSTCONDITION_FAILED';
  END IF;
  IF has_function_privilege('anon', 'public.get_collection_dashboard_snapshot_v2(text,uuid,uuid,uuid,uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated','private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)','EXECUTE')
     OR has_table_privilege('authenticated','private.collection_dashboard_batch_snapshots','SELECT') THEN
    RAISE EXCEPTION 'CAPACITY_PRODUCTION_BROWSER_ISOLATION_FAILED';
  END IF;
END;
$production_postconditions$;
NOTIFY pgrst, 'reload schema';

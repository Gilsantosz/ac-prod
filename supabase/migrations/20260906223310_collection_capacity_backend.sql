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

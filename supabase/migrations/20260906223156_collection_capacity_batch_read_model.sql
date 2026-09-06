-- Complete batch read model: no partial-lot sum and no machine double count.
SET lock_timeout = '3s';
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

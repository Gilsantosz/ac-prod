-- AC.Prod2 v8.8a — sanitização do ledger e dashboard cache-first.

CREATE OR REPLACE FUNCTION private.sanitize_collection_event_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  NEW.payload := coalesce(NEW.payload, '{}'::jsonb)
    - 'operatorSessionToken'
    - 'operator_session_token'
    - 'session_token';
  NEW.result_payload := coalesce(NEW.result_payload, '{}'::jsonb)
    - 'operatorSessionToken'
    - 'operator_session_token'
    - 'session_token';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sanitize_collection_event_payload()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_sanitize_collection_event_payload
  ON public.production_collection_events;
CREATE TRIGGER trg_sanitize_collection_event_payload
BEFORE INSERT OR UPDATE ON public.production_collection_events
FOR EACH ROW
EXECUTE FUNCTION private.sanitize_collection_event_payload();

UPDATE public.production_collection_events
SET payload = coalesce(payload, '{}'::jsonb)
      - 'operatorSessionToken'
      - 'operator_session_token'
      - 'session_token',
    result_payload = coalesce(result_payload, '{}'::jsonb)
      - 'operatorSessionToken'
      - 'operator_session_token'
      - 'session_token',
    updated_at = clock_timestamp()
WHERE payload ?| ARRAY[
        'operatorSessionToken',
        'operator_session_token',
        'session_token'
      ]
   OR result_payload ?| ARRAY[
        'operatorSessionToken',
        'operator_session_token',
        'session_token'
      ];

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
  ELSIF v_context.active_pcp_import_batch_id IS NOT NULL THEN
    v_target_batch_id := v_context.active_pcp_import_batch_id;
  ELSIF v_context.active_lot_id IS NOT NULL THEN
    v_target_lot_id := v_context.active_lot_id;
  ELSIF p_pcp_import_batch_id IS NOT NULL THEN
    v_target_batch_id := p_pcp_import_batch_id;
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
) TO authenticated, service_role;;

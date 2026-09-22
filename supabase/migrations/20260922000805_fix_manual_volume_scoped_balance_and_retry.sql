-- Manual volume: authorize the requested aggregate once, not every piece.
-- Existing per-piece RLS, stage policies and quantitative writer remain intact.
CREATE OR REPLACE FUNCTION public.get_manual_volume_stage_progress(
  p_batch_id uuid, p_cell_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_cell record;
  v_role text := public.get_my_role();
  v_progress jsonb;
  v_stage jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_role IS NULL OR NOT coalesce(
    v_role IN ('admin', 'manager', 'supervisor')
    OR public.has_permission('register_manual_production'), false
  ) THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.name, public.resolve_production_stage_for_cell(c.id, c.name) AS stage_code
  INTO v_cell FROM public.cells c
  WHERE c.active IS TRUE
    AND public.normalize_production_name(c.name) = public.normalize_production_name(p_cell_name)
  ORDER BY c.created_at, c.id LIMIT 1;
  IF v_cell.id IS NULL THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_CELL_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF NOT public.profile_can_access_cell(v_cell.name) THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_OUTSIDE_CELL_SCOPE' USING ERRCODE = '42501';
  END IF;
  -- Preserve the batch-list permission; return only this authorized stage.
  IF NOT coalesce(public.has_permission('view_traceability')
    OR public.has_permission('view_pcp') OR v_role IN ('admin', 'manager'), false) THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_BATCH_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.promob_import_batches b
    WHERE b.id = p_batch_id AND b.general_lot_code IS NOT NULL
      AND b.status NOT IN ('cancelled', 'error', 'duplicated', 'failed_validation')
  ) THEN
    RETURN jsonb_build_object('batch_id', p_batch_id, 'stage_progress', NULL);
  END IF;

  -- Same authoritative accounting used by the authorized quantitative writer.
  -- Do not expose lot_stages, individual pieces, or other stages to the caller.
  v_progress := public.get_lot_route_stage_progress(p_batch_id);
  SELECT s.value INTO v_stage
  FROM jsonb_array_elements(coalesce(v_progress->'batch_stages', '[]'::jsonb)) s(value)
  WHERE s.value->>'stage_code' = v_cell.stage_code LIMIT 1;
  RETURN jsonb_build_object('batch_id', p_batch_id, 'stage_progress', v_stage);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_manual_volume_stage_progress(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manual_volume_stage_progress(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.get_manual_volume_stage_progress(uuid, text) IS
  'Authorized manual-volume stage aggregate; avoids per-piece RLS amplification without exposing other stages.';

CREATE OR REPLACE FUNCTION public.register_untraceable_stage_quantity(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_requested_cell text := nullif(btrim(p_payload->>'cell_name'), '');
  v_role text := public.get_my_role();
  v_cell record;
  v_session record;
  v_token text := nullif(btrim(p_payload->>'operatorSessionToken'), '');
  v_sanitized jsonb := coalesce(p_payload, '{}'::jsonb);
  v_event_id text := coalesce(nullif(btrim(p_payload->>'client_event_id'), ''),
    'manual-volume-' || gen_random_uuid()::text);
  v_existing public.manual_production_records%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Keep the existing explicit manual-production permission. No new role grants.
  IF auth.uid() IS NULL OR v_role IS NULL OR NOT coalesce(
    v_role IN ('admin', 'manager', 'supervisor')
    OR public.has_permission('register_manual_production'), false
  ) THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_PERMISSION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_requested_cell IS NULL THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_CELL_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT c.id, c.name INTO v_cell FROM public.cells c
  WHERE c.active IS TRUE
    AND public.resolve_production_stage_for_cell(c.id, c.name)
      = public.resolve_production_stage_for_cell(NULL, v_requested_cell)
  ORDER BY CASE WHEN public.normalize_production_name(c.name)
    = public.normalize_production_name(v_requested_cell) THEN 0 ELSE 1 END,
    c.created_at, c.id LIMIT 1;
  IF v_cell.id IS NULL THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_CELL_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.profile_can_access_cell(v_cell.name) THEN
    RAISE EXCEPTION 'MANUAL_PRODUCTION_OUTSIDE_CELL_SCOPE' USING ERRCODE = '42501';
  END IF;
  v_sanitized := v_sanitized || jsonb_build_object('cell_name', v_cell.name,
    'client_event_id', v_event_id);

  -- Existing administrative entry screens need no operational session.
  -- When the collection screen supplies a token, validate it; never silently fall back.
  IF v_token IS NOT NULL THEN
    SELECT s.*, o.name AS operator_name, o.shift AS operator_shift
    INTO v_session FROM public.operator_sessions s
    JOIN public.operators o ON o.id = s.operator_id
    WHERE s.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
      AND s.auth_user_id = auth.uid() AND s.ended_at IS NULL AND s.revoked_at IS NULL
      AND s.expires_at > clock_timestamp() AND o.active IS TRUE
      AND coalesce(o.login_enabled, true);
    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'OPERATOR_SESSION_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_session.cell_id IS DISTINCT FROM v_cell.id
      OR v_session.machine_id IS NULL
      OR nullif(p_payload->>'deviceId', '') IS DISTINCT FROM v_session.device_id
      OR NOT EXISTS (
        SELECT 1 FROM public.operator_cell_assignments a
        WHERE a.operator_id = v_session.operator_id AND a.cell_id = v_cell.id
          AND a.active IS TRUE AND a.valid_from <= clock_timestamp()
          AND (a.valid_until IS NULL OR a.valid_until > clock_timestamp())
      ) OR NOT EXISTS (
        SELECT 1 FROM public.production_machines m
        WHERE m.id = v_session.machine_id AND m.active IS TRUE
          AND m.allows_normal_production IS TRUE AND m.cell_name = v_cell.name
      ) THEN
      RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.operator_machine_assignments a
      WHERE a.operator_id = v_session.operator_id AND a.active IS TRUE
        AND a.valid_from <= clock_timestamp() AND (a.valid_until IS NULL OR a.valid_until > clock_timestamp())
    ) AND NOT EXISTS (
      SELECT 1 FROM public.operator_machine_assignments a
      WHERE a.operator_id = v_session.operator_id AND a.machine_id = v_session.machine_id
        AND a.active IS TRUE AND a.valid_from <= clock_timestamp()
        AND (a.valid_until IS NULL OR a.valid_until > clock_timestamp())
    ) THEN
      RAISE EXCEPTION 'OPERATOR_CONTEXT_REQUIRED' USING ERRCODE = '42501';
    END IF;
    v_sanitized := v_sanitized || jsonb_build_object(
      'operator', v_session.operator_name,
      'shift', coalesce(v_session.shift_snapshot, v_session.operator_shift, '1º Turno'));
  END IF;

  -- Serialize retries of one event before the existing writer checks idempotency.
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-volume:' || v_event_id, 0));
  SELECT * INTO v_existing FROM public.manual_production_records r
  WHERE r.client_event_id = v_event_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.created_by IS DISTINCT FROM auth.uid()
      OR v_existing.pcp_import_batch_id::text IS DISTINCT FROM v_sanitized->>'pcp_import_batch_id'
      OR v_existing.general_lot_code IS DISTINCT FROM upper(btrim(v_sanitized->>'general_lot_code'))
      OR v_existing.cell_name IS DISTINCT FROM v_cell.name
      OR v_existing.quantity IS DISTINCT FROM (v_sanitized->>'quantity')::integer THEN
      RAISE EXCEPTION 'MANUAL_PRODUCTION_EVENT_CONFLICT' USING ERRCODE = '22023';
    END IF;
    RETURN coalesce(v_existing.metadata->'manual_volume_result', jsonb_build_object(
      'success', true, 'record_id', v_existing.id,
      'production_entry_id', v_existing.production_entry_id,
      'batch_id', v_existing.pcp_import_batch_id, 'general_lot_code', v_existing.general_lot_code,
      'cell_name', v_existing.cell_name, 'quantity', v_existing.quantity,
      'remaining_after', v_existing.metadata->'remaining_after'
    )) || jsonb_build_object('duplicated', true);
  END IF;

  v_result := public.register_untraceable_stage_quantity_impl(v_sanitized);
  IF coalesce((v_result->>'success')::boolean, false) THEN
    UPDATE public.manual_production_records
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'manual_volume_result', v_result - 'progress')
    WHERE id = (v_result->>'record_id')::uuid;
    IF v_token IS NOT NULL THEN
      UPDATE public.manual_production_records
      SET metadata = metadata || jsonb_build_object('operator_id', v_session.operator_id,
        'operator_session_id', v_session.id, 'machine_id', v_session.machine_id)
      WHERE id = (v_result->>'record_id')::uuid;
      UPDATE public.production_entries
      SET operator_id = v_session.operator_id, operator_name_snapshot = v_session.operator_name,
        machine_id = v_session.machine_id, machine_name = v_session.machine_name_snapshot
      WHERE id = (v_result->>'production_entry_id')::uuid;
    END IF;
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.register_untraceable_stage_quantity(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_untraceable_stage_quantity(jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

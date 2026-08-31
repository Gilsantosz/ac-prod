-- AC.Prod2 — exact 8-digit fast collection contract v8.5.
-- Physical/manual/camera production scans must contain exactly eight numeric
-- digits. Leading zeros are preserved. RFID/API integrations remain unchanged.

CREATE OR REPLACE FUNCTION public.normalize_collection_scan_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]', '', 'g') ~ '^[0-9]{8}$'
      THEN regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]', '', 'g')
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_collection_scan_code(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_collection_scan_code(text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_production_reading_v2(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, realtime, pg_temp
AS $$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_result jsonb;
  v_client_event_id text;
  v_reader_type text := lower(coalesce(
    nullif(btrim(v_payload ->> 'readerType'), ''),
    nullif(btrim(v_payload ->> 'reader_type'), ''),
    'keyboard_barcode'
  ));
  v_raw_value text := coalesce(
    v_payload ->> 'rawValue',
    v_payload ->> 'raw_value',
    v_payload ->> 'tagValue',
    ''
  );
  v_scan_code text;
  v_digit_count integer;
BEGIN
  v_client_event_id := nullif(btrim(v_payload ->> 'client_event_id'), '');

  IF v_reader_type IN ('keyboard_barcode', 'camera_qrcode', 'camera_barcode', 'manual') THEN
    v_scan_code := public.normalize_collection_scan_code(v_raw_value);
    v_digit_count := length(regexp_replace(coalesce(v_raw_value, ''), '[^0-9]', '', 'g'));

    IF v_scan_code IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'invalid',
        'reason_code', 'INVALID_CODE_LENGTH',
        'alert_level', 'red',
        'message', CASE
          WHEN v_digit_count > 8 THEN 'ENTRADA BLOQUEADA: a numeração excedeu o limite de 8 dígitos.'
          WHEN v_digit_count < 8 THEN format(
            'ENTRADA BLOQUEADA: informe exatamente 8 dígitos. Recebidos: %s.',
            v_digit_count
          )
          ELSE 'ENTRADA BLOQUEADA: a numeração deve conter somente 8 dígitos numéricos.'
        END,
        'expected_code_length', 8,
        'received_digit_count', v_digit_count,
        'client_event_id', v_client_event_id
      );
    END IF;

    v_payload := jsonb_set(v_payload, '{rawValue}', to_jsonb(v_scan_code), true);
    v_payload := jsonb_set(v_payload, '{raw_value}', to_jsonb(v_scan_code), true);
    v_payload := jsonb_set(v_payload, '{exactDigitCapture}', 'true'::jsonb, true);
    v_payload := jsonb_set(v_payload, '{expectedCodeLength}', '8'::jsonb, true);
  END IF;

  v_result := public.process_production_reading_impl_v2(v_payload);
  v_client_event_id := coalesce(
    nullif(btrim(v_payload ->> 'client_event_id'), ''),
    nullif(v_result ->> 'client_event_id', ''),
    nullif(v_result #>> '{reading,client_event_id}', '')
  );
  RETURN public.finalize_collection_realtime(v_client_event_id, v_result);
END;
$$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_collection_fast8_v8_5',
  'collection-fast8-immediate-client-capture-single-rpc-server-validation',
  'Coleta física/manual/câmera limitada a 8 dígitos, preserva zero inicial, rejeita parcial/excesso e mantém RFID/API compatíveis.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

CREATE OR REPLACE FUNCTION public.get_public_collection_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH manage_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.can_manage_replacement_actions()'))) AS definition
  ),
  approval_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)'))) AS definition
  ),
  force_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)'))) AS definition
  ),
  collection_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.process_production_reading_v2(jsonb)'))) AS definition
  ),
  lot_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.recalculate_replacement_lot_v2(uuid)'))) AS definition
  )
  SELECT jsonb_build_object(
    'ready',
      to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL
      AND to_regprocedure('public.normalize_collection_scan_code(text)') IS NOT NULL
      AND to_regprocedure('public.resolve_operator_shift_window(uuid,timestamptz)') IS NOT NULL
      AND to_regprocedure('public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)') IS NOT NULL
      AND to_regclass('public.production_cell_lot_states') IS NOT NULL
      AND to_regclass('public.production_cell_active_contexts') IS NOT NULL
      AND to_regprocedure('public.can_approve_replacements()') IS NOT NULL
      AND to_regprocedure('public.can_force_complete_replacements()') IS NOT NULL
      AND to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NOT NULL
      AND (SELECT position('normalize_collection_scan_code' in definition) > 0 FROM collection_definition)
      AND (SELECT position('invalid_code_length' in definition) > 0 FROM collection_definition)
      AND (SELECT position('expected_code_length' in definition) > 0 FROM collection_definition)
      AND NOT EXISTS (
        SELECT 1
        FROM public.production_tags tag
        WHERE tag.active IS TRUE
          AND tag.tag_value !~ '^[0-9]{8}$'
      )
      AND (SELECT position('current_profile_can_decide_replacement' in definition) > 0 FROM manage_definition)
      AND (SELECT position('has_permission' in definition) = 0 FROM manage_definition)
      AND (SELECT position('insert into public.production_entries' in definition) = 0 FROM approval_definition)
      AND (SELECT position('insert into public.production_stage_readings' in definition) = 0 FROM approval_definition)
      AND (SELECT position('insert into public.production_collection_events' in definition) = 0 FROM approval_definition)
      AND (SELECT position('status = ''released''' in definition) > 0 FROM approval_definition)
      AND (SELECT position('''replacement'', false, v_original.id' in definition) > 0 FROM approval_definition)
      AND (SELECT position('btrim(coalesce(p_reason' in definition) > 0 FROM force_definition)
      AND (SELECT position('v_reason = ''''' in definition) > 0 FROM force_definition)
      AND (SELECT position('password' in definition) = 0 FROM force_definition)
      AND (SELECT position('replacement_action_audit_logs' in definition) > 0 FROM force_definition)
      AND (SELECT position('''manual_adjustment''' in definition) > 0 FROM force_definition)
      AND (SELECT position('''conclusao_forcada_reposicao''' in definition) > 0 FROM force_definition)
      AND (SELECT position('on conflict (client_event_id)' in definition) = 0 FROM force_definition)
      AND (SELECT position('on conflict do nothing' in definition) > 0 FROM force_definition)
      AND EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.replacement_action_audit_logs'::regclass
          AND trigger_row.tgname = 'trg_mirror_replacement_action_audit_to_system_logs'
          AND trigger_row.tgenabled <> 'D'
      )
      AND (SELECT position('then ''closed''' in definition) > 0 FROM lot_definition),
    'migration_version', coalesce((
      SELECT migration.version
      FROM supabase_migrations.schema_migrations migration
      WHERE migration.name = 'collection_exact_8_digit_fast_capture_v8_5'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_collection_fast8_v8_5',
    'schema_flags', jsonb_build_object(
      'shift_columns',
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'operators'
            AND column_name = 'shift_start_time'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'operators'
            AND column_name = 'shift_end_time'
        ),
      'cell_lifecycle', to_regclass('public.production_cell_lot_states') IS NOT NULL,
      'active_context', to_regclass('public.production_cell_active_contexts') IS NOT NULL,
      'reading_v2', to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL,
      'history_compatibility',
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'production_stage_readings'
            AND column_name = 'raw_value'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'production_stage_readings'
            AND column_name = 'traceability_code'
        ),
      'collection_exact_8_digit_scan',
        to_regprocedure('public.normalize_collection_scan_code(text)') IS NOT NULL
        AND (SELECT position('normalize_collection_scan_code' in definition) > 0 FROM collection_definition)
        AND (SELECT position('invalid_code_length' in definition) > 0 FROM collection_definition)
        AND (SELECT position('expected_code_length' in definition) > 0 FROM collection_definition),
      'collection_active_tags_8_digits', NOT EXISTS (
        SELECT 1
        FROM public.production_tags tag
        WHERE tag.active IS TRUE
          AND tag.tag_value !~ '^[0-9]{8}$'
      ),
      'replacement_quality_role', EXISTS (
        SELECT 1
        FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'public.profiles'::regclass
          AND constraint_row.conname = 'profiles_role_check'
          AND lower(pg_get_constraintdef(constraint_row.oid)) LIKE '%quality_manager%'
      ),
      'replacement_decision_rbac',
        to_regprocedure('public.can_approve_replacements()') IS NOT NULL
        AND to_regprocedure('public.can_force_complete_replacements()') IS NOT NULL,
      'replacement_strict_role_hierarchy',
        (SELECT position('current_profile_can_decide_replacement' in definition) > 0 FROM manage_definition)
        AND (SELECT position('has_permission' in definition) = 0 FROM manage_definition),
      'replacement_station_only_approval',
        (SELECT position('insert into public.production_entries' in definition) = 0 FROM approval_definition)
        AND (SELECT position('insert into public.production_stage_readings' in definition) = 0 FROM approval_definition)
        AND (SELECT position('insert into public.production_collection_events' in definition) = 0 FROM approval_definition)
        AND (SELECT position('status = ''released''' in definition) > 0 FROM approval_definition),
      'replacement_origin_classification',
        (SELECT position('''replacement'', false, v_original.id' in definition) > 0 FROM approval_definition),
      'replacement_force_justification_only',
        (SELECT position('btrim(coalesce(p_reason' in definition) > 0 FROM force_definition)
        AND (SELECT position('v_reason = ''''' in definition) > 0 FROM force_definition)
        AND (SELECT position('password' in definition) = 0 FROM force_definition),
      'replacement_force_adjustment_facts',
        (SELECT position('''manual_adjustment''' in definition) > 0 FROM force_definition)
        AND (SELECT position('''conclusao_forcada_reposicao''' in definition) > 0 FROM force_definition),
      'replacement_force_conflict_safe',
        (SELECT position('on conflict (client_event_id)' in definition) = 0 FROM force_definition)
        AND (SELECT position('on conflict do nothing' in definition) > 0 FROM force_definition),
      'replacement_audit_mirror', EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.replacement_action_audit_logs'::regclass
          AND trigger_row.tgname = 'trg_mirror_replacement_action_audit_to_system_logs'
          AND trigger_row.tgenabled <> 'D'
      ),
      'replacement_station_queue', to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NOT NULL,
      'replacement_canonical_lot_close',
        (SELECT position('then ''closed''' in definition) > 0 FROM lot_definition)
        AND (SELECT position('actual_end' in definition) > 0 FROM lot_definition)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_release()
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_replacement_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.get_public_collection_release();
$$;

REVOKE ALL ON FUNCTION public.get_public_replacement_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_replacement_release()
  TO anon, authenticated;

-- AC.Prod2 — replacement force completion conflict fix v8.4.
-- The unique client_event index is partial, so a column-target ON CONFLICT
-- cannot infer it. Use generic conflict handling and fail closed in the probe.

DO $patch_force$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')
  )
  INTO v_definition;

  IF position('ON CONFLICT (client_event_id) DO NOTHING' in v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'ON CONFLICT (client_event_id) DO NOTHING',
      'ON CONFLICT DO NOTHING'
    );
    EXECUTE v_definition;
  END IF;

  SELECT lower(pg_get_functiondef(
    to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')
  ))
  INTO v_definition;

  IF position('on conflict (client_event_id)' in v_definition) > 0
     OR position('on conflict do nothing' in v_definition) = 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_4_INCOMPLETE: force completion conflict handling invalid';
  END IF;
END
$patch_force$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_replacement_v8_4',
  'replacement-v8-4-partial-index-conflict-safe-force-completion',
  'Corrige ON CONFLICT da conclusão forçada para o índice parcial de client_event_id e adiciona validação fail-closed.'
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
  lot_definition AS (
    SELECT lower(pg_get_functiondef(to_regprocedure('public.recalculate_replacement_lot_v2(uuid)'))) AS definition
  )
  SELECT jsonb_build_object(
    'ready',
      to_regprocedure('public.process_production_reading_v2(jsonb)') IS NOT NULL
      AND to_regprocedure('public.resolve_operator_shift_window(uuid,timestamptz)') IS NOT NULL
      AND to_regprocedure('public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)') IS NOT NULL
      AND to_regclass('public.production_cell_lot_states') IS NOT NULL
      AND to_regclass('public.production_cell_active_contexts') IS NOT NULL
      AND to_regprocedure('public.can_approve_replacements()') IS NOT NULL
      AND to_regprocedure('public.can_force_complete_replacements()') IS NOT NULL
      AND to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NOT NULL
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
      WHERE migration.name = 'fix_force_completion_conflict_v8_4'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_replacement_v8_4',
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

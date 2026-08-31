-- AC.Prod2 — final replacement workflow contract v8.2.
-- Non-destructive. Approval authorizes production and places the substitute in
-- the first real cell queue. Force completion requires justification only.

UPDATE public.profiles
SET permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
      'view_replacements', true,
      'manage_replacements', true,
      'approve_replacements', true,
      'force_complete_replacements', true
    ),
    permission_version = permission_version + 1,
    updated_at = clock_timestamp()
WHERE active IS TRUE
  AND lower(coalesce(role, '')) IN (
    'quality', 'quality_manager', 'leader', 'supervisor', 'manager', 'admin'
  )
  AND (
    coalesce((permissions ->> 'view_replacements')::boolean, false) IS NOT TRUE
    OR coalesce((permissions ->> 'manage_replacements')::boolean, false) IS NOT TRUE
    OR coalesce((permissions ->> 'approve_replacements')::boolean, false) IS NOT TRUE
    OR coalesce((permissions ->> 'force_complete_replacements')::boolean, false) IS NOT TRUE
  );

UPDATE public.profiles
SET permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
      'force_complete_replacements', false
    ),
    permission_version = permission_version + 1,
    updated_at = clock_timestamp()
WHERE active IS TRUE
  AND lower(coalesce(role, '')) IN ('operator', 'user', 'viewer')
  AND coalesce((permissions ->> 'force_complete_replacements')::boolean, false) IS TRUE;

DO $contract$
DECLARE
  v_approval_definition text;
  v_force_definition text;
  v_role_constraint text;
  v_origin_constraint text;
BEGIN
  IF to_regprocedure('public.approve_piece_replacement(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: approve_piece_replacement missing';
  END IF;
  IF to_regprocedure('public.force_complete_piece_replacement(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: force completion RPC missing';
  END IF;
  IF to_regprocedure('public.can_approve_replacements()') IS NULL
     OR to_regprocedure('public.can_force_complete_replacements()') IS NULL THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: replacement RBAC helpers missing';
  END IF;
  IF to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NULL
     OR to_regprocedure('public.collect_replacement_stage_v3(text,text,uuid,text,timestamptz,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: station queue/collection RPC missing';
  END IF;

  SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)')))
  INTO v_approval_definition;
  SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')))
  INTO v_force_definition;
  SELECT lower(pg_get_constraintdef(constraint_row.oid))
  INTO v_role_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.conname = 'profiles_role_check';
  SELECT lower(pg_get_constraintdef(constraint_row.oid))
  INTO v_origin_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.production_pieces'::regclass
    AND constraint_row.conname = 'production_pieces_source_origin_check';

  IF coalesce(v_role_constraint, '') NOT LIKE '%quality_manager%' THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: quality_manager role missing';
  END IF;
  IF coalesce(v_origin_constraint, '') NOT LIKE '%replacement%' THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: replacement source_origin missing';
  END IF;
  IF position('insert into public.production_entries' in v_approval_definition) > 0
     OR position('insert into public.production_stage_readings' in v_approval_definition) > 0
     OR position('insert into public.production_collection_events' in v_approval_definition) > 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: approval still fabricates production facts';
  END IF;
  IF position('status = ''released''' in v_approval_definition) = 0
     OR position('approval_entry_count = 0' in v_approval_definition) = 0
     OR position('approved_cells = ''[]''::jsonb' in v_approval_definition) = 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: approval is not station-queue only';
  END IF;
  IF position('p_reason text' in v_force_definition) = 0
     OR position('justification_required' in v_force_definition) = 0
     OR position('password' in v_force_definition) > 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: force completion contract invalid';
  END IF;
  IF has_function_privilege('anon', 'public.approve_piece_replacement(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.force_complete_piece_replacement(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_2_INCOMPLETE: anon can execute replacement decisions';
  END IF;
END
$contract$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_replacement_v8_2',
  'replacement-v8-2-quality-rbac-direct-approval-force-justification-station-ux',
  'Qualidade/Supervisor-Líder/Gestor/Admin; aprovação direta sem baixa automática; conclusão forçada sem senha e com justificativa; fila produtiva por célula.'
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
  WITH approval_definition AS (
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
      AND (SELECT position('insert into public.production_entries' in definition) = 0 FROM approval_definition)
      AND (SELECT position('insert into public.production_stage_readings' in definition) = 0 FROM approval_definition)
      AND (SELECT position('insert into public.production_collection_events' in definition) = 0 FROM approval_definition)
      AND (SELECT position('status = ''released''' in definition) > 0 FROM approval_definition)
      AND (SELECT position('password' in definition) = 0 FROM force_definition)
      AND (SELECT position('justification_required' in definition) > 0 FROM force_definition)
      AND (SELECT position('then ''closed''' in definition) > 0 FROM lot_definition),
    'migration_version', coalesce((
      SELECT migration.version
      FROM supabase_migrations.schema_migrations migration
      WHERE migration.name = 'finalize_replacement_workflow_v8_2'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_replacement_v8_2',
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
      'replacement_station_only_approval',
        (SELECT position('insert into public.production_entries' in definition) = 0 FROM approval_definition)
        AND (SELECT position('insert into public.production_stage_readings' in definition) = 0 FROM approval_definition)
        AND (SELECT position('insert into public.production_collection_events' in definition) = 0 FROM approval_definition)
        AND (SELECT position('status = ''released''' in definition) > 0 FROM approval_definition),
      'replacement_force_justification_only',
        (SELECT position('p_reason text' in definition) > 0 FROM force_definition)
        AND (SELECT position('justification_required' in definition) > 0 FROM force_definition)
        AND (SELECT position('password' in definition) = 0 FROM force_definition),
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

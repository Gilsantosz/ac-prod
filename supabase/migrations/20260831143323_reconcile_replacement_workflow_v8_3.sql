-- AC.Prod2 — reconcile replacement workflow v8.3 after concurrent v1 migration.
-- Keeps the new dedicated audit ledger, restores strict hierarchy, correct
-- replacement classification and compatibility with the existing History UI.

CREATE OR REPLACE FUNCTION public.can_manage_replacement_actions()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.current_profile_can_decide_replacement();
$$;

REVOKE ALL ON FUNCTION public.can_manage_replacement_actions()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_replacement_actions()
  TO authenticated, service_role;

DO $patch_functions$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)'))
  INTO v_definition;

  IF position(
       'v_first_step, ''in_progress'', ''rework'', true, v_original.id,'
       in v_definition
     ) > 0 THEN
    v_definition := replace(
      v_definition,
      'v_first_step, ''in_progress'', ''rework'', true, v_original.id,',
      'v_first_step, ''in_progress'', ''replacement'', false, v_original.id,'
    );
    EXECUTE v_definition;
  END IF;

  SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)')))
  INTO v_definition;
  IF position('''replacement'', false, v_original.id' in v_definition) = 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_3_INCOMPLETE: approval replacement classification not restored';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)'))
  INTO v_definition;

  IF position('1, ''approved'', ''replacement_approval'',' in v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      '1, ''approved'', ''replacement_approval'',',
      '1, ''approved'', ''manual_adjustment'','
    );
  END IF;

  IF position('1, ''baixa_reposicao'', ''unitaria'', true, ''pecas'',' in v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      '1, ''baixa_reposicao'', ''unitaria'', true, ''pecas'',',
      '1, ''conclusao_forcada_reposicao'', ''unitaria'', true, ''pecas'','
    );
  END IF;

  EXECUTE v_definition;

  SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')))
  INTO v_definition;
  IF position('''manual_adjustment''' in v_definition) = 0
     OR position('''conclusao_forcada_reposicao''' in v_definition) = 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_3_INCOMPLETE: forced facts are not classified as adjustments';
  END IF;
END
$patch_functions$;

CREATE OR REPLACE FUNCTION public.mirror_replacement_action_audit_to_system_logs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action text;
BEGIN
  v_action := CASE NEW.action
    WHEN 'approved_for_production' THEN 'replacement_approved_for_station'
    WHEN 'force_completed' THEN 'replacement_force_completed'
    WHEN 'cancelled' THEN 'replacement_cancelled'
    WHEN 'released' THEN 'replacement_released'
    ELSE 'replacement_action_recorded'
  END;

  INSERT INTO public.system_audit_logs (
    user_id,
    user_name,
    user_role,
    action,
    entity,
    entity_id,
    entity_label,
    page,
    route,
    method,
    old_value,
    new_value,
    metadata,
    success,
    created_at
  ) VALUES (
    NEW.performed_by,
    NEW.performed_by_name,
    NEW.performed_by_role,
    v_action,
    'replacement_orders',
    NEW.replacement_order_id::text,
    coalesce(NEW.replacement_code, NEW.replacement_order_id::text),
    'Reposição',
    '/reposicao',
    'DATABASE_TRIGGER',
    jsonb_build_object(
      'status', NEW.status_before,
      'current_stage', NEW.current_stage_before
    ),
    jsonb_build_object(
      'status', NEW.status_after,
      'current_stage', NEW.current_stage_after,
      'reason', NEW.reason
    ),
    coalesce(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'replacement_action_audit_log_id', NEW.id,
      'replacement_order_id', NEW.replacement_order_id,
      'replacement_code', NEW.replacement_code,
      'original_piece_id', NEW.original_piece_id,
      'replacement_piece_id', NEW.replacement_piece_id,
      'reason', NEW.reason,
      'dedicated_action', NEW.action
    ),
    true,
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mirror_replacement_action_audit_to_system_logs()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mirror_replacement_action_audit_to_system_logs
  ON public.replacement_action_audit_logs;
CREATE TRIGGER trg_mirror_replacement_action_audit_to_system_logs
AFTER INSERT ON public.replacement_action_audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.mirror_replacement_action_audit_to_system_logs();

INSERT INTO public.system_audit_logs (
  user_id,
  user_name,
  user_role,
  action,
  entity,
  entity_id,
  entity_label,
  page,
  route,
  method,
  old_value,
  new_value,
  metadata,
  success,
  created_at
)
SELECT
  dedicated.performed_by,
  dedicated.performed_by_name,
  dedicated.performed_by_role,
  CASE dedicated.action
    WHEN 'approved_for_production' THEN 'replacement_approved_for_station'
    WHEN 'force_completed' THEN 'replacement_force_completed'
    WHEN 'cancelled' THEN 'replacement_cancelled'
    WHEN 'released' THEN 'replacement_released'
    ELSE 'replacement_action_recorded'
  END,
  'replacement_orders',
  dedicated.replacement_order_id::text,
  coalesce(dedicated.replacement_code, dedicated.replacement_order_id::text),
  'Reposição',
  '/reposicao',
  'DATABASE_BACKFILL',
  jsonb_build_object(
    'status', dedicated.status_before,
    'current_stage', dedicated.current_stage_before
  ),
  jsonb_build_object(
    'status', dedicated.status_after,
    'current_stage', dedicated.current_stage_after,
    'reason', dedicated.reason
  ),
  coalesce(dedicated.metadata, '{}'::jsonb) || jsonb_build_object(
    'replacement_action_audit_log_id', dedicated.id,
    'replacement_order_id', dedicated.replacement_order_id,
    'replacement_code', dedicated.replacement_code,
    'original_piece_id', dedicated.original_piece_id,
    'replacement_piece_id', dedicated.replacement_piece_id,
    'reason', dedicated.reason,
    'dedicated_action', dedicated.action
  ),
  true,
  dedicated.created_at
FROM public.replacement_action_audit_logs dedicated
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_audit_logs system_log
  WHERE system_log.metadata ->> 'replacement_action_audit_log_id' = dedicated.id::text
);

DO $contract$
DECLARE
  v_manage_definition text;
  v_approval_definition text;
  v_force_definition text;
BEGIN
  SELECT lower(pg_get_functiondef(to_regprocedure('public.can_manage_replacement_actions()')))
  INTO v_manage_definition;
  SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)')))
  INTO v_approval_definition;
  SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')))
  INTO v_force_definition;

  IF position('current_profile_can_decide_replacement' in v_manage_definition) = 0
     OR position('has_permission' in v_manage_definition) > 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_3_INCOMPLETE: hierarchy is not strict';
  END IF;

  IF position('insert into public.production_entries' in v_approval_definition) > 0
     OR position('insert into public.production_stage_readings' in v_approval_definition) > 0
     OR position('insert into public.production_collection_events' in v_approval_definition) > 0
     OR position('status = ''released''' in v_approval_definition) = 0
     OR position('approval_entry_count = 0' in v_approval_definition) = 0
     OR position('approved_cells = ''[]''::jsonb' in v_approval_definition) = 0
     OR position('''replacement'', false, v_original.id' in v_approval_definition) = 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_3_INCOMPLETE: approval contract invalid';
  END IF;

  IF position('btrim(coalesce(p_reason' in v_force_definition) = 0
     OR position('v_reason = ''''' in v_force_definition) = 0
     OR position('password' in v_force_definition) > 0
     OR position('replacement_action_audit_logs' in v_force_definition) = 0
     OR position('''manual_adjustment''' in v_force_definition) = 0
     OR position('''conclusao_forcada_reposicao''' in v_force_definition) = 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_3_INCOMPLETE: forced completion contract invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.replacement_action_audit_logs'::regclass
      AND trigger_row.tgname = 'trg_mirror_replacement_action_audit_to_system_logs'
      AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'REPLACEMENT_V8_3_INCOMPLETE: audit mirror trigger missing';
  END IF;
END
$contract$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_replacement_v8_3',
  'replacement-v8-3-strict-hierarchy-replacement-origin-adjustment-facts-dual-audit',
  'Reconcilia migração concorrente: hierarquia estrita, origem replacement, fatos forçados classificados como ajuste e auditoria dedicada espelhada no Histórico.'
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
      WHERE migration.name = 'reconcile_replacement_workflow_v8_3'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_replacement_v8_3',
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

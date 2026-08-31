-- AC.Prod2 — structural acceptance test for replacement workflow v8.4.
-- Read-only: no production row is changed.
BEGIN;
SET LOCAL statement_timeout = '60s';

DO $test$
DECLARE
  v_release jsonb;
  v_manage_definition text;
  v_approval_definition text;
  v_force_definition text;
BEGIN
  v_release := public.get_public_collection_release();
  IF coalesce((v_release ->> 'ready')::boolean, false) IS NOT TRUE
     OR v_release ->> 'migration_version' <> '20260831143850'
     OR v_release ->> 'release_version' <> '20260831_acprod_replacement_v8_4' THEN
    RAISE EXCEPTION 'TEST_FAIL: invalid release probe: %', v_release;
  END IF;

  IF to_regprocedure('public.approve_piece_replacement(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.force_complete_piece_replacement(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.can_approve_replacements()') IS NULL
     OR to_regprocedure('public.can_force_complete_replacements()') IS NULL
     OR to_regprocedure('public.can_manage_replacement_actions()') IS NULL
     OR to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NULL
     OR to_regprocedure('public.collect_replacement_stage_v3(text,text,uuid,text,timestamptz,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: replacement runtime contract incomplete';
  END IF;

  IF has_function_privilege('anon', 'public.approve_piece_replacement(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.force_complete_piece_replacement(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: anon can execute replacement decisions';
  END IF;

  SELECT lower(pg_get_functiondef(to_regprocedure('public.can_manage_replacement_actions()')))
  INTO v_manage_definition;
  SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)')))
  INTO v_approval_definition;
  SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')))
  INTO v_force_definition;

  IF position('current_profile_can_decide_replacement' in v_manage_definition) = 0
     OR position('has_permission' in v_manage_definition) > 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: replacement hierarchy is not strict';
  END IF;

  IF position('insert into public.production_entries' in v_approval_definition) > 0
     OR position('insert into public.production_stage_readings' in v_approval_definition) > 0
     OR position('insert into public.production_collection_events' in v_approval_definition) > 0
     OR position('status = ''released''' in v_approval_definition) = 0
     OR position('approval_entry_count = 0' in v_approval_definition) = 0
     OR position('approved_cells = ''[]''::jsonb' in v_approval_definition) = 0
     OR position('''replacement'', false, v_original.id' in v_approval_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: approval is not station-only replacement flow';
  END IF;

  IF position('btrim(coalesce(p_reason' in v_force_definition) = 0
     OR position('v_reason = ''''' in v_force_definition) = 0
     OR position('password' in v_force_definition) > 0
     OR position('replacement_action_audit_logs' in v_force_definition) = 0
     OR position('''manual_adjustment''' in v_force_definition) = 0
     OR position('''conclusao_forcada_reposicao''' in v_force_definition) = 0
     OR position('on conflict (client_event_id)' in v_force_definition) > 0
     OR position('on conflict do nothing' in v_force_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: forced completion contract invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.replacement_action_audit_logs'::regclass
      AND trigger_row.tgname = 'trg_mirror_replacement_action_audit_to_system_logs'
      AND trigger_row.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: dedicated audit is not mirrored to History';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.app_schema_releases release
    WHERE release.version = '20260831_acprod_replacement_v8_4'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: app schema release marker absent';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'REPLACEMENT_WORKFLOW_V8_4_CONTRACT_OK' AS result;

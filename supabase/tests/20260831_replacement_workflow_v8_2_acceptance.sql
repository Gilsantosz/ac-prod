-- AC.Prod2 — structural acceptance test for replacement workflow v8.2.
-- Read-only: no production row is changed.
BEGIN;
SET LOCAL statement_timeout = '60s';

DO $test$
DECLARE
  v_release jsonb;
  v_approval_definition text;
  v_force_definition text;
  v_role_constraint text;
  v_origin_constraint text;
BEGIN
  v_release := public.get_public_collection_release();
  IF coalesce((v_release ->> 'ready')::boolean, false) IS NOT TRUE
     OR v_release ->> 'migration_version' <> '20260831135630'
     OR v_release ->> 'release_version' <> '20260831_acprod_replacement_v8_2' THEN
    RAISE EXCEPTION 'TEST_FAIL: invalid release probe: %', v_release;
  END IF;

  IF to_regprocedure('public.approve_piece_replacement(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.force_complete_piece_replacement(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.can_approve_replacements()') IS NULL
     OR to_regprocedure('public.can_force_complete_replacements()') IS NULL
     OR to_regprocedure('public.get_replacement_station_queue_v3(text,text)') IS NULL
     OR to_regprocedure('public.collect_replacement_stage_v3(text,text,uuid,text,timestamptz,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: replacement runtime contract incomplete';
  END IF;

  IF has_function_privilege('anon', 'public.approve_piece_replacement(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.force_complete_piece_replacement(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: anon can execute replacement decisions';
  END IF;

  SELECT lower(pg_get_functiondef(to_regprocedure('public.approve_piece_replacement(uuid,jsonb)')))
  INTO v_approval_definition;
  SELECT lower(pg_get_functiondef(to_regprocedure('public.force_complete_piece_replacement_impl(uuid,text,jsonb)')))
  INTO v_force_definition;

  IF position('insert into public.production_entries' in v_approval_definition) > 0
     OR position('insert into public.production_stage_readings' in v_approval_definition) > 0
     OR position('insert into public.production_collection_events' in v_approval_definition) > 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: approval fabricates production facts';
  END IF;
  IF position('status = ''released''' in v_approval_definition) = 0
     OR position('approval_entry_count = 0' in v_approval_definition) = 0
     OR position('approved_cells = ''[]''::jsonb' in v_approval_definition) = 0
     OR position('realtime.send' in v_approval_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: approval is not station-queue only';
  END IF;

  IF position('p_reason text' in v_force_definition) = 0
     OR position('justification_required' in v_force_definition) = 0
     OR position('replacement_force_completed' in v_force_definition) = 0
     OR position('password' in v_force_definition) > 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: force completion is not justification-only and audited';
  END IF;

  SELECT lower(pg_get_constraintdef(constraint_row.oid))
  INTO v_role_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.profiles'::regclass
    AND constraint_row.conname = 'profiles_role_check';
  IF coalesce(v_role_constraint, '') NOT LIKE '%quality_manager%'
     OR coalesce(v_role_constraint, '') NOT LIKE '%supervisor%'
     OR coalesce(v_role_constraint, '') NOT LIKE '%manager%'
     OR coalesce(v_role_constraint, '') NOT LIKE '%admin%' THEN
    RAISE EXCEPTION 'TEST_FAIL: required role hierarchy absent: %', v_role_constraint;
  END IF;

  SELECT lower(pg_get_constraintdef(constraint_row.oid))
  INTO v_origin_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.production_pieces'::regclass
    AND constraint_row.conname = 'production_pieces_source_origin_check';
  IF coalesce(v_origin_constraint, '') NOT LIKE '%replacement%' THEN
    RAISE EXCEPTION 'TEST_FAIL: replacement source origin absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.app_schema_releases release
    WHERE release.version = '20260831_acprod_replacement_v8_2'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: app schema release marker absent';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'REPLACEMENT_WORKFLOW_V8_2_CONTRACT_OK' AS result;

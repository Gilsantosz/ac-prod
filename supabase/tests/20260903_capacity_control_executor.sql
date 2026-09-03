BEGIN;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM (VALUES
    ('control_revision'),
    ('executor_heartbeat_at'),
    ('executor_id'),
    ('stop_reason')
  ) required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'capacity_test_runs'
      AND column_info.column_name = required.column_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'capacity control columns missing: %', v_missing;
  END IF;

  IF to_regprocedure('public.inspect_capacity_test_run_v3(text)') IS NULL
     OR to_regprocedure('public.claim_capacity_test_run_v3(text,text)') IS NULL
     OR to_regprocedure('public.observe_capacity_test_run_v3(text,text,boolean)') IS NULL
     OR to_regprocedure('public.finish_capacity_test_run_v3(text,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.fail_stale_capacity_test_run_v3(text,text)') IS NULL
     OR to_regprocedure('public.seed_capacity_fixture_v4(text,text,text)') IS NULL
     OR to_regprocedure('public.get_capacity_fixture_contexts_v4(text)') IS NULL THEN
    RAISE EXCEPTION 'capacity executor RPC contract missing';
  END IF;

  IF has_function_privilege('anon', 'public.observe_capacity_test_run_v3(text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.observe_capacity_test_run_v3(text,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.observe_capacity_test_run_v3(text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capacity executor grants are unsafe';
  END IF;

  IF has_function_privilege('anon', 'public.seed_capacity_fixture_v4(text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.seed_capacity_fixture_v4(text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.seed_capacity_fixture_v4(text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_capacity_fixture_contexts_v4(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_capacity_fixture_contexts_v4(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_capacity_fixture_contexts_v4(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capacity fixture grants are unsafe';
  END IF;

  IF has_function_privilege('service_role', 'public.request_capacity_test_run(text,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.control_capacity_test_run(text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fail_stale_capacity_test_run_v3(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.request_capacity_test_run(text,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.control_capacity_test_run(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fail_stale_capacity_test_run_v3(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'capacity operator grants are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'capacity_test_runs'
      AND indexname = 'capacity_test_runs_single_active_idx'
      AND indexdef ILIKE '%UNIQUE%'
  ) THEN
    RAISE EXCEPTION 'single active capacity run index missing';
  END IF;
END;
$$;

ROLLBACK;

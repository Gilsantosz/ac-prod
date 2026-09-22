-- Integration regression for the actual quantitative-entry RPC, not a mocked client.
-- Run as a database owner in a controlled environment with a pending Corte batch,
-- an active admin profile and an active operator profile authorized for manual Corte entries.
-- Select the fixture explicitly in the same connection before running this file:
-- SELECT set_config('acprod.volume_regression_batch_id', '<fixture-batch-uuid>', false);
-- Goal fixtures, entries and helper functions are always rolled back. No persistent test writes.
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION pg_temp.volume_goal_cut_regression(p_batch_id uuid, p_case text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_uid uuid;
  v_admin uuid;
  v_code text;
  v_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_expected numeric := 0;
  v_result jsonb;
  v_checks jsonb := '{}';
  v_error text;
  v_sqlstate text;
  v_before_goals text;
  v_event text := 'volume-goal-regression-' || gen_random_uuid()::text;
BEGIN
  SELECT id INTO v_uid FROM public.profiles
  WHERE role = 'operator' AND active IS TRUE
    AND coalesce((permissions->>'register_manual_production')::boolean, false)
    AND 'Corte' = ANY(managed_cells) LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' AND active IS TRUE LIMIT 1;
  SELECT general_lot_code INTO v_code FROM public.promob_import_batches WHERE id = p_batch_id;
  IF v_uid IS NULL OR v_admin IS NULL OR v_code IS NULL THEN
    RAISE EXCEPTION 'TEST_CONTEXT_MISSING';
  END IF;
  SELECT md5(jsonb_agg(to_jsonb(g) ORDER BY id)::text)
  INTO v_before_goals FROM public.production_daily_goals g;

  BEGIN
    PERFORM set_config('lock_timeout', '2s', true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    DELETE FROM public.production_daily_goals
    WHERE cell_name = 'Corte' AND shift = '1º Turno' AND metric_unit = 'pieces';
    IF p_case NOT IN ('missing', 'configured', 'zero', 'future', 'other_shift') THEN
      RAISE EXCEPTION 'UNKNOWN_TEST_CASE';
    END IF;
    IF p_case <> 'missing' THEN
      v_expected := CASE WHEN p_case = 'configured' THEN 321.5 ELSE 0 END;
      INSERT INTO public.production_daily_goals(
        date, shift, cell_name, metric_unit, metric_unit_label, metric_name, target, capacity
      ) VALUES (
        CASE WHEN p_case = 'future' THEN v_date + 1 ELSE v_date END,
        CASE WHEN p_case = 'other_shift' THEN '2º Turno' ELSE '1º Turno' END,
        'Corte', 'pieces', 'peças', 'Teste transacional',
        CASE WHEN p_case = 'zero' THEN 0 ELSE 321.5 END, 999
      ) ON CONFLICT(date, shift, cell_name, metric_unit)
        DO UPDATE SET target = excluded.target, capacity = excluded.capacity;
    END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    EXECUTE 'set local role authenticated';
    v_result := public.register_untraceable_stage_quantity(jsonb_build_object(
      'pcp_import_batch_id', p_batch_id, 'general_lot_code', v_code,
      'cell_name', 'Corte', 'shift', '1º Turno', 'operator', 'ROLLBACK_VOLUME_GOAL_REGRESSION',
      'quantity', 1, 'date', v_date, 'client_event_id', v_event
    ));
    EXECUTE 'reset role';
    SELECT jsonb_build_object(
      'success', v_result->>'success' = 'true',
      'target_correct', target = round(v_expected)::integer,
      'planned_target_correct', planned_target = v_expected,
      'quantity_correct', produced = 1 AND pieces_quantity = 1
    ) INTO v_checks FROM public.production_entries
    WHERE id = (v_result->>'production_entry_id')::uuid;
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'ROLLBACK_TEST_SUCCESS';
  EXCEPTION
    WHEN SQLSTATE 'PZ001' THEN NULL;
    WHEN OTHERS THEN v_error := SQLERRM; v_sqlstate := SQLSTATE;
  END;

  v_checks := v_checks || jsonb_build_object(
    'goals_restored', (SELECT md5(jsonb_agg(to_jsonb(g) ORDER BY id)::text) = v_before_goals FROM public.production_daily_goals g),
    'test_record_removed', NOT EXISTS (SELECT 1 FROM public.manual_production_records WHERE client_event_id = v_event),
    'test_entry_removed', NOT EXISTS (SELECT 1 FROM public.production_entries WHERE client_event_id = v_event)
  );
  RETURN jsonb_build_object(
    'case', p_case, 'rolled_back', true, 'checks', v_checks, 'error', v_error, 'sqlstate', v_sqlstate,
    'passed', v_error IS NULL AND coalesce((v_checks->>'success')::boolean, false)
      AND NOT EXISTS (SELECT 1 FROM jsonb_each(v_checks) c WHERE c.value IS DISTINCT FROM 'true'::jsonb)
  );
END;
$$;

DO $verify$
DECLARE
  v_batch uuid := nullif(current_setting('acprod.volume_regression_batch_id', true), '')::uuid;
  v_case text;
  v_result jsonb;
  v_results jsonb := '[]';
BEGIN
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Set acprod.volume_regression_batch_id to an explicit pending Corte fixture batch';
  END IF;
  FOREACH v_case IN ARRAY ARRAY['missing', 'configured', 'zero', 'future', 'other_shift'] LOOP
    v_result := pg_temp.volume_goal_cut_regression(v_batch, v_case);
    IF v_result->>'passed' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'VOLUME_GOAL_REGRESSION_FAILED: %', v_result;
    END IF;
    v_results := v_results || jsonb_build_array(v_result);
  END LOOP;
  PERFORM set_config('acprod.volume_regression_result', v_results::text, true);
END;
$verify$;
SELECT current_setting('acprod.volume_regression_result')::jsonb AS regression_results;
ROLLBACK;

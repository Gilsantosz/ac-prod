-- Privileged integration regression against the actual RPCs.
-- Supply an active batch with at least one remaining piece in the selected stage.
-- psql -v ON_ERROR_STOP=1 -v batch_id=<uuid> -v cell_id=<uuid> -f this-file.sql
-- All fixtures/writes, including audit events and notifications, are rolled back.
-- Existing operator sessions, cell/machine names and profile permissions are not edited.
CREATE OR REPLACE FUNCTION pg_temp.volume_context_case(p_batch_id uuid, p_cell_id uuid, p_case text)
RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE
  v_auth uuid;
  v_cell public.cells%ROWTYPE;
  v_batch public.promob_import_batches%ROWTYPE;
  v_operator uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_other_machine uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_device text := gen_random_uuid()::text;
  v_token text := gen_random_uuid()::text;
  v_event text := 'rollback-volume-context-' || gen_random_uuid()::text;
  v_machine_cell text;
  v_context jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_checks jsonb := '{}'::jsonb;
  v_error text;
  v_code text;
  v_expected_success boolean := p_case IN ('exact', 'trimmed', 'padded', 'case');
  v_passed boolean;
BEGIN
  SELECT * INTO STRICT v_cell FROM public.cells WHERE id = p_cell_id AND active;
  SELECT * INTO STRICT v_batch FROM public.promob_import_batches WHERE id = p_batch_id;
  SELECT id INTO STRICT v_auth FROM public.profiles WHERE role = 'admin' AND active LIMIT 1;
  IF NOT (p_case = ANY(ARRAY['exact','trimmed','padded','case','foreign_cell',
    'inactive_machine','normal_disabled','revoked','expired','ended','wrong_device',
    'no_cell_assignment','no_machine','wrong_machine_assignment'])) THEN
    RAISE EXCEPTION 'Unknown test case';
  END IF;
  v_machine_cell := CASE p_case
    WHEN 'exact' THEN v_cell.name
    WHEN 'padded' THEN '  ' || btrim(v_cell.name) || '  '
    WHEN 'case' THEN upper(btrim(v_cell.name))
    ELSE btrim(v_cell.name) END;
  BEGIN
    INSERT INTO public.operators(id, name, active, login_enabled, shift)
    VALUES(v_operator, 'ROLLBACK_VOLUME_CONTEXT', true, true, '3º Turno');
    INSERT INTO public.production_machines(id, name, cell_name, active, allows_normal_production, allows_replacement)
    VALUES(v_machine, 'ROLLBACK_VOLUME_CONTEXT', v_machine_cell, true, true, true);
    INSERT INTO public.operator_cell_assignments(operator_id, cell_id, active)
    VALUES(v_operator, v_cell.id, true);
    INSERT INTO public.operator_sessions(id, operator_id, auth_user_id, device_id, token_hash,
      shift_snapshot, expires_at, sync_grace_until)
    VALUES(v_session, v_operator, v_auth, v_device,
      encode(extensions.digest(v_token, 'sha256'), 'hex'), '3º Turno',
      now() + interval '10 minutes', now() + interval '15 minutes');
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
    EXECUTE 'set local role authenticated';
    v_context := public.set_operator_session_context(v_token, v_cell.id, v_machine, 'Teste de volume');
    EXECUTE 'reset role';
    IF NOT coalesce((v_context->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'Context setup failed: %', v_context;
    END IF;
    v_payload := jsonb_build_object('pcp_import_batch_id', v_batch.id,
      'general_lot_code', v_batch.general_lot_code, 'cell_name', v_cell.name,
      'operator', 'UNTRUSTED_TEST_NAME', 'shift', '1º Turno', 'quantity', 1,
      'operatorSessionToken', v_token, 'deviceId', v_device, 'client_event_id', v_event);
    -- Tamper only with synthetic fixtures AFTER context confirmation.
    CASE p_case
      WHEN 'foreign_cell' THEN
        UPDATE public.production_machines SET cell_name = 'Outra célula não autorizada' WHERE id = v_machine;
      WHEN 'inactive_machine' THEN
        UPDATE public.production_machines SET active = false WHERE id = v_machine;
      WHEN 'normal_disabled' THEN
        UPDATE public.production_machines SET allows_normal_production = false WHERE id = v_machine;
      WHEN 'revoked' THEN
        UPDATE public.operator_sessions SET revoked_at = clock_timestamp() WHERE id = v_session;
      WHEN 'expired' THEN
        UPDATE public.operator_sessions SET expires_at = clock_timestamp() - interval '1 minute' WHERE id = v_session;
      WHEN 'ended' THEN
        UPDATE public.operator_sessions SET ended_at = clock_timestamp() WHERE id = v_session;
      WHEN 'wrong_device' THEN
        v_payload := v_payload || jsonb_build_object('deviceId', gen_random_uuid()::text);
      WHEN 'no_cell_assignment' THEN
        UPDATE public.operator_cell_assignments SET active = false WHERE operator_id = v_operator;
      WHEN 'no_machine' THEN
        UPDATE public.operator_sessions SET machine_id = NULL WHERE id = v_session;
      WHEN 'wrong_machine_assignment' THEN
        INSERT INTO public.production_machines(id, name, cell_name, active, allows_normal_production)
        VALUES(v_other_machine, 'ROLLBACK_VOLUME_CONTEXT', v_cell.name, true, true);
        INSERT INTO public.operator_machine_assignments(operator_id, machine_id, active)
        VALUES(v_operator, v_other_machine, true);
      ELSE NULL;
    END CASE;
    EXECUTE 'set local role authenticated';
    BEGIN
      v_result := public.register_untraceable_stage_quantity(v_payload);
      IF v_expected_success THEN
        v_retry := public.register_untraceable_stage_quantity(v_payload);
      END IF;
    EXCEPTION WHEN OTHERS THEN v_error := sqlerrm; v_code := sqlstate;
    END;
    EXECUTE 'reset role';
    v_checks := jsonb_build_object('login_confirmed', true);
    IF v_expected_success THEN
      v_checks := v_checks || jsonb_build_object(
        'accepted', coalesce((v_result->>'success')::boolean, false),
        'stage_matches', v_result->>'stage_code' = public.resolve_production_stage_for_cell(v_cell.id, v_cell.name),
        'balance_once', (v_result->>'remaining_before')::integer - (v_result->>'remaining_after')::integer = 1,
        'idempotent', v_retry->>'record_id' = v_result->>'record_id' AND coalesce((v_retry->>'duplicated')::boolean, false),
        'single_record', (SELECT count(*) = 1 FROM public.manual_production_records WHERE client_event_id = v_event),
        'server_identity', (SELECT operator_id = v_operator AND machine_id = v_machine
          AND shift = '3º Turno' AND produced = 1 AND operator = 'ROLLBACK_VOLUME_CONTEXT'
          FROM public.production_entries WHERE id = (v_result->>'production_entry_id')::uuid),
        'no_individual_piece_change', v_result->>'individual_pieces_changed' = 'false');
    ELSE
      v_checks := v_checks || jsonb_build_object(
        'blocked', v_code = '42501' AND v_error IN ('OPERATOR_CONTEXT_REQUIRED', 'OPERATOR_SESSION_INVALID'),
        'no_write', NOT EXISTS(SELECT 1 FROM public.manual_production_records WHERE client_event_id = v_event)
          AND NOT EXISTS(SELECT 1 FROM public.production_entries WHERE client_event_id = v_event));
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'ROLLBACK_TEST_COMPLETE';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
  WHEN OTHERS THEN
    v_error := sqlerrm; v_code := sqlstate;
    v_checks := v_checks || jsonb_build_object('setup_completed', false);
  END;
  v_checks := v_checks || jsonb_build_object(
    'fixtures_removed', NOT EXISTS(SELECT 1 FROM public.operators WHERE id = v_operator)
      AND NOT EXISTS(SELECT 1 FROM public.production_machines WHERE id IN (v_machine, v_other_machine))
      AND NOT EXISTS(SELECT 1 FROM public.operator_sessions WHERE id = v_session),
    'test_writes_removed', NOT EXISTS(SELECT 1 FROM public.manual_production_records WHERE client_event_id = v_event)
      AND NOT EXISTS(SELECT 1 FROM public.production_entries WHERE client_event_id = v_event));
  SELECT bool_and(value = 'true'::jsonb) INTO v_passed FROM jsonb_each(v_checks);
  IF NOT coalesce(v_passed, false) THEN
    RAISE EXCEPTION 'Volume context case % failed after rollback: checks=%, code=%, error=%', p_case, v_checks, v_code, v_error;
  END IF;
  RETURN jsonb_build_object('case', p_case, 'passed', v_passed, 'checks', v_checks,
    'error', v_error, 'sqlstate', v_code, 'rolled_back', true);
END;
$test$;

SELECT jsonb_agg(pg_temp.volume_context_case(:'batch_id'::uuid, :'cell_id'::uuid, scenario)) AS regression
FROM unnest(ARRAY['exact','trimmed','padded','case','foreign_cell','inactive_machine',
  'normal_disabled','revoked','expired','ended','wrong_device','no_cell_assignment',
  'no_machine','wrong_machine_assignment']) scenario;

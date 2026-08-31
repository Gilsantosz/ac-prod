-- AC.Prod2 — structural acceptance test for exact 8-digit fast collection v8.5.
-- Read-only: invalid samples are rejected before any collection fact is created.
BEGIN;
SET LOCAL statement_timeout = '60s';

DO $test$
DECLARE
  v_release jsonb;
  v_definition text;
  v_result jsonb;
BEGIN
  v_release := public.get_public_collection_release();
  IF coalesce((v_release ->> 'ready')::boolean, false) IS NOT TRUE
     OR v_release ->> 'migration_version' <> '20260831150725'
     OR v_release ->> 'release_version' <> '20260831_acprod_collection_fast8_v8_5' THEN
    RAISE EXCEPTION 'TEST_FAIL: invalid release probe: %', v_release;
  END IF;

  IF public.normalize_collection_scan_code('09950001') <> '09950001'
     OR public.normalize_collection_scan_code('0995000') IS NOT NULL
     OR public.normalize_collection_scan_code('099500011') IS NOT NULL
     OR public.normalize_collection_scan_code('ABC50001') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: exact 8-digit normalizer contract invalid';
  END IF;

  SELECT lower(pg_get_functiondef(to_regprocedure('public.process_production_reading_v2(jsonb)')))
  INTO v_definition;
  IF position('normalize_collection_scan_code' in v_definition) = 0
     OR position('invalid_code_length' in v_definition) = 0
     OR position('expected_code_length' in v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: process_production_reading_v2 lacks exact-length gate';
  END IF;

  v_result := public.process_production_reading_v2(jsonb_build_object(
    'client_event_id', 'acceptance-fast8-short-' || gen_random_uuid()::text,
    'rawValue', '0995000',
    'readerType', 'keyboard_barcode'
  ));
  IF coalesce((v_result ->> 'success')::boolean, true) IS NOT FALSE
     OR v_result ->> 'status' <> 'invalid'
     OR v_result ->> 'reason_code' <> 'INVALID_CODE_LENGTH'
     OR (v_result ->> 'received_digit_count')::integer <> 7 THEN
    RAISE EXCEPTION 'TEST_FAIL: seven-digit input was not rejected: %', v_result;
  END IF;

  v_result := public.process_production_reading_v2(jsonb_build_object(
    'client_event_id', 'acceptance-fast8-long-' || gen_random_uuid()::text,
    'rawValue', '099500011',
    'readerType', 'keyboard_barcode'
  ));
  IF coalesce((v_result ->> 'success')::boolean, true) IS NOT FALSE
     OR v_result ->> 'reason_code' <> 'INVALID_CODE_LENGTH'
     OR (v_result ->> 'received_digit_count')::integer <> 9 THEN
    RAISE EXCEPTION 'TEST_FAIL: nine-digit input was not rejected: %', v_result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.production_tags tag
    WHERE tag.active IS TRUE
      AND tag.tag_value !~ '^[0-9]{8}$'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: active production tag outside 8-digit contract';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.production_collection_events
    WHERE client_event_id LIKE 'acceptance-fast8-%'
  ) OR EXISTS (
    SELECT 1 FROM public.production_stage_readings
    WHERE client_event_id LIKE 'acceptance-fast8-%'
  ) OR EXISTS (
    SELECT 1 FROM public.production_entries
    WHERE client_event_id LIKE 'acceptance-fast8-%'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: invalid scan created production facts';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'COLLECTION_FAST8_V8_5_CONTRACT_OK' AS result;

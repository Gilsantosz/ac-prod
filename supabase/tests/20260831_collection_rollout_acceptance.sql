-- AC.Prod2 — structural and integrity acceptance test for collection release v7.
-- Read-only: the transaction is rolled back and no production row is changed.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $test$
DECLARE v_count bigint:=0; v_definition text; v_release jsonb;
BEGIN
  IF to_regclass('public.production_cell_lot_states') IS NULL OR to_regclass('public.production_cell_active_contexts') IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: lifecycle/context tables missing'; END IF;
  IF NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid='public.production_cell_lot_states'::regclass),false) OR NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid='public.production_cell_active_contexts'::regclass),false) THEN RAISE EXCEPTION 'TEST_FAIL: lifecycle/context RLS disabled'; END IF;
  IF to_regprocedure('public.process_production_reading(jsonb)') IS NULL OR to_regprocedure('public.process_production_reading_v2(jsonb)') IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: collection RPC v2/wrapper missing'; END IF;
  IF to_regprocedure('public.get_operator_shift_kpis_v2(text,timestamptz)') IS NULL OR to_regprocedure('public.get_operator_shift_kpis_v2(uuid,timestamptz)') IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: shift KPI overloads missing'; END IF;
  IF has_function_privilege('anon','public.process_production_reading(jsonb)','EXECUTE') OR has_function_privilege('anon','public.process_production_reading_v2(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'TEST_FAIL: anon can execute production collection'; END IF;
  SELECT pg_get_functiondef(to_regprocedure('public.process_production_reading_v2(jsonb)')) INTO v_definition;
  IF position('pg_advisory_xact_lock' in v_definition)=0 OR position('validar_fluxo_da_peca' in v_definition)=0 OR position('auth.uid()' in v_definition)=0 OR position('FOR UPDATE' in upper(v_definition))=0 THEN RAISE EXCEPTION 'TEST_FAIL: v2 RPC lacks lock, route validation or auth binding'; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_start_time') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='shift_end_time') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='operators' AND column_name='timezone') THEN RAISE EXCEPTION 'TEST_FAIL: operator shift columns missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='production_stage_readings' AND column_name='raw_value') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='production_stage_readings' AND column_name='traceability_code') THEN RAISE EXCEPTION 'TEST_FAIL: cached-client history compatibility missing'; END IF;
  SELECT count(*) INTO v_count FROM (SELECT reading.piece_id,public.normalize_route_step_code(reading.step_name),coalesce(reading.production_cycle,1) FROM public.production_stage_readings reading WHERE reading.status='approved' AND reading.piece_id IS NOT NULL GROUP BY reading.piece_id,public.normalize_route_step_code(reading.step_name),coalesce(reading.production_cycle,1) HAVING count(*)>1) duplicated;
  IF v_count<>0 THEN RAISE EXCEPTION 'TEST_FAIL: % duplicate approved groups',v_count; END IF;
  SELECT count(*) INTO v_count FROM public.production_lots lot CROSS JOIN LATERAL public.get_collection_lot_route_metrics(lot.id) metrics WHERE lot.status NOT IN('cancelled','shipped') AND ((coalesce((metrics->>'is_complete')::boolean,false) AND lot.status<>'closed') OR (NOT coalesce((metrics->>'is_complete')::boolean,false) AND lot.status='closed'));
  IF v_count<>0 THEN RAISE EXCEPTION 'TEST_FAIL: % lot lifecycle drift rows',v_count; END IF;
  SELECT count(*) INTO v_count FROM public.operator_sessions session WHERE session.ended_at IS NULL AND session.revoked_at IS NULL AND session.expires_at<clock_timestamp() AND session.sync_grace_until<clock_timestamp();
  IF v_count<>0 THEN RAISE EXCEPTION 'TEST_FAIL: % expired sessions remain open',v_count; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='production_cell_lot_states') OR NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='production_cell_active_contexts') THEN RAISE EXCEPTION 'TEST_FAIL: lifecycle/context missing from Realtime'; END IF;
  v_release:=public.get_public_collection_release();
  IF coalesce((v_release->>'ready')::boolean,false) IS NOT TRUE OR v_release->>'migration_version'<>'20260831052809' OR v_release->>'release_version'<>'20260831_acprod_collection_db_v7' THEN RAISE EXCEPTION 'TEST_FAIL: invalid public release marker: %',v_release; END IF;
END
$test$;
ROLLBACK;
SELECT 'COLLECTION_ROLLOUT_V7_CONTRACT_OK' AS result;

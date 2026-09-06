-- TEST PROJECT ONLY: smnsihksrhzbkhcbdjfu (capacity-test).
-- Existing batch 15587 and at most two existing cells; no fixture/session/token
-- creation. All cache and revision writes below are rolled back. This is SQL
-- authorization simulation using an existing profile, NOT an Auth login/load test.
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '750ms';
CREATE TEMP TABLE capacity_readmodel_evidence (check_name text, evidence jsonb) ON COMMIT DROP;

DO $acceptance$
DECLARE
  v_batch uuid;
  v_admin uuid;
  v_operator uuid;
  v_cell record;
  v_cold jsonb;
  v_warm jsonb;
  v_invalidated jsonb;
  v_rewarmed jsonb;
  v_started timestamptz;
  v_expected bigint;
  v_canonical jsonb;
  v_members bigint;
  v_partial bigint;
  v_admin_claims text;
  v_failed boolean;
  v_before_revision timestamptz;
  v_after_revision timestamptz;
BEGIN
  IF public.canonical_production_stage_name('Corte') IS DISTINCT FROM 'cut'
     OR NOT (public.canonicalize_production_route(ARRAY['Bordo','Separação','Embalagem']) @> ARRAY['edge','packaging','separation']::text[])
     OR cardinality(public.canonicalize_production_route(ARRAY['Bordo','Separação','Embalagem']))<>3 THEN
    RAISE EXCEPTION 'TEST_FAIL: canonical routing aliases';
  END IF;
  IF public.piece_requires_routing_step('cut',public.canonicalize_production_route(ARRAY['Bordo','Separação','Embalagem']),true,true,false,false,true,true) IS DISTINCT FROM false
     OR public.piece_requires_routing_step('edge',public.canonicalize_production_route(ARRAY['Bordo','Separação','Embalagem']),true,true,false,false,true,true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST_FAIL: explicit route precedence over old flags';
  END IF;
  INSERT INTO capacity_readmodel_evidence VALUES ('canonical_aliases_and_precedence',jsonb_build_object('passed',true));
  SELECT id INTO STRICT v_batch FROM public.promob_import_batches
  WHERE general_lot_code='15587' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO STRICT v_admin FROM public.profiles WHERE active AND role='admin' ORDER BY id LIMIT 1;
  v_admin_claims:=jsonb_build_object('sub',v_admin,'role','authenticated')::text;

  IF has_function_privilege('anon','public.get_collection_dashboard_snapshot_v2(text,uuid,uuid,uuid,uuid,timestamptz)','EXECUTE')
     OR has_function_privilege('anon','public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)','EXECUTE')
     OR has_function_privilege('authenticated','private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)','EXECUTE')
     OR has_table_privilege('authenticated','private.collection_dashboard_batch_snapshots','SELECT') THEN
    RAISE EXCEPTION 'TEST_FAIL: browser privilege isolation';
  END IF;
  INSERT INTO capacity_readmodel_evidence VALUES ('acl_catalog',jsonb_build_object('anonymous_snapshot',false,'browser_cache_read',false,'browser_cache_refresh',false));

  -- An actual anonymous DB role cannot invoke the public read RPC.
  v_failed:=false;
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_collection_dashboard_snapshot_v2('Corte',NULL,NULL,v_batch,NULL,clock_timestamp());
  EXCEPTION WHEN insufficient_privilege THEN v_failed:=true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_failed THEN RAISE EXCEPTION 'TEST_FAIL: anonymous snapshot accepted'; END IF;

  -- An authenticated DB role without a user identity must also fail closed.
  v_failed:=false;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_collection_dashboard_snapshot_v2('Corte',NULL,NULL,v_batch,NULL,clock_timestamp());
  EXCEPTION WHEN insufficient_privilege THEN v_failed:=true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_failed THEN RAISE EXCEPTION 'TEST_FAIL: authenticated request without identity accepted'; END IF;
  INSERT INTO capacity_readmodel_evidence VALUES ('anonymous_and_missing_identity',jsonb_build_object('denied',true));

  FOR v_cell IN SELECT id,name,public.resolve_production_stage_for_cell(id,name) AS step
    FROM public.cells WHERE name IN ('Corte','Borda') ORDER BY name LIMIT 2
  LOOP
    IF v_cell.step IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: unmapped existing cell'; END IF;
    DELETE FROM private.collection_dashboard_batch_snapshots
    WHERE pcp_import_batch_id=v_batch AND cell_name=lower(btrim(v_cell.name)) AND step_code=lower(btrim(v_cell.step));

    PERFORM set_config('request.jwt.claims',v_admin_claims,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_started:=clock_timestamp();
    v_cold:=public.get_collection_dashboard_snapshot_v2(v_cell.name,NULL,NULL,v_batch,NULL,clock_timestamp());
    EXECUTE 'RESET ROLE';
    IF v_cold->>'metrics_source'<>'route_metrics_fallback' THEN RAISE EXCEPTION 'TEST_FAIL: cold route fallback not used'; END IF;
    v_expected:=(v_cold->>'expected')::bigint;
    INSERT INTO capacity_readmodel_evidence VALUES ('cold_snapshot',jsonb_build_object('cell',v_cell.name,'elapsed_ms',extract(epoch FROM clock_timestamp()-v_started)*1000,'metrics',v_cold->'lot_kpis','source',v_cold->>'metrics_source'));
    v_canonical:=public.get_collection_route_stage_metrics(v_batch,NULL,v_cell.step);
    IF v_expected IS DISTINCT FROM (v_canonical->>'expected')::bigint
       OR (v_cold->>'approved')::bigint IS DISTINCT FROM (v_canonical->>'approved')::bigint
       OR (v_cold->>'pending')::bigint IS DISTINCT FROM (v_canonical->>'pending')::bigint THEN
      RAISE EXCEPTION 'TEST_FAIL: full-batch canonical metrics differ';
    END IF;
    SELECT count(DISTINCT coalesce(piece.original_piece_id,piece.id)) INTO v_members
    FROM public.production_pieces piece JOIN public.production_lots lot ON lot.id=piece.lot_id
    WHERE coalesce(piece.pcp_import_batch_id,lot.pcp_import_batch_id)=v_batch
      AND coalesce(piece.is_active,true) AND piece.status NOT IN ('cancelled','shipped')
      AND public.piece_requires_routing_step(v_cell.step,piece.route_steps,piece.requires_cut,piece.requires_edge,piece.requires_cnc,piece.requires_joinery,piece.requires_separation,piece.requires_packaging);
    SELECT coalesce(sum(expected_count),0) INTO v_partial FROM public.production_cell_lot_states
    WHERE pcp_import_batch_id=v_batch AND lower(btrim(cell_name))=lower(btrim(v_cell.name))
      AND lower(btrim(step_code))=lower(btrim(v_cell.step)) AND machine_id IS NULL;
    IF v_expected<v_partial THEN RAISE EXCEPTION 'TEST_FAIL: full-batch smaller than existing per-lot read model'; END IF;
    IF v_expected IS DISTINCT FROM v_members THEN RAISE EXCEPTION 'TEST_FAIL: canonical route count % differs from explicit-route members % for %',v_expected,v_members,v_cell.name; END IF;
    INSERT INTO capacity_readmodel_evidence VALUES ('full_batch_universe',jsonb_build_object('cell',v_cell.name,'expected',v_expected,'active_logical_route_members',v_members,'existing_unscoped_lot_cache_expected',v_partial,'canonical_matches',true,'explicit_route_matches',true));

    -- Refresh is privileged, bounded to this existing batch/cell/step.
    PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
    v_started:=clock_timestamp();
    PERFORM private.refresh_collection_dashboard_batch_snapshot(v_batch,v_cell.name,v_cell.step);
    INSERT INTO capacity_readmodel_evidence VALUES ('scoped_refresh',jsonb_build_object('cell',v_cell.name,'elapsed_ms',extract(epoch FROM clock_timestamp()-v_started)*1000));

    PERFORM set_config('request.jwt.claims',v_admin_claims,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_started:=clock_timestamp();
    v_warm:=public.get_collection_dashboard_snapshot_v2(v_cell.name,NULL,NULL,v_batch,NULL,clock_timestamp());
    EXECUTE 'RESET ROLE';
    IF v_warm->>'metrics_source'<>'collection_dashboard_batch_snapshots'
       OR v_warm->'lot_kpis' IS DISTINCT FROM v_cold->'lot_kpis' THEN
      RAISE EXCEPTION 'TEST_FAIL: warm snapshot mismatch';
    END IF;
    INSERT INTO capacity_readmodel_evidence VALUES ('warm_snapshot',jsonb_build_object('cell',v_cell.name,'elapsed_ms',extract(epoch FROM clock_timestamp()-v_started)*1000,'metrics',v_warm->'lot_kpis','source',v_warm->>'metrics_source'));

    SELECT collection_snapshot_updated_at INTO v_before_revision FROM public.promob_import_batches WHERE id=v_batch;
    UPDATE public.promob_import_batches SET collection_snapshot_updated_at=collection_snapshot_updated_at WHERE id=v_batch;
    SELECT collection_snapshot_updated_at INTO v_after_revision FROM public.promob_import_batches WHERE id=v_batch;
    IF v_after_revision IS NOT DISTINCT FROM v_before_revision THEN RAISE EXCEPTION 'TEST_FAIL: batch revision not advanced'; END IF;
    PERFORM set_config('request.jwt.claims',v_admin_claims,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_invalidated:=public.get_collection_dashboard_snapshot_v2(v_cell.name,NULL,NULL,v_batch,NULL,clock_timestamp());
    EXECUTE 'RESET ROLE';
    IF v_invalidated->>'metrics_source'<>'route_metrics_fallback'
       OR v_invalidated->'lot_kpis' IS DISTINCT FROM v_cold->'lot_kpis' THEN
      RAISE EXCEPTION 'TEST_FAIL: stale cache was served after batch UPDATE';
    END IF;
    PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
    PERFORM private.refresh_collection_dashboard_batch_snapshot(v_batch,v_cell.name,v_cell.step);
    PERFORM set_config('request.jwt.claims',v_admin_claims,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_rewarmed:=public.get_collection_dashboard_snapshot_v2(v_cell.name,NULL,NULL,v_batch,NULL,clock_timestamp());
    EXECUTE 'RESET ROLE';
    IF v_rewarmed->>'metrics_source'<>'collection_dashboard_batch_snapshots'
       OR v_rewarmed->'lot_kpis' IS DISTINCT FROM v_cold->'lot_kpis' THEN
      RAISE EXCEPTION 'TEST_FAIL: refreshed revision not readable';
    END IF;
    INSERT INTO capacity_readmodel_evidence VALUES ('revision_invalidation',jsonb_build_object('cell',v_cell.name,'invalidated',true,'rewarmed',true));
  END LOOP;

  -- This fixture has no active operator session. Never invent or reactivate one
  -- to make the KPI succeed: the public endpoint must reject it accurately.
  SELECT operator_id INTO v_operator FROM public.operator_sessions ORDER BY id LIMIT 1;
  IF v_operator IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.operator_sessions WHERE operator_id=v_operator AND auth_user_id=v_admin AND ended_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
    v_failed:=false;
    PERFORM set_config('request.jwt.claims',v_admin_claims,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.get_operator_shift_kpis_v2(v_operator,clock_timestamp());
    EXCEPTION WHEN insufficient_privilege THEN v_failed:=true;
    END;
    EXECUTE 'RESET ROLE';
    IF NOT v_failed THEN RAISE EXCEPTION 'TEST_FAIL: KPI accepted missing active operator session'; END IF;
    INSERT INTO capacity_readmodel_evidence VALUES ('kpi_without_active_session',jsonb_build_object('denied',true));
  END IF;
END;
$acceptance$;
SELECT check_name,evidence FROM capacity_readmodel_evidence;
ROLLBACK;

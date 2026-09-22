-- AS-APPLIED RECORD. KNOWN runtime error 42702 (login_name ambiguity).
-- NOT a successful generator release. Do not execute as production migration.
-- Historical source for the private helper installed on capacity-test.
-- No new HTTP endpoint or Auth bypass. The first seed transaction rolled back.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user <> 'postgres' OR to_regclass('private.capacity_20260922_definition_backup') IS NULL
 OR md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure)) <> '90ffa0ee5c0f4b6b82c3a92a7d056bcf'
 THEN RAISE EXCEPTION 'STAGING_BASELINE_REQUIRED'; END IF;
END;$guard$;
CREATE FUNCTION private.capacity_real_uid_v1(p_key text)
RETURNS uuid LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER
SET search_path=pg_catalog,extensions AS $uid$
 WITH h AS (SELECT encode(extensions.digest('LOAD_TEST_20260922_V1:'||p_key,'sha256'),'hex') AS s)
 SELECT (substr(s,1,8)||'-'||substr(s,9,4)||'-4'||substr(s,14,3)||'-a'||substr(s,18,3)||'-'||substr(s,21,12))::uuid FROM h;
$uid$;
REVOKE ALL ON FUNCTION private.capacity_real_uid_v1(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.capacity_real_seed_v1(p_pieces_per_lot integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,private,extensions
SET lock_timeout='2s' AS $seed$
DECLARE
 seed constant text := 'LOAD_TEST_20260922_V1';
 prefix constant text := 'ACPROD-CT-LOAD-TEST-20260922-V1';
 run_id uuid := private.capacity_real_uid_v1('run');
 admin_id uuid; st record; c record; j integer; idx integer:=0; n integer;
 m_id uuid; op_id uuid; assign_id uuid; order_id uuid; lot_id uuid; batch_id uuid;
 old_run public.capacity_test_runs%rowtype;
 machine_name text; login_name text;
BEGIN
 IF current_user <> 'postgres' OR to_regclass('private.capacity_20260922_definition_backup') IS NULL
 THEN RAISE EXCEPTION 'STAGING_ADMINISTRATION_ONLY'; END IF;
 IF p_pieces_per_lot NOT BETWEEN 1 AND 2000 OR p_pieces_per_lot IS NULL THEN RAISE EXCEPTION 'INVALID_PIECE_COUNT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(seed,0));
 SELECT * INTO old_run FROM public.capacity_test_runs WHERE id=run_id FOR UPDATE;
 IF FOUND THEN
  IF old_run.project_ref <> 'smnsihksrhzbkhcbdjfu' OR old_run.synthetic_prefix<>prefix OR old_run.is_test IS NOT TRUE
    OR old_run.configuration->>'seed' IS DISTINCT FROM seed THEN RAISE EXCEPTION 'RUN_ID_CONFLICT'; END IF;
  IF old_run.runner_instance_id IS NOT NULL AND old_run.runner_stopped_at IS NULL THEN RAISE EXCEPTION 'RUNNER_ACTIVE'; END IF;
  IF old_run.total_pieces<>100*p_pieces_per_lot THEN RAISE EXCEPTION 'FIXTURE_SIZE_CONFLICT'; END IF;
 END IF;
 SELECT id INTO admin_id FROM public.profiles WHERE role='admin' AND active IS TRUE ORDER BY created_at,id LIMIT 1;
 IF admin_id IS NULL THEN RAISE EXCEPTION 'ACTIVE_ADMIN_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.production_pieces WHERE traceability_code BETWEEN '62000000' AND '62199999'
   AND piece_uid NOT LIKE prefix||'-PIECE-%') THEN RAISE EXCEPTION 'TRACEABILITY_RANGE_COLLISION'; END IF;
 INSERT INTO public.capacity_test_runs(id,name,status,environment,project_ref,is_test,synthetic_prefix,created_by,total_pieces,total_expected_events,configuration,preflight)
 VALUES(run_id,'LOAD_TEST 200/100 - 20260922','preparing','supabase_branch','smnsihksrhzbkhcbdjfu',true,prefix,admin_id,
  100*p_pieces_per_lot,700*p_pieces_per_lot,
  jsonb_build_object('seed',seed,'planned_sessions',200,'collectors',100,'pieces_per_lot',p_pieces_per_lot,'auth_provisioned',false,'source','synthetic_manual'),
  jsonb_build_object('passed',false,'phase','fixture_only','auth_sessions_measured',0))
 ON CONFLICT(id) DO NOTHING;
 IF old_run.status='cleaned' THEN
  UPDATE public.capacity_test_runs SET status='preparing',cleaned_at=NULL,state_version=state_version+1 WHERE id=run_id;
 END IF;
 FOR st IN SELECT * FROM (VALUES ('cut','Corte',25),('edge','Borda',30),('drill','Furação',15),('cnc','Usinagem',10),
   ('joinery','Marcenaria',10),('separation','Separação',5),('packaging','Embalagem',5)) AS s(stage,cell_name,stations)
 LOOP
  SELECT id,name INTO STRICT c FROM public.cells WHERE name=st.cell_name AND active IS TRUE;
  IF public.resolve_production_stage_for_cell(c.id,c.name) IS DISTINCT FROM st.stage THEN RAISE EXCEPTION 'STAGE_MAPPING_MISMATCH'; END IF;
  FOR j IN 0..st.stations-1 LOOP
   m_id:=private.capacity_real_uid_v1('machine:'||st.stage||':'||j);
   op_id:=private.capacity_real_uid_v1('operator:'||idx);
   machine_name:=prefix||'-'||upper(st.stage)||'-'||lpad((j+1)::text,2,'0');
   login_name:=lower(prefix)||'-op-'||lpad(idx::text,3,'0');
   IF EXISTS(SELECT 1 FROM public.production_machines WHERE id=m_id AND name<>machine_name)
    OR EXISTS(SELECT 1 FROM public.operators o WHERE o.id=op_id AND o.login_name<>login_name) THEN RAISE EXCEPTION 'IDENTITY_COLLISION'; END IF;
   INSERT INTO public.production_machines(id,name,cell_name,station_name,metric_unit,active,description,allows_normal_production,allows_replacement,allows_rework)
   VALUES(m_id,machine_name,c.name,machine_name,'pieces',true,'LOAD_TEST '||seed,true,false,false) ON CONFLICT(id) DO NOTHING;
   INSERT INTO public.operators(id,name,role,active,registration,login_name,primary_cell,cells,shift,login_enabled,primary_cell_id,primary_machine_id,created_by)
   VALUES(op_id,prefix||' OPERADOR '||idx,'operator',true,upper(encode(extensions.gen_random_bytes(12),'hex')),login_name,c.name,ARRAY[c.name],'1',false,c.id,m_id,admin_id)
   ON CONFLICT(id) DO NOTHING;
   INSERT INTO public.capacity_test_entities(test_run_id,entity_type,entity_id,synthetic_key,stage,metadata) VALUES
    (run_id,'machine',m_id,machine_name,st.stage,jsonb_build_object('classification','LOAD_TEST','physical_cell_mapping','machine_id_1_to_1')),
    (run_id,'operator',op_id,login_name,st.stage,jsonb_build_object('classification','LOAD_TEST','device_id',private.capacity_real_uid_v1('device:'||idx)))
   ON CONFLICT(test_run_id,entity_type,entity_id) DO NOTHING;
   assign_id:=private.capacity_real_uid_v1('cell_assignment:'||idx);
   INSERT INTO public.operator_cell_assignments(id,operator_id,cell_id,is_primary,active,assigned_by) VALUES(assign_id,op_id,c.id,true,true,admin_id) ON CONFLICT(id) DO NOTHING;
   INSERT INTO public.capacity_test_entities(test_run_id,entity_type,entity_id,synthetic_key) VALUES(run_id,'cell_assignment',assign_id,assign_id::text) ON CONFLICT DO NOTHING;
   assign_id:=private.capacity_real_uid_v1('machine_assignment:'||idx);
   INSERT INTO public.operator_machine_assignments(id,operator_id,machine_id,is_primary,active,assigned_by) VALUES(assign_id,op_id,m_id,true,true,admin_id) ON CONFLICT(id) DO NOTHING;
   INSERT INTO public.capacity_test_entities(test_run_id,entity_type,entity_id,synthetic_key) VALUES(run_id,'machine_assignment',assign_id,assign_id::text) ON CONFLICT DO NOTHING;
   assign_id:=private.capacity_real_uid_v1('authorization:'||idx);
   INSERT INTO public.workstation_operator_authorizations(id,operator_id,machine_id,cell_id,shift,authorization_type,is_active,authorized_by,training_validated,notes)
   VALUES(assign_id,op_id,m_id,c.id,'1','temporary',true,admin_id,true,'LOAD_TEST '||seed) ON CONFLICT(id) DO NOTHING;
   INSERT INTO public.capacity_test_entities(test_run_id,entity_type,entity_id,synthetic_key) VALUES(run_id,'workstation_authorization',assign_id,assign_id::text) ON CONFLICT DO NOTHING;
   idx:=idx+1;
  END LOOP;
 END LOOP;
 FOR n IN 0..99 LOOP
  batch_id:=private.capacity_real_uid_v1('batch:'||(n/10));
  order_id:=private.capacity_real_uid_v1('order:'||n);
  lot_id:=private.capacity_real_uid_v1('lot:'||n);
  IF EXISTS(SELECT 1 FROM public.production_orders o WHERE o.id=order_id AND o.order_code<>prefix||'-ORDER-'||n)
   OR EXISTS(SELECT 1 FROM public.production_lots l WHERE l.id=lot_id AND l.lot_code<>prefix||'-LOT-'||n)
   OR EXISTS(SELECT 1 FROM public.promob_import_batches b WHERE b.id=batch_id AND b.general_lot_code<>prefix||'-BATCH-'||(n/10))
  THEN RAISE EXCEPTION 'STRUCTURE_COLLISION'; END IF;
  INSERT INTO public.production_orders(id,order_code,customer_name,source,status,notes,created_by)
  VALUES(order_id,prefix||'-ORDER-'||n,'LOAD_TEST CUSTOMER','manual','imported',seed,admin_id) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.promob_import_batches(id,source_type,general_lot_code,file_name,status,total_parts,notes,imported_by)
  VALUES(batch_id,'xml_upload',prefix||'-BATCH-'||(n/10),prefix||'-BATCH-'||(n/10)||'.synthetic.json','processed',10*p_pieces_per_lot,'LOAD_TEST synthetic fixture; original import not exercised',admin_id)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.production_lots(id,order_id,production_order_id,lot_code,status,planned_quantity,pcp_import_batch_id,general_lot_code)
  VALUES(lot_id,order_id,order_id,prefix||'-LOT-'||n,'planned',p_pieces_per_lot,batch_id,prefix||'-BATCH-'||(n/10)) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.capacity_test_entities(test_run_id,entity_type,entity_id,synthetic_key) VALUES
   (run_id,'production_order',order_id,prefix||'-ORDER-'||n),
   (run_id,'import_batch',batch_id,prefix||'-BATCH-'||(n/10)),
   (run_id,'production_lot',lot_id,prefix||'-LOT-'||n) ON CONFLICT DO NOTHING;
  INSERT INTO public.production_pieces(id,piece_uid,traceability_code,piece_code,production_order_id,lot_id,pcp_import_batch_id,piece_name,source_origin,
   route_steps,completed_steps,current_stage,status,requires_cut,requires_edge,requires_cnc,requires_joinery,requires_separation,requires_packaging,is_active,quantity,environment)
  SELECT private.capacity_real_uid_v1('piece:'||n||':'||x),prefix||'-PIECE-'||n||'-'||x,(62000000+n*2000+x)::text,(62000000+n*2000+x)::text,
   order_id,lot_id,batch_id,'LOAD_TEST PIECE '||n||'/'||x,'manual',ARRAY['cut','edge','drill','cnc','joinery','separation','packaging'],ARRAY[]::text[],'cut','created',true,true,true,true,true,true,true,1,'LOAD_TEST'
  FROM generate_series(0,p_pieces_per_lot-1) AS g(x) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.capacity_test_entities(test_run_id,entity_type,entity_id,synthetic_key,metadata)
  SELECT run_id,'piece',private.capacity_real_uid_v1('piece:'||n||':'||x),prefix||'-PIECE-'||n||'-'||x,jsonb_build_object('classification','LOAD_TEST')
  FROM generate_series(0,p_pieces_per_lot-1) AS g(x) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('run_id',run_id,'seed',seed,'machines',idx,'operators',idx,'lots',100,'orders',100,'batches',10,
  'pieces',(SELECT count(*) FROM public.production_pieces p JOIN public.capacity_test_entities e ON e.entity_id=p.id AND e.entity_type='piece' WHERE e.test_run_id=run_id),
  'auth_users_created',0,'load_executed',false,'operator_login_enabled',false,'capacity_result','NOT_MEASURED');
END;$seed$;
REVOKE ALL ON FUNCTION private.capacity_real_seed_v1(integer) FROM PUBLIC,anon,authenticated,service_role;

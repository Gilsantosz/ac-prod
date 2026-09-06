-- Integration test: only generated fixtures, every change is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_operator uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_lot uuid := gen_random_uuid();
  v_original uuid := gen_random_uuid();
  v_piece uuid := gen_random_uuid();
  v_rep uuid := gen_random_uuid();
  v_cell uuid;
  v_token text := gen_random_uuid()::text;
  v_device text := 'qa-replacement-' || gen_random_uuid()::text;
  v_event uuid := gen_random_uuid();
  v_code text := 'QA-REP-' || gen_random_uuid()::text;
  v_result jsonb;
  v_replay jsonb;
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES(v_user, v_user::text || '@example.invalid', '{"name":"QA rollback replacement"}');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);
  SELECT id INTO STRICT v_cell FROM public.cells WHERE active AND public.normalize_replacement_step_code(name)='cut' ORDER BY name LIMIT 1;
  INSERT INTO public.operators(id,name,active,login_enabled,replacement_enabled) VALUES(v_operator,'QA rollback replacement',true,true,true);
  INSERT INTO public.operator_cell_assignments(operator_id,cell_id) VALUES(v_operator,v_cell);
  INSERT INTO public.workstation_operator_authorizations(operator_id,cell_id) VALUES(v_operator,v_cell);
  INSERT INTO public.operator_sessions(operator_id,auth_user_id,token_hash,device_id,cell_id,expires_at,shift_snapshot)
  VALUES(v_operator,v_user,encode(extensions.digest(v_token,'sha256'),'hex'),v_device,v_cell,now()+interval '1 hour','1');
  INSERT INTO public.production_orders(id,order_code) VALUES(v_order,v_code);
  INSERT INTO public.production_lots(id,order_id,lot_code,status) VALUES(v_lot,v_order,v_code,'in_progress');
  INSERT INTO public.production_pieces(id,piece_uid,traceability_code,piece_code,lot_id,production_order_id,route_steps,status,current_stage)
  VALUES(v_original,v_code || '-original',v_code || '-original',v_code || '-original',v_lot,v_order,ARRAY['cut','edge'],'rejected','cut');
  INSERT INTO public.production_pieces(id,piece_uid,traceability_code,piece_code,lot_id,production_order_id,route_steps,status,current_stage,is_replacement,original_piece_id,source_origin)
  VALUES(v_piece,v_code,v_code,v_code,v_lot,v_order,ARRAY['cut','edge'],'planned','cut',true,v_original,'replacement');
  INSERT INTO public.replacement_orders(id,original_piece_id,replacement_piece_id,replacement_code,replacement_barcode,reason,status,lot_id)
  VALUES(v_rep,v_original,v_piece,v_code,v_code,'QA rollback','released',v_lot);

  BEGIN
    UPDATE public.replacement_orders SET status='completed' WHERE id=v_rep;
    RAISE EXCEPTION 'Unauthorized force-completion was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  v_result := public.collect_replacement_stage_v3(v_token,v_code,v_event,v_device,now(),'{}');
  IF NOT coalesce((v_result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Collection failed: %',v_result; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.production_stage_readings WHERE client_event_id=v_event::text AND piece_id=v_piece AND piece_code=v_code AND traceability_type='replacement_stage') THEN
    RAISE EXCEPTION 'Missing replacement reading or incorrect piece_code/traceability_type mapping';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.production_pieces WHERE id=v_piece AND completed_steps=ARRAY['cut'] AND current_stage='edge') THEN RAISE EXCEPTION 'Route did not advance exactly one stage'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.production_pieces WHERE id=v_original AND status='rejected') THEN RAISE EXCEPTION 'Original piece released too early'; END IF;
  v_replay := public.collect_replacement_stage_v3(v_token,v_code,v_event,v_device,now(),'{}');
  IF NOT coalesce((v_replay->>'idempotent')::boolean,false) THEN RAISE EXCEPTION 'Replay not idempotent: %',v_replay; END IF;
  IF (SELECT count(*) FROM public.production_stage_readings WHERE client_event_id=v_event::text) <> 1 THEN RAISE EXCEPTION 'Duplicate reading'; END IF;
  IF (SELECT count(*) FROM public.production_collection_events WHERE client_event_id=v_event::text) <> 1 THEN RAISE EXCEPTION 'Missing/duplicate history event'; END IF;
  v_replay := public.collect_replacement_stage_v3(v_token,v_code,gen_random_uuid(),v_device,now(),'{}');
  IF coalesce((v_replay->>'success')::boolean,false) THEN RAISE EXCEPTION 'Second scan at same stage was incorrectly accepted'; END IF;
  SELECT id INTO STRICT v_cell FROM public.cells WHERE active AND public.normalize_replacement_step_code(name)='edge' ORDER BY name LIMIT 1;
  INSERT INTO public.operator_cell_assignments(operator_id,cell_id) VALUES(v_operator,v_cell);
  INSERT INTO public.workstation_operator_authorizations(operator_id,cell_id) VALUES(v_operator,v_cell);
  UPDATE public.operator_sessions SET cell_id=v_cell WHERE operator_id=v_operator;
  v_event := gen_random_uuid();
  v_result := public.collect_replacement_stage_v3(v_token,v_code,v_event,v_device,now(),'{}');
  IF NOT coalesce((v_result->>'replacement_completed')::boolean,false) THEN RAISE EXCEPTION 'Final stage failed: %',v_result; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.production_stage_readings WHERE client_event_id=v_event::text AND piece_code=v_code AND traceability_type='approved_via_replacement') THEN RAISE EXCEPTION 'Final reading incorrect'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.production_pieces WHERE id=v_original AND status='replaced') THEN RAISE EXCEPTION 'Original not replaced on final stage'; END IF;
END
$test$;
ROLLBACK;
SELECT 'REPLACEMENT_COLLECTION_ROLLBACK_OK' AS result;

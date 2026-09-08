-- Uma chamada autentica o ingresso e confirma a decisão canônica da leitura.
-- O recibo, claim, decisão e archive são atômicos; projeção pesada permanece no outbox.
-- Não altera JWT, service_role, sessão, fila offline ou validações de rota.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $baseline$
BEGIN
 IF md5(pg_get_functiondef('public.ingest_collection_batch_v3(uuid,uuid,jsonb)'::regprocedure)) <> '89eafa55778f0a835aab880c518411fb'
 OR md5(pg_get_functiondef('private.process_collection_batch_v3(text,jsonb)'::regprocedure)) <> '2a97588896ae453ff00d75757ded779a'
 OR md5(pg_get_functiondef('public.sync_pcp_batch_progress_from_piece()'::regprocedure)) <> '06ebbec1fcd7fef010449b94dc859801' THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_BASELINE_CHANGED';
 END IF;
END;
$baseline$;

-- Marcador protegido, visível só dentro da transação que já autenticou os recibos.
-- GUCs sozinhos não concedem o direito de executar decisões nem adiar agregados.
CREATE TABLE private.collection_immediate_context_v3 (
 backend_pid integer NOT NULL,
 transaction_id xid8 NOT NULL,
 auth_user_id uuid NOT NULL,
 receipt_id uuid NOT NULL REFERENCES public.coletas_producao(id) ON DELETE RESTRICT,
 PRIMARY KEY(backend_pid,transaction_id,receipt_id)
);
ALTER TABLE private.collection_immediate_context_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.collection_immediate_context_v3 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.collection_immediate_context_active_v3()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,private,pg_temp AS $fn$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
  SELECT 1 FROM private.collection_immediate_context_v3 c
  WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=pg_current_xact_id()
   AND c.auth_user_id=auth.uid()
 );
$fn$;
REVOKE ALL ON FUNCTION private.collection_immediate_context_active_v3() FROM PUBLIC,anon,authenticated,service_role;

-- A mesma implementação continua responsável por rota, lock da peça, aprovação
-- única, recibos, outbox, rejeições e arquivamento. Só ampliamos a guarda privada.
DO $processor$
DECLARE
 body text:=pg_get_functiondef('private.process_collection_batch_v3(text,jsonb)'::regprocedure);
 old_guard text:=$old$  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;$old$;
 new_guard text:=$new$  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF NOT private.collection_immediate_context_active_v3() THEN
      RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'COLLECTION_IMMEDIATE_ITEMS_INVALID' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(p_items)<1 OR jsonb_array_length(p_items)>5
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) input(value)
         WHERE NOT EXISTS(SELECT 1 FROM private.collection_immediate_context_v3 c
           WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=pg_current_xact_id()
             AND c.auth_user_id=auth.uid()
             AND c.receipt_id=private.try_collection_uuid_v3(input.value->'message'->>'receipt_id'))) THEN
      RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RECEIPT_SCOPE_INVALID' USING ERRCODE='42501';
    END IF;
  END IF;$new$;
BEGIN
 IF position(old_guard IN body)=0 THEN RAISE EXCEPTION 'COLLECTION_IMMEDIATE_PROCESSOR_SHAPE_CHANGED'; END IF;
 body:=replace(body,old_guard,new_guard);
 IF position('ORDER BY piece_id NULLS LAST, client_event_id NULLS LAST, ordinal' IN body)=0 THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_PROCESSOR_ORDER_CHANGED';
 END IF;
 -- Locks continuam ordenados por peça. Leituras da mesma peça seguem a captura.
 EXECUTE replace(body,
  'ORDER BY piece_id NULLS LAST, client_event_id NULLS LAST, ordinal',
  'ORDER BY piece_id NULLS LAST,
       CASE WHEN private.collection_immediate_context_active_v3() THEN ordinal END,
       client_event_id NULLS LAST, ordinal');
 body:=pg_get_functiondef('public.sync_pcp_batch_progress_from_piece()'::regprocedure);
 IF position('AND coalesce(auth.role(), '''') = ''service_role'' THEN' IN body)=0 THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_TRIGGER_SHAPE_CHANGED';
 END IF;
 EXECUTE replace(body,
  'AND coalesce(auth.role(), '''') = ''service_role'' THEN',
  'AND (coalesce(auth.role(), '''') = ''service_role'' OR private.collection_immediate_context_active_v3()) THEN');
END;
$processor$;

CREATE FUNCTION public.ingest_collection_batch_immediate_v3(
 p_batch_id uuid,p_device_id uuid,p_events jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,pgmq,pg_temp AS $fn$
DECLARE
 actor uuid:=auth.uid();
 worker text:='immediate:'||gen_random_uuid()::text;
 previous_wake text:=coalesce(current_setting('acprod.collection_v3_wake_decision',true),'');
 previous_decision text:=coalesce(current_setting('acprod.collection_v3_decision',true),'');
 previous_lock_timeout text:=current_setting('lock_timeout');
 ingress jsonb;
 items jsonb:='[]'::jsonb;
 claimed jsonb;
 processed jsonb;
 response jsonb;
 row_receipt public.coletas_producao%ROWTYPE;
 claim_time timestamptz;
BEGIN
 IF actor IS NULL OR coalesce(auth.role(),'')<>'authenticated' THEN
  RAISE EXCEPTION 'AUTHENTICATED_OPERATOR_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_events) IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_events->'events') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'COLLECTION_BATCH_ENVELOPE_INVALID' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_events->'events')<1 OR jsonb_array_length(p_events->'events')>5 THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_BATCH_LIMIT_5' USING ERRCODE='22023';
 END IF;
 -- A função de ingresso existente valida sessão, captura, máquina, célula,
 -- escopo, dispositivo/sequência e idempotência antes de qualquer decisão.
 PERFORM set_config('acprod.collection_v3_wake_decision','sent',true);
 PERFORM set_config('lock_timeout','500ms',true);
 ingress:=public.ingest_collection_batch_v3(p_batch_id,p_device_id,p_events);
 FOR row_receipt IN
  SELECT r.* FROM public.coletas_producao r
  WHERE r.id IN(SELECT input.receipt_id FROM pg_temp.collection_v3_ingress_input input
    WHERE input.error_code IS NULL AND input.receipt_id IS NOT NULL)
  ORDER BY r.id FOR UPDATE
 LOOP
  IF row_receipt.auth_user_id IS DISTINCT FROM actor
     OR row_receipt.device_id IS DISTINCT FROM p_device_id::text THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RECEIPT_OWNER_INVALID' USING ERRCODE='42501';
  END IF;
  -- Reenvio de uma decisão já gravada nunca decide novamente nem reconta a peça.
  IF row_receipt.decision_committed_at IS NOT NULL OR row_receipt.dead_lettered_at IS NOT NULL THEN
   CONTINUE;
  END IF;
  IF row_receipt.operator_session_id IS DISTINCT FROM
      private.try_collection_uuid_v3(p_events->>'operator_session_id') THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_SESSION_MISMATCH' USING ERRCODE='42501';
  END IF;
  claim_time:=clock_timestamp();
  claimed:=NULL;
  IF row_receipt.queue_name='collection_live_v3' THEN
   UPDATE pgmq.q_collection_live_v3 q
   SET read_ct=q.read_ct+1,vt=claim_time+interval '45 seconds'
   WHERE q.msg_id=row_receipt.queue_message_id AND q.vt<=claim_time
     AND q.message->>'receipt_id'=row_receipt.id::text
     AND q.message->>'client_event_id'=row_receipt.client_event_id
   RETURNING to_jsonb(q)||jsonb_build_object('queue_name','collection_live_v3') INTO claimed;
  ELSIF row_receipt.queue_name='collection_replay_v3' THEN
   UPDATE pgmq.q_collection_replay_v3 q
   SET read_ct=q.read_ct+1,vt=claim_time+interval '45 seconds'
   WHERE q.msg_id=row_receipt.queue_message_id AND q.vt<=claim_time
     AND q.message->>'receipt_id'=row_receipt.id::text
     AND q.message->>'client_event_id'=row_receipt.client_event_id
   RETURNING to_jsonb(q)||jsonb_build_object('queue_name','collection_replay_v3') INTO claimed;
  END IF;
  IF claimed IS NULL THEN
   -- Um worker anterior pode estar tratando este recibo. Não devolve falso ACK final.
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RECEIPT_BUSY' USING ERRCODE='55P03';
  END IF;
  INSERT INTO private.collection_immediate_context_v3
    (backend_pid,transaction_id,auth_user_id,receipt_id)
  VALUES(pg_backend_pid(),pg_current_xact_id(),actor,row_receipt.id);
  UPDATE public.coletas_producao
  SET status_sincronizacao='processando',claimed_at=claim_time,
    lease_expires_at=claim_time+interval '45 seconds',worker_id=worker,
    attempt_count=greatest(attempt_count,(claimed->>'read_ct')::integer),
    queue_delay_ms=extract(epoch FROM claim_time-coalesce(enqueued_at,received_at_db))*1000,
    updated_at=claim_time
  WHERE id=row_receipt.id;
  INSERT INTO public.collection_processing_attempts(
    client_event_id,attempt_number,worker_id,queue_name,claimed_at,queue_delay_ms)
  VALUES(row_receipt.client_event_id,(claimed->>'read_ct')::integer,worker,row_receipt.queue_name,
    claim_time,extract(epoch FROM claim_time-coalesce(row_receipt.enqueued_at,row_receipt.received_at_db))*1000)
  ON CONFLICT(client_event_id,attempt_number) DO NOTHING;
  items:=items||jsonb_build_array(claimed||jsonb_build_object('input_ordinal',
    (SELECT min(input.ordinal) FROM pg_temp.collection_v3_ingress_input input
      WHERE input.receipt_id=row_receipt.id AND input.error_code IS NULL)));
 END LOOP;
 IF jsonb_array_length(items)>0 THEN
  SELECT jsonb_agg(input.value ORDER BY (input.value->>'input_ordinal')::integer)
    INTO items FROM jsonb_array_elements(items) input(value);
  INSERT INTO private.collection_worker_heartbeats(worker_id,worker_kind,started_at,heartbeat_at,claimed_count)
  VALUES(worker,'decision',clock_timestamp(),clock_timestamp(),jsonb_array_length(items));
  PERFORM set_config('acprod.collection_v3_decision','on',true);
  processed:=private.process_collection_batch_v3(worker,items);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(processed) x(value)
    WHERE coalesce(x.value->>'decision',x.value->>'status','') NOT IN('approved','duplicated','blocked','rejected','pending_review')) THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DECISION_NOT_COMMITTED' USING ERRCODE='40001';
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.collection_v3_ingress_input input
   JOIN public.coletas_producao r ON r.id=input.receipt_id
   WHERE input.error_code IS NULL AND r.decision_committed_at IS NULL AND r.dead_lettered_at IS NULL) THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DECISION_MISSING' USING ERRCODE='40001';
 END IF;
 -- Metadados vêm da decisão e da identidade da peça, não de uma projeção futura.
 WITH enriched AS (
  SELECT input.ordinal,input.client_event_id,input.error_code,input.inserted,
    r.received_at_db,r.decision_committed_at,r.projected_at,r.dead_lettered_at,
    r.id AS receipt_id,
    coalesce(r.resultado,'{}'::jsonb)
    ||CASE WHEN r.dead_lettered_at IS NOT NULL AND r.decision_committed_at IS NULL
      THEN jsonb_build_object('success',false,'decision','dead_lettered','status','dead_lettered',
        'reason_code',coalesce(r.final_reason_code,'COLLECTION_DEAD_LETTERED'),
        'message','A leitura anterior terminou com erro e precisa de revisão.')
      ELSE '{}'::jsonb END
    ||jsonb_strip_nulls(jsonb_build_object(
      'piece',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'piece_uid',p.piece_uid,
        'traceability_code',p.traceability_code,'piece_name',p.piece_name,'current_stage',p.current_stage,
        'route_steps',p.route_steps,'completed_steps',p.completed_steps) END,
      'item',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'piece_uid',p.piece_uid,
        'traceability_code',p.traceability_code,'piece_name',p.piece_name,'current_stage',p.current_stage,
        'route_steps',p.route_steps,'completed_steps',p.completed_steps) END,
      'lot',CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id',l.id,'lot_code',l.lot_code,
        'pcp_import_batch_id',p.pcp_import_batch_id,'general_lot_code',b.general_lot_code) END,
      'piece_id',p.id,'lot_id',l.id,'lot_code',l.lot_code,'pcp_import_batch_id',p.pcp_import_batch_id,
      'general_lot_code',b.general_lot_code,'customer_name',o.customer_name,
      'cell_id',r.cell_id,'cell_name',c.name,'machine_id',r.machine_id,
      'committed_at',r.decision_committed_at,'decision_committed_at',r.decision_committed_at
    )) AS final_result
  FROM pg_temp.collection_v3_ingress_input input
  LEFT JOIN public.coletas_producao r ON r.id=input.receipt_id AND input.error_code IS NULL
  LEFT JOIN public.production_pieces p ON p.id=private.try_collection_uuid_v3(r.resultado->>'piece_id')
  LEFT JOIN public.production_lots l ON l.id=p.lot_id
  LEFT JOIN public.promob_import_batches b ON b.id=p.pcp_import_batch_id
  LEFT JOIN public.production_orders o ON o.id=coalesce(p.production_order_id,l.production_order_id,l.order_id)
  LEFT JOIN public.cells c ON c.id=r.cell_id
 )
 SELECT jsonb_agg(jsonb_build_object(
   'client_event_id',e.client_event_id,'persisted',e.receipt_id IS NOT NULL AND e.error_code IS NULL,
   'duplicate_receipt',e.receipt_id IS NOT NULL AND NOT e.inserted,
   'received_at_db',e.received_at_db,'error_code',e.error_code,
   'decision',e.final_result->>'decision','status',e.final_result->>'status',
   'collection_state',upper(coalesce(e.final_result->>'decision',e.final_result->>'status')),
   'status_sincronizacao',CASE WHEN e.decision_committed_at IS NOT NULL THEN 'sincronizada' ELSE 'erro' END,
   'committed_at',e.decision_committed_at,'decision_committed_at',e.decision_committed_at,
   'queue_status',CASE WHEN e.dead_lettered_at IS NOT NULL THEN 'dead_lettered'
     WHEN e.error_code IS NOT NULL THEN 'rejected' ELSE 'decided' END,
   'projection_status',CASE WHEN e.projected_at IS NOT NULL THEN 'projected' ELSE 'pending' END,
   'projected_at',e.projected_at,'transport_phase','finalized','result',e.final_result
 ) ORDER BY e.ordinal) INTO response FROM enriched e;
 DELETE FROM private.collection_immediate_context_v3
 WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id() AND auth_user_id=actor;
 PERFORM set_config('acprod.collection_v3_wake_decision',previous_wake,true);
 PERFORM set_config('acprod.collection_v3_decision',previous_decision,true);
 PERFORM set_config('lock_timeout',previous_lock_timeout,true);
 RETURN jsonb_build_object('batch_id',p_batch_id,'device_id',p_device_id,
   'received_at_db',ingress->'received_at_db','confirmation_mode','immediate_decision',
   'results',coalesce(response,'[]'::jsonb));
EXCEPTION WHEN OTHERS OR query_canceled THEN
 PERFORM set_config('acprod.collection_v3_wake_decision',previous_wake,true);
 PERFORM set_config('acprod.collection_v3_decision',previous_decision,true);
 PERFORM set_config('lock_timeout',previous_lock_timeout,true);
 RAISE;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb) TO authenticated;

-- Capacidade publicada no contrato de flags já consultado pelos clientes.
UPDATE private.collection_pipeline_flags
SET rollout_scope=coalesce(rollout_scope,'{}'::jsonb)||jsonb_build_object(
 'immediate_rpc','ingest_collection_batch_immediate_v3','immediate_max_events',5),
 updated_at=clock_timestamp()
WHERE flag_name='collection_pipeline_v3_ingress';
NOTIFY pgrst,'reload schema';

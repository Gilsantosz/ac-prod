-- Roll back only this latency release. Derived caches can be recreated; production records are preserved.
BEGIN;
SET LOCAL lock_timeout = '2s';
-- Source: 20260926143100_finalized_receipt_lock_avoidance.sql

DO $guard$ BEGIN
IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))<>'aa4f5381ab5b7514c8d816b48af8f41e' THEN RAISE EXCEPTION 'FINALIZED_RECEIPT_SOURCE_MISMATCH'; END IF;
IF md5(pg_get_functiondef('private.audit_collection_immediate_release_v1()'::regprocedure))<>'7c929162aca03ce0c34c1ab59d45483d' THEN RAISE EXCEPTION 'FINALIZED_RECEIPT_AUDIT_SOURCE_MISMATCH'; END IF;
END; $guard$;
CREATE OR REPLACE FUNCTION public.ingest_collection_batch_immediate_v3(p_batch_id uuid, p_device_id uuid, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pgmq', 'pg_temp'
AS $function$
DECLARE
 actor uuid:=auth.uid();
 worker text:='immediate:backend:'||pg_backend_pid()::text;
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
  VALUES(worker,'decision',clock_timestamp(),clock_timestamp(),jsonb_array_length(items))
  ON CONFLICT(worker_id) DO UPDATE SET
    worker_kind=excluded.worker_kind,
    invocation_id=NULL,
    started_at=excluded.started_at,
    heartbeat_at=excluded.heartbeat_at,
    finished_at=NULL,
    claimed_count=excluded.claimed_count,
    finalized_count=0,
    last_error_code=NULL;
  PERFORM set_config('acprod.collection_v3_decision','on',true);
  processed:=private.process_collection_batch_v3(worker,items);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(processed) x(value)
    WHERE coalesce(x.value->>'decision',x.value->>'status','') NOT IN('approved','duplicated','blocked','rejected','pending_review')) THEN
   RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DECISION_NOT_COMMITTED' USING ERRCODE='40001',
    DETAIL=(SELECT jsonb_build_object('decision_error_codes',jsonb_agg(
      CASE WHEN coalesce(x.value->>'reason_code','') ~ '^[A-Z0-9_]{1,64}$'
        THEN x.value->>'reason_code' ELSE 'UNCLASSIFIED' END))::text
      FROM jsonb_array_elements(processed) x(value)
      WHERE coalesce(x.value->>'decision',x.value->>'status','') NOT IN('approved','duplicated','blocked','rejected','pending_review'));
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
$function$;
CREATE OR REPLACE FUNCTION private.audit_collection_immediate_release_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT public.get_public_collection_runtime_health() AS value
  ),
  objects AS (
    SELECT
      to_regprocedure(
        'public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'
      ) AS immediate_rpc,
      to_regprocedure(
        'private.collection_immediate_context_active_v3()'
      ) AS immediate_context_function,
      to_regclass(
        'private.collection_immediate_context_v3'
      ) AS immediate_context_table
  ),
  definitions AS (
    SELECT coalesce(regexp_replace(
      lower(pg_get_functiondef(objects.immediate_rpc)),
      '[[:space:]]+',
      '',
      'g'
    ), '') AS immediate_rpc
    FROM objects
  ),
  rollout AS (
    SELECT
      coalesce(flag.enabled, false) AS enabled,
      coalesce(flag.rollout_scope, '{}'::jsonb) AS scope
    FROM (SELECT 1) AS seed
    LEFT JOIN private.collection_pipeline_flags flag
      ON flag.flag_name = 'collection_pipeline_v3_ingress'
  ),
  immediate_flags AS (
    SELECT jsonb_build_object(
      'collection_immediate_rpc_exists',
        objects.immediate_rpc IS NOT NULL,
      'collection_immediate_definition_approved',
        objects.immediate_rpc IS NOT NULL
        AND md5(pg_get_functiondef(objects.immediate_rpc))
          = '99a466c7964bef2a52dfe3090c760f72',
      'collection_immediate_rpc_owner',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        ),
      'collection_immediate_rpc_security',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND function_row.prosecdef IS TRUE
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        )
        AND coalesce(
          has_function_privilege('authenticated', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('service_role', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_proc function_row,
               aclexplode(coalesce(
                 function_row.proacl,
                 acldefault('f', function_row.proowner)
               )) privilege
          WHERE function_row.oid = objects.immediate_rpc
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ),
      'collection_immediate_context_private',
        objects.immediate_context_table IS NOT NULL
        AND objects.immediate_context_function IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_class table_row
          WHERE table_row.oid = objects.immediate_context_table
            AND table_row.relrowsecurity IS TRUE
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('authenticated', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('service_role', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'anon', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'service_role', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        ),
      'collection_immediate_batch_limit_5',
        position('collection_immediate_batch_limit_5' IN definitions.immediate_rpc) > 0
        AND position('jsonb_array_length(p_events->''events'')>5' IN definitions.immediate_rpc) > 0,
      'collection_immediate_decision_committed',
        position('private.process_collection_batch_v3' IN definitions.immediate_rpc) > 0
        AND position('collection_immediate_decision_missing' IN definitions.immediate_rpc) > 0
        AND position('decision_committed_at' IN definitions.immediate_rpc) > 0,
      'collection_immediate_projection_async',
        position('private.process_collection_projection_batch_v3' IN definitions.immediate_rpc) = 0,
      'collection_immediate_rollout_all',
        rollout.enabled IS TRUE
        AND rollout.scope ->> 'immediate_rpc' = 'ingest_collection_batch_immediate_v3'
        AND coalesce((rollout.scope ->> 'immediate_max_events')::integer, 0) = 5
        AND coalesce((rollout.scope ->> 'all')::boolean, false) IS TRUE
    ) AS value
    FROM objects, definitions, rollout
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.value ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM immediate_flags, jsonb_each_text(immediate_flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', '20260908154004',
    'release_version', '20260908_acprod_collection_immediate_decision_v3',
    'gate_migration_version', '20260913043419',
    'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1_1',
    'transport', 'immediate_v3',
    'ingress_rpc', 'ingest_collection_batch_immediate_v3',
    'max_events_per_request', 5,
    'projection', 'async_v3_outbox',
    'schema_flags', immediate_flags.value
  )
  FROM base, immediate_flags;
$function$;
UPDATE private.collection_immediate_release_snapshot_v1
SET expected_audit_function_hash='4ae85ace26c60dd653536bc802bf30d0'
WHERE singleton AND expected_audit_function_hash='7c929162aca03ce0c34c1ab59d45483d';
DO $verified$ BEGIN
IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))<>'99a466c7964bef2a52dfe3090c760f72' THEN RAISE EXCEPTION 'FINALIZED_RECEIPT_TARGET_MISMATCH'; END IF;
END; $verified$;
SELECT private.refresh_collection_immediate_release_snapshot_v1();

-- Source: 20260926142300_tracking_scope_bound_plans.sql

CREATE OR REPLACE FUNCTION public.get_general_lot_tracking_base(p_batch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
stage_catalog(stage_code, stage_label, stage_order, default_minutes_per_piece) as (
  values
    ('cut'::text, 'Corte'::text, 1, 2.0::numeric),
    ('edge'::text, 'Borda'::text, 2, 3.0::numeric),
    ('cnc'::text, 'Usinagem'::text, 3, 5.0::numeric),
    ('joinery'::text, 'Marcenaria'::text, 4, 20.0::numeric)
),
recent_readings as (
  select
    case
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cut', 'corte') then 'cut'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('edge', 'bordo', 'borda') then 'edge'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cnc', 'usinagem') then 'cnc'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('joinery', 'marcenaria') then 'joinery'
      else null
    end as stage_code,
    (r.created_at at time zone 'America/Sao_Paulo')::date as production_day,
    r.created_at
  from public.production_stage_readings r
  where r.status = 'approved'
    and r.created_at >= now() - interval '90 days'
),
daily_stage_rates as (
  select
    rr.stage_code,
    rr.production_day,
    count(*)::integer as approved_readings,
    extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0 as active_minutes,
    case
      when count(*) >= 3
       and max(rr.created_at) - min(rr.created_at) >= interval '5 minutes'
      then (extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0)
           / greatest(count(*) - 1, 1)
      else null
    end as minutes_per_piece
  from recent_readings rr
  where rr.stage_code is not null
  group by rr.stage_code, rr.production_day
),
learned_metrics as (
  select
    d.stage_code,
    count(*) filter (where d.minutes_per_piece is not null)::integer as observed_days,
    coalesce(sum(d.approved_readings), 0)::integer as sample_count,
    percentile_cont(0.5) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as median_minutes_per_piece,
    percentile_cont(0.8) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as p80_minutes_per_piece
  from daily_stage_rates d
  group by d.stage_code
),
stage_models as (
  select
    s.stage_code,
    s.stage_label,
    s.stage_order,
    s.default_minutes_per_piece,
    coalesce(l.observed_days, 0) as observed_days,
    coalesce(l.sample_count, 0) as sample_count,
    round(coalesce(l.median_minutes_per_piece, s.default_minutes_per_piece)::numeric, 2) as minutes_per_piece,
    round(coalesce(l.p80_minutes_per_piece, s.default_minutes_per_piece * 1.25)::numeric, 2) as p80_minutes_per_piece,
    case
      when coalesce(l.observed_days, 0) >= 5 and coalesce(l.sample_count, 0) >= 500 then 'high'
      when coalesce(l.observed_days, 0) >= 1 and coalesce(l.sample_count, 0) >= 100 then 'medium'
      else 'low'
    end as confidence,
    case when coalesce(l.observed_days, 0) > 0 then 'learned' else 'baseline' end as model_source
  from stage_catalog s
  left join learned_metrics l on l.stage_code = s.stage_code
),
selected_batches as (
  select b.*
  from public.promob_import_batches b
  where (p_batch_id is not null and b.id = p_batch_id)
     or (
       p_batch_id is null
       and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'error', 'failed')
       and exists (
         select 1 from public.production_lots pl where pl.pcp_import_batch_id = b.id
       )
     )
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
),
selected_lots as (
  select l.*
  from public.production_lots l
  join selected_batches b on b.id = l.pcp_import_batch_id
  where lower(coalesce(l.status, '')) not in ('cancelled', 'canceled')
),
cached_piece_groups as materialized (
  select * from public.get_authorized_tracking_group_snapshots(array(select id from selected_batches))
),
selected_piece_rows as (
  select p.*
  from public.production_pieces p
  join selected_batches b on b.id = p.pcp_import_batch_id
  where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')
    and not exists(select 1 from cached_piece_groups cache where cache.pcp_import_batch_id=p.pcp_import_batch_id)
),
-- Equal route/state groups have equal stage results. Retain their multiplicity
-- instead of expanding every individual piece into four intermediate rows.
selected_pieces as materialized (
  select min(p.id::text)::uuid as id, p.pcp_import_batch_id, p.lot_id,
    p.requires_cut, p.requires_edge, p.requires_cnc, p.requires_joinery,
    p.manual_joinery, p.route_steps, p.completed_steps, p.is_blocked,
    p.rework_status, p.replacement_status, count(*)::bigint as piece_weight
  from selected_piece_rows p
  group by p.pcp_import_batch_id, p.lot_id, p.requires_cut, p.requires_edge,
    p.requires_cnc, p.requires_joinery, p.manual_joinery, p.route_steps,
    p.completed_steps, p.is_blocked, p.rework_status, p.replacement_status
  union all
  select grouped.* from cached_piece_groups cache
  cross join lateral jsonb_to_recordset(cache.piece_groups) as grouped(
    id uuid,pcp_import_batch_id uuid,lot_id uuid,
    requires_cut boolean,requires_edge boolean,requires_cnc boolean,requires_joinery boolean,
    manual_joinery boolean,route_steps text[],completed_steps text[],is_blocked boolean,
    rework_status text,replacement_status text,piece_weight bigint
  )
),
piece_stage as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    p.id as piece_id,
    p.piece_weight,
    s.stage_code,
    s.stage_label,
    s.stage_order,
    case s.stage_code
      when 'cut' then coalesce(p.requires_cut, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then coalesce(p.requires_edge, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then coalesce(p.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then coalesce(p.requires_joinery, false) or coalesce(p.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_required,
    case s.stage_code
      when 'cut' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_completed
  from selected_pieces p
  cross join stage_catalog s
),
piece_completion as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.piece_id,
    count(*) filter (where ps.is_required)::integer as required_operations,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_operations,
    (
      count(*) filter (where ps.is_required) > 0
      and count(*) filter (where ps.is_required) = count(*) filter (where ps.is_required and ps.is_completed)
    ) as ready_for_separation
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.piece_id
),
lot_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
lot_stage_forecast as (
  select
    lr.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(lr.required_pieces - lr.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when lr.required_pieces > 0
      then round((100.0 * lr.completed_pieces / lr.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from lot_stage_rollup lr
  join stage_models m on m.stage_code = lr.stage_code
),
lot_stage_json as (
  select
    lf.pcp_import_batch_id,
    lf.lot_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', lf.stage_code,
        'stage_label', lf.stage_label,
        'stage_order', lf.stage_order,
        'required_pieces', lf.required_pieces,
        'completed_pieces', lf.completed_pieces,
        'remaining_pieces', lf.remaining_pieces,
        'progress_percent', lf.progress_percent,
        'estimated_remaining_minutes', lf.estimated_remaining_minutes,
        'p80_remaining_minutes', lf.p80_remaining_minutes,
        'confidence', lf.confidence,
        'model_source', lf.model_source
      ) order by lf.stage_order
    ) as stages,
    coalesce(sum(lf.estimated_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(lf.p80_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(lf.stage_label order by lf.estimated_remaining_minutes desc)
        filter (where lf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case lf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where lf.required_pieces > 0 and lf.remaining_pieces > 0) as confidence_rank
  from lot_stage_forecast lf
  group by lf.pcp_import_batch_id, lf.lot_id
),
lot_piece_rollup as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id, p.lot_id
),
lot_results as (
  select
    l.pcp_import_batch_id,
    l.id as lot_id,
    l.lot_code,
    l.customer_name,
    l.status,
    coalesce(l.current_stage, l.current_step, 'imported') as current_stage,
    l.planned_end,
    coalesce(pr.total_pieces, 0) as total_pieces,
    coalesce(pr.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(pr.total_operations, 0) as total_operations,
    coalesce(pr.completed_operations, 0) as completed_operations,
    coalesce(pr.blocked_pieces, 0) as blocked_pieces,
    coalesce(pr.rework_pieces, 0) as rework_pieces,
    coalesce(pr.replacement_pieces, 0) as replacement_pieces,
    case when coalesce(pr.total_operations, 0) > 0
      then round((100.0 * pr.completed_operations / pr.total_operations)::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(sj.stages, '[]'::jsonb) as stages,
    coalesce(sj.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(sj.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(sj.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(sj.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(pr.blocked_pieces, 0) + coalesce(pr.rework_pieces, 0) + coalesce(pr.replacement_pieces, 0) > 0 then 'attention'
      when l.planned_end is not null and l.planned_end < now() and coalesce(pr.ready_for_separation_pieces, 0) < coalesce(pr.total_pieces, 0) then 'delayed'
      when coalesce(pr.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status
  from selected_lots l
  left join lot_piece_rollup pr on pr.lot_id = l.id
  left join lot_stage_json sj on sj.lot_id = l.id
),
batch_piece_rollup as (
  select
    p.pcp_import_batch_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id
),
batch_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage_forecast as (
  select
    br.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(br.required_pieces - br.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when br.required_pieces > 0
      then round((100.0 * br.completed_pieces / br.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from batch_stage_rollup br
  join stage_models m on m.stage_code = br.stage_code
),
batch_stage_json as (
  select
    bf.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', bf.stage_code,
        'stage_label', bf.stage_label,
        'stage_order', bf.stage_order,
        'required_pieces', bf.required_pieces,
        'completed_pieces', bf.completed_pieces,
        'remaining_pieces', bf.remaining_pieces,
        'progress_percent', bf.progress_percent,
        'estimated_remaining_minutes', bf.estimated_remaining_minutes,
        'p80_remaining_minutes', bf.p80_remaining_minutes,
        'minutes_per_piece', bf.minutes_per_piece,
        'confidence', bf.confidence,
        'model_source', bf.model_source
      ) order by bf.stage_order
    ) as stages,
    coalesce(sum(bf.estimated_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(bf.p80_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(bf.stage_label order by bf.estimated_remaining_minutes desc)
        filter (where bf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case bf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where bf.required_pieces > 0 and bf.remaining_pieces > 0) as confidence_rank
  from batch_stage_forecast bf
  group by bf.pcp_import_batch_id
),
client_lot_json as (
  select
    lr.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'lot_id', lr.lot_id,
        'lot_code', lr.lot_code,
        'customer_name', lr.customer_name,
        'status', lr.status,
        'current_stage', lr.current_stage,
        'planned_end', lr.planned_end,
        'total_pieces', lr.total_pieces,
        'ready_for_separation_pieces', lr.ready_for_separation_pieces,
        'total_operations', lr.total_operations,
        'completed_operations', lr.completed_operations,
        'progress_percent', lr.progress_percent,
        'blocked_pieces', lr.blocked_pieces,
        'rework_pieces', lr.rework_pieces,
        'replacement_pieces', lr.replacement_pieces,
        'integrity_percent', case when lr.total_pieces > 0 then round((100.0 * greatest(lr.total_pieces - lr.blocked_pieces - lr.rework_pieces - lr.replacement_pieces, 0) / lr.total_pieces)::numeric, 2) else 100.0 end,
        'stages', lr.stages,
        'bottleneck_stage', lr.bottleneck_stage,
        'estimated_remaining_minutes', lr.estimated_remaining_minutes,
        'p80_remaining_minutes', lr.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(lr.estimated_remaining_minutes)::integer),
        'forecast_confidence', lr.forecast_confidence,
        'forecast_status', lr.forecast_status,
        'ready_for_separation', lr.total_pieces > 0 and lr.ready_for_separation_pieces = lr.total_pieces
      ) order by lr.customer_name nulls last, lr.lot_code
    ) as client_lots
  from lot_results lr
  group by lr.pcp_import_batch_id
),
batch_results as (
  select
    b.id as batch_id,
    b.general_lot_code,
    b.file_name,
    b.status,
    b.created_at,
    b.imported_at,
    coalesce(bp.total_pieces, b.total_parts, 0) as total_pieces,
    coalesce(bp.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(bp.total_operations, b.total_operations, 0) as total_operations,
    coalesce(bp.completed_operations, b.completed_operations, 0) as completed_operations,
    coalesce(bp.blocked_pieces, 0) as blocked_pieces,
    coalesce(bp.rework_pieces, 0) as rework_pieces,
    coalesce(bp.replacement_pieces, 0) as replacement_pieces,
    coalesce((select count(*) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as client_lots_count,
    coalesce((select count(distinct nullif(trim(l.customer_name), '')) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as customers_count,
    case when coalesce(bp.total_operations, b.total_operations, 0) > 0
      then round((100.0 * coalesce(bp.completed_operations, b.completed_operations, 0) / coalesce(bp.total_operations, b.total_operations, 0))::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(bs.stages, '[]'::jsonb) as stages,
    coalesce(bs.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(bs.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(bs.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(bs.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(bp.blocked_pieces, 0) + coalesce(bp.rework_pieces, 0) + coalesce(bp.replacement_pieces, 0) > 0 then 'attention'
      when coalesce(bp.completed_operations, b.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status,
    case when p_batch_id is not null then coalesce(cl.client_lots, '[]'::jsonb) else '[]'::jsonb end as client_lots
  from selected_batches b
  left join batch_piece_rollup bp on bp.pcp_import_batch_id = b.id
  left join batch_stage_json bs on bs.pcp_import_batch_id = b.id
  left join client_lot_json cl on cl.pcp_import_batch_id = b.id
)
select jsonb_build_object(
  'generated_at', now(),
  'prediction_target', 'ready_for_separation',
  'model_window_days', 90,
  'stage_models', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', m.stage_code,
        'stage_label', m.stage_label,
        'stage_order', m.stage_order,
        'sample_count', m.sample_count,
        'observed_days', m.observed_days,
        'minutes_per_piece', m.minutes_per_piece,
        'p80_minutes_per_piece', m.p80_minutes_per_piece,
        'confidence', m.confidence,
        'model_source', m.model_source
      ) order by m.stage_order
    ) from stage_models m
  ), '[]'::jsonb),
  'general_lots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'batch_id', br.batch_id,
        'general_lot_code', br.general_lot_code,
        'file_name', br.file_name,
        'status', br.status,
        'created_at', br.created_at,
        'imported_at', br.imported_at,
        'total_pieces', br.total_pieces,
        'ready_for_separation_pieces', br.ready_for_separation_pieces,
        'total_operations', br.total_operations,
        'completed_operations', br.completed_operations,
        'progress_percent', br.progress_percent,
        'client_lots_count', br.client_lots_count,
        'customers_count', br.customers_count,
        'blocked_pieces', br.blocked_pieces,
        'rework_pieces', br.rework_pieces,
        'replacement_pieces', br.replacement_pieces,
        'integrity_percent', case when br.total_pieces > 0 then round((100.0 * greatest(br.total_pieces - br.blocked_pieces - br.rework_pieces - br.replacement_pieces, 0) / br.total_pieces)::numeric, 2) else 100.0 end,
        'stages', br.stages,
        'bottleneck_stage', br.bottleneck_stage,
        'estimated_remaining_minutes', br.estimated_remaining_minutes,
        'p80_remaining_minutes', br.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(br.estimated_remaining_minutes)::integer),
        'forecast_confidence', br.forecast_confidence,
        'forecast_status', br.forecast_status,
        'ready_for_separation', br.total_pieces > 0 and br.ready_for_separation_pieces = br.total_pieces,
        'client_lots', br.client_lots
      ) order by br.created_at desc
    ) from batch_results br
  ), '[]'::jsonb)
);
$function$
;

-- Source: 20260926141900_authorized_tracking_group_snapshots.sql

CREATE OR REPLACE FUNCTION public.get_general_lot_tracking_base(p_batch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
stage_catalog(stage_code, stage_label, stage_order, default_minutes_per_piece) as (
  values
    ('cut'::text, 'Corte'::text, 1, 2.0::numeric),
    ('edge'::text, 'Borda'::text, 2, 3.0::numeric),
    ('cnc'::text, 'Usinagem'::text, 3, 5.0::numeric),
    ('joinery'::text, 'Marcenaria'::text, 4, 20.0::numeric)
),
recent_readings as (
  select
    case
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cut', 'corte') then 'cut'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('edge', 'bordo', 'borda') then 'edge'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cnc', 'usinagem') then 'cnc'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('joinery', 'marcenaria') then 'joinery'
      else null
    end as stage_code,
    (r.created_at at time zone 'America/Sao_Paulo')::date as production_day,
    r.created_at
  from public.production_stage_readings r
  where r.status = 'approved'
    and r.created_at >= now() - interval '90 days'
),
daily_stage_rates as (
  select
    rr.stage_code,
    rr.production_day,
    count(*)::integer as approved_readings,
    extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0 as active_minutes,
    case
      when count(*) >= 3
       and max(rr.created_at) - min(rr.created_at) >= interval '5 minutes'
      then (extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0)
           / greatest(count(*) - 1, 1)
      else null
    end as minutes_per_piece
  from recent_readings rr
  where rr.stage_code is not null
  group by rr.stage_code, rr.production_day
),
learned_metrics as (
  select
    d.stage_code,
    count(*) filter (where d.minutes_per_piece is not null)::integer as observed_days,
    coalesce(sum(d.approved_readings), 0)::integer as sample_count,
    percentile_cont(0.5) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as median_minutes_per_piece,
    percentile_cont(0.8) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as p80_minutes_per_piece
  from daily_stage_rates d
  group by d.stage_code
),
stage_models as (
  select
    s.stage_code,
    s.stage_label,
    s.stage_order,
    s.default_minutes_per_piece,
    coalesce(l.observed_days, 0) as observed_days,
    coalesce(l.sample_count, 0) as sample_count,
    round(coalesce(l.median_minutes_per_piece, s.default_minutes_per_piece)::numeric, 2) as minutes_per_piece,
    round(coalesce(l.p80_minutes_per_piece, s.default_minutes_per_piece * 1.25)::numeric, 2) as p80_minutes_per_piece,
    case
      when coalesce(l.observed_days, 0) >= 5 and coalesce(l.sample_count, 0) >= 500 then 'high'
      when coalesce(l.observed_days, 0) >= 1 and coalesce(l.sample_count, 0) >= 100 then 'medium'
      else 'low'
    end as confidence,
    case when coalesce(l.observed_days, 0) > 0 then 'learned' else 'baseline' end as model_source
  from stage_catalog s
  left join learned_metrics l on l.stage_code = s.stage_code
),
selected_batches as (
  select b.*
  from public.promob_import_batches b
  where (p_batch_id is not null and b.id = p_batch_id)
     or (
       p_batch_id is null
       and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'error', 'failed')
       and exists (
         select 1 from public.production_lots pl where pl.pcp_import_batch_id = b.id
       )
     )
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
),
selected_lots as (
  select l.*
  from public.production_lots l
  join selected_batches b on b.id = l.pcp_import_batch_id
  where lower(coalesce(l.status, '')) not in ('cancelled', 'canceled')
),
selected_piece_rows as (
  select p.*
  from public.production_pieces p
  join selected_batches b on b.id = p.pcp_import_batch_id
  where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')
),
-- Equal route/state groups have equal stage results. Retain their multiplicity
-- instead of expanding every individual piece into four intermediate rows.
selected_pieces as materialized (
  select min(p.id::text)::uuid as id, p.pcp_import_batch_id, p.lot_id,
    p.requires_cut, p.requires_edge, p.requires_cnc, p.requires_joinery,
    p.manual_joinery, p.route_steps, p.completed_steps, p.is_blocked,
    p.rework_status, p.replacement_status, count(*)::bigint as piece_weight
  from selected_piece_rows p
  group by p.pcp_import_batch_id, p.lot_id, p.requires_cut, p.requires_edge,
    p.requires_cnc, p.requires_joinery, p.manual_joinery, p.route_steps,
    p.completed_steps, p.is_blocked, p.rework_status, p.replacement_status
),
piece_stage as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    p.id as piece_id,
    p.piece_weight,
    s.stage_code,
    s.stage_label,
    s.stage_order,
    case s.stage_code
      when 'cut' then coalesce(p.requires_cut, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then coalesce(p.requires_edge, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then coalesce(p.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then coalesce(p.requires_joinery, false) or coalesce(p.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_required,
    case s.stage_code
      when 'cut' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_completed
  from selected_pieces p
  cross join stage_catalog s
),
piece_completion as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.piece_id,
    count(*) filter (where ps.is_required)::integer as required_operations,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_operations,
    (
      count(*) filter (where ps.is_required) > 0
      and count(*) filter (where ps.is_required) = count(*) filter (where ps.is_required and ps.is_completed)
    ) as ready_for_separation
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.piece_id
),
lot_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
lot_stage_forecast as (
  select
    lr.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(lr.required_pieces - lr.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when lr.required_pieces > 0
      then round((100.0 * lr.completed_pieces / lr.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from lot_stage_rollup lr
  join stage_models m on m.stage_code = lr.stage_code
),
lot_stage_json as (
  select
    lf.pcp_import_batch_id,
    lf.lot_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', lf.stage_code,
        'stage_label', lf.stage_label,
        'stage_order', lf.stage_order,
        'required_pieces', lf.required_pieces,
        'completed_pieces', lf.completed_pieces,
        'remaining_pieces', lf.remaining_pieces,
        'progress_percent', lf.progress_percent,
        'estimated_remaining_minutes', lf.estimated_remaining_minutes,
        'p80_remaining_minutes', lf.p80_remaining_minutes,
        'confidence', lf.confidence,
        'model_source', lf.model_source
      ) order by lf.stage_order
    ) as stages,
    coalesce(sum(lf.estimated_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(lf.p80_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(lf.stage_label order by lf.estimated_remaining_minutes desc)
        filter (where lf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case lf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where lf.required_pieces > 0 and lf.remaining_pieces > 0) as confidence_rank
  from lot_stage_forecast lf
  group by lf.pcp_import_batch_id, lf.lot_id
),
lot_piece_rollup as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id, p.lot_id
),
lot_results as (
  select
    l.pcp_import_batch_id,
    l.id as lot_id,
    l.lot_code,
    l.customer_name,
    l.status,
    coalesce(l.current_stage, l.current_step, 'imported') as current_stage,
    l.planned_end,
    coalesce(pr.total_pieces, 0) as total_pieces,
    coalesce(pr.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(pr.total_operations, 0) as total_operations,
    coalesce(pr.completed_operations, 0) as completed_operations,
    coalesce(pr.blocked_pieces, 0) as blocked_pieces,
    coalesce(pr.rework_pieces, 0) as rework_pieces,
    coalesce(pr.replacement_pieces, 0) as replacement_pieces,
    case when coalesce(pr.total_operations, 0) > 0
      then round((100.0 * pr.completed_operations / pr.total_operations)::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(sj.stages, '[]'::jsonb) as stages,
    coalesce(sj.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(sj.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(sj.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(sj.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(pr.blocked_pieces, 0) + coalesce(pr.rework_pieces, 0) + coalesce(pr.replacement_pieces, 0) > 0 then 'attention'
      when l.planned_end is not null and l.planned_end < now() and coalesce(pr.ready_for_separation_pieces, 0) < coalesce(pr.total_pieces, 0) then 'delayed'
      when coalesce(pr.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status
  from selected_lots l
  left join lot_piece_rollup pr on pr.lot_id = l.id
  left join lot_stage_json sj on sj.lot_id = l.id
),
batch_piece_rollup as (
  select
    p.pcp_import_batch_id,
    sum(p.piece_weight)::integer as total_pieces,
    coalesce(sum(p.piece_weight) filter (where pc.ready_for_separation),0)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations * p.piece_weight), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations * p.piece_weight), 0)::integer as completed_operations,
    coalesce(sum(p.piece_weight) filter (where p.is_blocked),0)::integer as blocked_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as rework_pieces,
    coalesce(sum(p.piece_weight) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved')),0)::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id
),
batch_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required),0)::integer as required_pieces,
    coalesce(sum(ps.piece_weight) filter (where ps.is_required and ps.is_completed),0)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage_forecast as (
  select
    br.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(br.required_pieces - br.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when br.required_pieces > 0
      then round((100.0 * br.completed_pieces / br.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from batch_stage_rollup br
  join stage_models m on m.stage_code = br.stage_code
),
batch_stage_json as (
  select
    bf.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', bf.stage_code,
        'stage_label', bf.stage_label,
        'stage_order', bf.stage_order,
        'required_pieces', bf.required_pieces,
        'completed_pieces', bf.completed_pieces,
        'remaining_pieces', bf.remaining_pieces,
        'progress_percent', bf.progress_percent,
        'estimated_remaining_minutes', bf.estimated_remaining_minutes,
        'p80_remaining_minutes', bf.p80_remaining_minutes,
        'minutes_per_piece', bf.minutes_per_piece,
        'confidence', bf.confidence,
        'model_source', bf.model_source
      ) order by bf.stage_order
    ) as stages,
    coalesce(sum(bf.estimated_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(bf.p80_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(bf.stage_label order by bf.estimated_remaining_minutes desc)
        filter (where bf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case bf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where bf.required_pieces > 0 and bf.remaining_pieces > 0) as confidence_rank
  from batch_stage_forecast bf
  group by bf.pcp_import_batch_id
),
client_lot_json as (
  select
    lr.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'lot_id', lr.lot_id,
        'lot_code', lr.lot_code,
        'customer_name', lr.customer_name,
        'status', lr.status,
        'current_stage', lr.current_stage,
        'planned_end', lr.planned_end,
        'total_pieces', lr.total_pieces,
        'ready_for_separation_pieces', lr.ready_for_separation_pieces,
        'total_operations', lr.total_operations,
        'completed_operations', lr.completed_operations,
        'progress_percent', lr.progress_percent,
        'blocked_pieces', lr.blocked_pieces,
        'rework_pieces', lr.rework_pieces,
        'replacement_pieces', lr.replacement_pieces,
        'integrity_percent', case when lr.total_pieces > 0 then round((100.0 * greatest(lr.total_pieces - lr.blocked_pieces - lr.rework_pieces - lr.replacement_pieces, 0) / lr.total_pieces)::numeric, 2) else 100.0 end,
        'stages', lr.stages,
        'bottleneck_stage', lr.bottleneck_stage,
        'estimated_remaining_minutes', lr.estimated_remaining_minutes,
        'p80_remaining_minutes', lr.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(lr.estimated_remaining_minutes)::integer),
        'forecast_confidence', lr.forecast_confidence,
        'forecast_status', lr.forecast_status,
        'ready_for_separation', lr.total_pieces > 0 and lr.ready_for_separation_pieces = lr.total_pieces
      ) order by lr.customer_name nulls last, lr.lot_code
    ) as client_lots
  from lot_results lr
  group by lr.pcp_import_batch_id
),
batch_results as (
  select
    b.id as batch_id,
    b.general_lot_code,
    b.file_name,
    b.status,
    b.created_at,
    b.imported_at,
    coalesce(bp.total_pieces, b.total_parts, 0) as total_pieces,
    coalesce(bp.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(bp.total_operations, b.total_operations, 0) as total_operations,
    coalesce(bp.completed_operations, b.completed_operations, 0) as completed_operations,
    coalesce(bp.blocked_pieces, 0) as blocked_pieces,
    coalesce(bp.rework_pieces, 0) as rework_pieces,
    coalesce(bp.replacement_pieces, 0) as replacement_pieces,
    coalesce((select count(*) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as client_lots_count,
    coalesce((select count(distinct nullif(trim(l.customer_name), '')) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as customers_count,
    case when coalesce(bp.total_operations, b.total_operations, 0) > 0
      then round((100.0 * coalesce(bp.completed_operations, b.completed_operations, 0) / coalesce(bp.total_operations, b.total_operations, 0))::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(bs.stages, '[]'::jsonb) as stages,
    coalesce(bs.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(bs.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(bs.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(bs.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(bp.blocked_pieces, 0) + coalesce(bp.rework_pieces, 0) + coalesce(bp.replacement_pieces, 0) > 0 then 'attention'
      when coalesce(bp.completed_operations, b.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status,
    case when p_batch_id is not null then coalesce(cl.client_lots, '[]'::jsonb) else '[]'::jsonb end as client_lots
  from selected_batches b
  left join batch_piece_rollup bp on bp.pcp_import_batch_id = b.id
  left join batch_stage_json bs on bs.pcp_import_batch_id = b.id
  left join client_lot_json cl on cl.pcp_import_batch_id = b.id
)
select jsonb_build_object(
  'generated_at', now(),
  'prediction_target', 'ready_for_separation',
  'model_window_days', 90,
  'stage_models', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', m.stage_code,
        'stage_label', m.stage_label,
        'stage_order', m.stage_order,
        'sample_count', m.sample_count,
        'observed_days', m.observed_days,
        'minutes_per_piece', m.minutes_per_piece,
        'p80_minutes_per_piece', m.p80_minutes_per_piece,
        'confidence', m.confidence,
        'model_source', m.model_source
      ) order by m.stage_order
    ) from stage_models m
  ), '[]'::jsonb),
  'general_lots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'batch_id', br.batch_id,
        'general_lot_code', br.general_lot_code,
        'file_name', br.file_name,
        'status', br.status,
        'created_at', br.created_at,
        'imported_at', br.imported_at,
        'total_pieces', br.total_pieces,
        'ready_for_separation_pieces', br.ready_for_separation_pieces,
        'total_operations', br.total_operations,
        'completed_operations', br.completed_operations,
        'progress_percent', br.progress_percent,
        'client_lots_count', br.client_lots_count,
        'customers_count', br.customers_count,
        'blocked_pieces', br.blocked_pieces,
        'rework_pieces', br.rework_pieces,
        'replacement_pieces', br.replacement_pieces,
        'integrity_percent', case when br.total_pieces > 0 then round((100.0 * greatest(br.total_pieces - br.blocked_pieces - br.rework_pieces - br.replacement_pieces, 0) / br.total_pieces)::numeric, 2) else 100.0 end,
        'stages', br.stages,
        'bottleneck_stage', br.bottleneck_stage,
        'estimated_remaining_minutes', br.estimated_remaining_minutes,
        'p80_remaining_minutes', br.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(br.estimated_remaining_minutes)::integer),
        'forecast_confidence', br.forecast_confidence,
        'forecast_status', br.forecast_status,
        'ready_for_separation', br.total_pieces > 0 and br.ready_for_separation_pieces = br.total_pieces,
        'client_lots', br.client_lots
      ) order by br.created_at desc
    ) from batch_results br
  ), '[]'::jsonb)
);
$function$
;
CREATE OR REPLACE FUNCTION private.refresh_shared_collection_batch_snapshot(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE revision timestamptz; started timestamptz:=clock_timestamp();
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT collection_snapshot_updated_at INTO STRICT revision FROM public.promob_import_batches WHERE id=p_batch_id;
  INSERT INTO private.collection_shared_batch_stage_snapshots AS cached (
    pcp_import_batch_id,step_code,expected_count,approved_count,pending_count,
    rejected_count,rework_count,replacement_count,state_version,source_batch_updated_at,snapshot_at
  )
  SELECT p_batch_id,metrics.step_code,metrics.expected_count,metrics.approved_count,metrics.pending_count,
    metrics.rejected_count,metrics.rework_count,metrics.replacement_count,
    coalesce((SELECT max(old.state_version) FROM private.collection_dashboard_batch_snapshots old
      WHERE old.pcp_import_batch_id=p_batch_id AND old.step_code=metrics.step_code),0)+1,
    revision,started FROM private.collection_batch_stage_metrics(p_batch_id) metrics
  ON CONFLICT(pcp_import_batch_id,step_code) DO UPDATE SET
    expected_count=excluded.expected_count,approved_count=excluded.approved_count,pending_count=excluded.pending_count,
    rejected_count=excluded.rejected_count,rework_count=excluded.rework_count,replacement_count=excluded.replacement_count,
    state_version=greatest(cached.state_version+1,excluded.state_version),
    source_batch_updated_at=excluded.source_batch_updated_at,snapshot_at=excluded.snapshot_at,updated_at=clock_timestamp()
  WHERE cached.snapshot_at<=excluded.snapshot_at
    AND coalesce(cached.source_batch_updated_at,'-infinity'::timestamptz)<=coalesce(excluded.source_batch_updated_at,'-infinity'::timestamptz);
END;
$function$
;
DROP FUNCTION public.get_authorized_tracking_group_snapshots(uuid[]);
DROP FUNCTION private.refresh_tracking_group_snapshot(uuid);
DROP TABLE private.collection_tracking_group_snapshots;

-- Source: 20260926140900_history_bound_custom_plans.sql

CREATE OR REPLACE FUNCTION public.get_collection_history_impl(p_cell_id uuid DEFAULT NULL::uuid, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_lot_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cell_name text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, event_id uuid, client_event_id text, created_at timestamp with time zone, server_created_at timestamp with time zone, processed_at timestamp with time zone, date date, hour text, traceability_code text, raw_value text, piece_id uuid, piece_name text, pcp_import_batch_id uuid, pcp_batch_name text, lot_id uuid, lot_code text, order_number text, client_name text, current_stage_name text, operation_name text, operator_id uuid, operator_name text, registration text, cell_name text, machine_id uuid, machine_name text, station_name text, shift text, reader_type text, event_status text, result_status text, sync_status text, message text, route_steps text[], completed_steps text[], result_payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH history AS (
    SELECT
      e.id,
      e.id AS event_id,
      e.client_event_id,
      COALESCE(e.created_at_client, e.created_at) AS created_at,
      e.created_at AS server_created_at,
      e.processed_at,
      e.date,
      e.hour,
      COALESCE(NULLIF(e.piece_code, ''), p.traceability_code, p.piece_uid,
               NULLIF(e.normalized_value, ''), e.raw_value) AS traceability_code,
      e.raw_value,
      COALESCE(e.piece_id, sr.piece_id) AS piece_id,
      p.piece_name,
      COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id) AS pcp_import_batch_id,
      COALESCE(batch.general_lot_code, batch.file_name) AS pcp_batch_name,
      COALESCE(e.lot_id, sr.lot_id, p.lot_id) AS lot_id,
      COALESCE(NULLIF(e.lot_code, ''), NULLIF(sr.lot_code, ''),
               NULLIF(p.lot_code, ''), l.lot_code) AS lot_code,
      COALESCE(NULLIF(e.order_number, ''), NULLIF(sr.order_number, ''),
               NULLIF(p.order_number, ''), po.order_number, po.order_code) AS order_number,
      COALESCE(NULLIF(e.customer_name, ''), NULLIF(sr.customer_name, ''),
               NULLIF(p.customer_name, ''), po.customer_name) AS client_name,
      COALESCE(NULLIF(e.operation_name, ''),
               NULLIF(e.result_payload #>> '{route,step_name}', ''),
               NULLIF(e.result_payload #>> '{result,route,step_name}', ''),
               NULLIF(sr.step_name, ''), NULLIF(sr.operation_name, ''),
               NULLIF(e.cell_name, ''), NULLIF(sr.cell_name, '')) AS current_stage_name,
      COALESCE(NULLIF(sr.operation_name, ''), NULLIF(e.operation_name, ''), sr.step_name) AS operation_name,
      e.operator_id,
      COALESCE(e.operator_name, op.name, sr.operator) AS operator_name,
      COALESCE(e.registration, op.registration) AS registration,
      COALESCE(e.cell_name, sr.cell_name) AS cell_name,
      COALESCE(e.machine_id, sr.machine_id) AS machine_id,
      COALESCE(e.machine_name, sr.machine_name) AS machine_name,
      COALESCE(e.station_name, sr.station_name) AS station_name,
      COALESCE(e.shift, sr.shift) AS shift,
      e.reader_type,
      CASE
        -- Uma reposição é um evento próprio, nunca a reclassificação retroativa
        -- das leituras da peça original que foi substituída.
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) = 'approved'
          AND COALESCE(NULLIF(e.result_payload->>'entry_type', ''),
          NULLIF(e.result_payload->>'source', ''),
          NULLIF(e.result_payload #>> '{result,entry_type}', '')) IN ('baixa_reposicao', 'replacement_approval')
          THEN 'approved_via_replacement'
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) IN ('wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        ELSE COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status)
      END AS event_status,
      e.result_status,
      e.status AS sync_status,
      COALESCE(e.result_payload->>'message', e.error_message) AS message,
      COALESCE(p.route_steps, '{}'::text[]) AS route_steps,
      COALESCE(p.completed_steps, '{}'::text[]) AS completed_steps,
      e.result_payload
    FROM public.production_collection_events e
    LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
    LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
    LEFT JOIN public.promob_import_batches batch
      ON batch.id = COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id)
    LEFT JOIN public.production_lots l
      ON l.id = COALESCE(e.lot_id, sr.lot_id, p.lot_id)
    LEFT JOIN public.production_orders po
      ON po.id = COALESCE(e.production_order_id, p.production_order_id,
                          l.production_order_id, l.order_id)
    LEFT JOIN public.operators op ON op.id = e.operator_id
    WHERE (p_cell_name IS NULL OR e.cell_name IS NULL OR lower(btrim(e.cell_name)) = lower(btrim(p_cell_name)))
      AND (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''))) = lower(trim(p_cell_name)))
      AND (p_cell_id IS NULL OR EXISTS (
        SELECT 1 FROM public.cells c
        WHERE c.id = p_cell_id
          AND lower(trim(c.name)) = lower(trim(COALESCE(e.cell_name, sr.cell_name, '')))
      ))
      AND (p_workstation_id IS NULL OR COALESCE(e.machine_id, sr.machine_id) = p_workstation_id)
      AND (p_operator_id IS NULL OR e.operator_id = p_operator_id)
      AND (p_shift IS NULL OR COALESCE(e.shift, sr.shift) = p_shift)
      AND (p_lot_id IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = p_lot_id)
      AND (p_date_from IS NULL OR COALESCE(e.created_at_client, e.created_at) >= p_date_from)
      AND (p_date_to IS NULL OR COALESCE(e.created_at_client, e.created_at) <= p_date_to)
  )
  SELECT * FROM history h
  WHERE
    -- Filtro: 'approved' inclui tanto 'approved' quanto 'approved_via_replacement'
    CASE
      WHEN p_status = 'approved' THEN h.event_status IN ('approved', 'approved_via_replacement')
      WHEN p_status IS NULL THEN true
      ELSE h.event_status = p_status
    END
  ORDER BY h.created_at DESC, h.server_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_collection_history_count_impl(p_cell_id uuid DEFAULT NULL::uuid, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_lot_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cell_name text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH history AS (
  SELECT CASE
        -- Uma reposição é um evento próprio, nunca a reclassificação retroativa
        -- das leituras da peça original que foi substituída.
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) = 'approved'
          AND COALESCE(NULLIF(e.result_payload->>'entry_type', ''),
          NULLIF(e.result_payload->>'source', ''),
          NULLIF(e.result_payload #>> '{result,entry_type}', '')) IN ('baixa_reposicao', 'replacement_approval')
          THEN 'approved_via_replacement'
        WHEN COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status) IN ('wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        ELSE COALESCE(NULLIF(e.result_status, ''),
          NULLIF(e.result_payload->>'status', ''),
          NULLIF(e.result_payload #>> '{result,status}', ''),
          NULLIF(sr.status, ''), e.status)
      END AS event_status
  FROM public.production_collection_events e
  LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
  LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
  WHERE (p_cell_name IS NULL OR e.cell_name IS NULL OR lower(btrim(e.cell_name)) = lower(btrim(p_cell_name)))
      AND (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''))) = lower(trim(p_cell_name)))
    AND (p_cell_id IS NULL OR EXISTS (
      SELECT 1 FROM public.cells c
      WHERE c.id = p_cell_id
        AND lower(trim(c.name)) = lower(trim(COALESCE(e.cell_name, sr.cell_name, '')))
    ))
    AND (p_workstation_id IS NULL OR COALESCE(e.machine_id, sr.machine_id) = p_workstation_id)
    AND (p_operator_id IS NULL OR e.operator_id = p_operator_id)
    AND (p_shift IS NULL OR COALESCE(e.shift, sr.shift) = p_shift)
    AND (p_lot_id IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = p_lot_id)
    AND (p_date_from IS NULL OR COALESCE(e.created_at_client, e.created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(e.created_at_client, e.created_at) <= p_date_to)
  )
  SELECT count(*) FROM history h
  WHERE CASE
    WHEN p_status = 'approved' THEN h.event_status IN ('approved', 'approved_via_replacement')
    WHEN p_status IS NULL THEN true
    ELSE h.event_status = p_status
  END;
$function$;


-- Source: 20260926140210_authorization_scope_cardinality.sql

ALTER FUNCTION private.current_profile_authorized_cells() ROWS 1000;
ALTER FUNCTION public.current_profile_readable_cell_names() ROWS 1000;

-- Source: 20260926140200_history_cell_prefilter.sql

DO $patch$
DECLARE item record; definition text;
  original text := 'WHERE (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''''))) = lower(trim(p_cell_name)))';
  optimized text := 'WHERE (p_cell_name IS NULL OR e.cell_name IS NULL OR lower(btrim(e.cell_name)) = lower(btrim(p_cell_name)))
      AND (p_cell_name IS NULL OR lower(trim(COALESCE(e.cell_name, sr.cell_name, ''''))) = lower(trim(p_cell_name)))';
BEGIN
  FOR item IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('get_collection_history_impl','get_collection_history_count_impl')
  LOOP
    definition:=pg_get_functiondef(item.oid);
    IF position(optimized IN definition)=0 THEN RAISE EXCEPTION 'HISTORY_PREFILTER_ROLLBACK_SOURCE_MISMATCH'; END IF;
    EXECUTE replace(definition,optimized,original);
  END LOOP;
END;
$patch$;

-- Source: 20260926134442_coalesced_batch_projection_order.sql

CREATE OR REPLACE FUNCTION public.refresh_collection_lot_state(p_lot_id uuid, p_reading_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_lot public.production_lots%ROWTYPE;
  v_metrics jsonb;
  v_existing_version bigint;
  v_new_version bigint;
  v_is_complete boolean;
  v_completed_operations bigint;
  v_current_stage text;
  v_current_stage_label text;
BEGIN
  IF p_lot_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('production-lot:' || p_lot_id::text, 0));

  IF p_reading_id IS NOT NULL THEN
    SELECT reading.lot_state_version
    INTO v_existing_version
    FROM public.production_stage_readings reading
    WHERE reading.id = p_reading_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    IF v_existing_version IS NOT NULL THEN
      RETURN public.get_collection_lot_snapshot(p_lot_id);
    END IF;
  END IF;

  SELECT * INTO v_lot
  FROM public.production_lots
  WHERE id = p_lot_id
  FOR NO KEY UPDATE;

  IF v_lot.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_metrics := public.get_collection_lot_route_metrics(p_lot_id);
  v_is_complete := coalesce((v_metrics ->> 'is_complete')::boolean, false);
  v_completed_operations := coalesce((v_metrics ->> 'completed_operations')::bigint, 0);
  v_current_stage := v_metrics ->> 'current_stage';
  v_current_stage_label := v_metrics ->> 'current_stage_label';

  UPDATE public.production_lots lot
  SET state_version = lot.state_version + 1,
      planned_quantity = coalesce((v_metrics ->> 'total_parts')::integer, lot.planned_quantity),
      progress_percent = coalesce((v_metrics ->> 'progress_percent')::numeric, 0),
      produced_quantity = coalesce((v_metrics ->> 'completed_parts')::numeric, 0),
      approved_quantity = coalesce((v_metrics ->> 'completed_parts')::numeric, 0),
      rejected_quantity = coalesce((v_metrics ->> 'rejected')::numeric, 0),
      pending_quantity = coalesce((v_metrics ->> 'pending_parts')::numeric, 0),
      missing_count = coalesce((v_metrics ->> 'pending_parts')::integer, 0),
      rework_count = coalesce((v_metrics ->> 'rework')::integer, 0),
      status = CASE
        WHEN v_is_complete THEN 'closed'
        WHEN v_completed_operations > 0 THEN 'in_progress'
        WHEN lot.status IN ('closed','shipped') THEN 'planned'
        ELSE lot.status
      END,
      current_status = CASE
        WHEN v_is_complete THEN 'completed'
        WHEN v_completed_operations > 0 THEN 'in_progress'
        ELSE coalesce(lot.current_status, lot.status)
      END,
      current_stage = coalesce(v_current_stage, lot.current_stage),
      current_step = coalesce(v_current_stage, lot.current_step),
      current_cell = coalesce(v_current_stage_label, lot.current_cell),
      actual_start = CASE
        WHEN v_completed_operations > 0 THEN coalesce(lot.actual_start, clock_timestamp())
        ELSE lot.actual_start
      END,
      actual_end = CASE WHEN v_is_complete THEN coalesce(lot.actual_end, clock_timestamp()) ELSE NULL END,
      closed_at = CASE WHEN v_is_complete THEN coalesce(lot.closed_at, clock_timestamp()) ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE lot.id = p_lot_id
  RETURNING lot.state_version INTO v_new_version;

  IF p_reading_id IS NOT NULL THEN
    UPDATE public.production_stage_readings
    SET lot_state_version = v_new_version
    WHERE id = p_reading_id;
  END IF;

  IF v_lot.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(v_lot.pcp_import_batch_id);
  END IF;

  RETURN public.get_collection_lot_snapshot(p_lot_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION private.process_collection_projection_batch_v3(p_worker_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pgmq', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), ''), 160);
  v_item record;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_now timestamptz;
  v_shard smallint;
  v_entry_id uuid;
  v_retryable boolean;
  v_backoff_ms integer;
  v_sqlstate text;
  v_error_message text;
  v_dead_letter_message_id bigint;
  v_broadcast_enabled boolean := false;
  v_finalized_count integer := 0;
  v_input_count integer;
  v_lock_timeout_ms integer := 1000;
  v_statement_timeout_ms integer := 10000;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_worker_id = '' THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTOR_ID_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_ITEMS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_input_count := jsonb_array_length(p_items);
  IF v_input_count < 1 OR v_input_count > 25 THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_BATCH_SIZE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    greatest(100, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'lock_timeout_ms'), 1000
    ), 5000))::integer,
    greatest(1000, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'statement_timeout_ms'), 10000
    ), 30000))::integer
  INTO v_lock_timeout_ms, v_statement_timeout_ms
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_projection'
    AND flag.enabled IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_V3_PROJECTION_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('lock_timeout', v_lock_timeout_ms::text || 'ms', true);
  PERFORM set_config('statement_timeout', v_statement_timeout_ms::text || 'ms', true);

  SELECT coalesce(flag.enabled, false)
  INTO v_broadcast_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_broadcast';

  CREATE TEMP TABLE pg_temp.collection_v3_projection_input
  ON COMMIT DROP
  AS
  WITH messages AS (
    SELECT
      item.ordinality::integer AS ordinal,
      item.value ->> 'queue_name' AS queue_name,
      private.try_collection_bigint_v3(item.value ->> 'msg_id') AS msg_id,
      greatest(1, coalesce(private.try_collection_bigint_v3(item.value ->> 'read_ct'), 1))::integer AS read_ct,
      private.try_collection_uuid_v3(item.value -> 'message' ->> 'outbox_id') AS outbox_id_from_message,
      item.value -> 'message' ->> 'client_event_id' AS client_event_id_from_message
    FROM jsonb_array_elements(p_items) WITH ORDINALITY item(value, ordinality)
  )
  SELECT
    messages.*,
    outbox.id AS outbox_id,
    outbox.client_event_id,
    outbox.projection_revision,
    outbox.projection_kind,
    outbox.previous_decision,
    outbox.reading_id,
    outbox.piece_id,
    outbox.lot_id,
    outbox.cell_id,
    outbox.machine_id,
    outbox.operator_id,
    outbox.shift_snapshot,
    outbox.step_code,
    outbox.decision,
    outbox.quantity,
    outbox.payload,
    outbox.created_at AS outbox_created_at,
    reading.date AS reading_date,
    reading.hour AS reading_hour,
    reading.cell_name,
    reading.machine_name,
    reading.operator AS operator_name,
    reading.reader_type,
    reading.tag_value,
    reading.lot_code,
    reading.load_number,
    reading.order_number,
    reading.production_order_id,
    reading.customer_name,
    reading.environment_name,
    piece.traceability_code,
    piece.current_stage,
    piece.legacy_production_lot_item_id,
    piece.pcp_import_batch_id,
    receipt.device_id
  FROM messages
  LEFT JOIN public.collection_projection_outbox outbox
    ON outbox.id = messages.outbox_id_from_message
   AND outbox.client_event_id = messages.client_event_id_from_message
  LEFT JOIN public.production_stage_readings reading ON reading.id = outbox.reading_id
  LEFT JOIN public.production_pieces piece ON piece.id = outbox.piece_id
  LEFT JOIN public.coletas_producao receipt
    ON receipt.client_event_id = outbox.client_event_id
   AND receipt.pipeline_version = 3;

  FOR v_item IN
    -- Ordem estável das chaves compartilhadas reduz ciclos entre projetores
    -- concorrentes; a coleta já foi decidida e não espera estes locks.
    SELECT *
    FROM pg_temp.collection_v3_projection_input
    ORDER BY lot_id NULLS LAST,
             step_code NULLS LAST,
             cell_id NULLS LAST,
             machine_id NULLS LAST,
             piece_id NULLS LAST,
             outbox_id NULLS LAST,
             ordinal
  LOOP
    v_sqlstate := NULL;
    v_error_message := NULL;
    v_entry_id := NULL;

    BEGIN
      IF v_item.queue_name <> 'collection_projection_v3'
         OR v_item.msg_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_QUEUE_MESSAGE_INVALID'
          USING ERRCODE = '22023';
      END IF;

      IF v_item.outbox_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_OUTBOX_NOT_FOUND'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_item.client_event_id IS DISTINCT FROM v_item.client_event_id_from_message THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_MESSAGE_MISMATCH'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.collection_projection_outbox outbox
        WHERE outbox.id = v_item.outbox_id
          AND outbox.projected_at IS NOT NULL
      ) THEN
        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', v_item.client_event_id,
          'projected', true,
          'idempotent_replay', true
        ));
        CONTINUE;
      END IF;

      IF v_item.lot_id IS NOT NULL
         AND v_item.step_code IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id,
           'lot_stage_shard',
           jsonb_build_object(
             'decision', v_item.decision,
             'previous_decision', v_item.previous_decision,
             'quantity', v_item.quantity,
             'projection_revision', v_item.projection_revision
           )
         ) THEN
        v_shard := (
          (
            hashtextextended(
              coalesce(v_item.piece_id::text, v_item.client_event_id), 0
            ) % 16
          ) + 16
        ) % 16;

        INSERT INTO public.production_lot_stage_counter_shards (
          lot_id, step_code, shard_number,
          approved_count, rejected_count, blocked_count,
          duplicated_count, pending_review_count, quantity_total,
          state_version, updated_at
        ) VALUES (
          v_item.lot_id, v_item.step_code, v_shard,
          CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
          1,
          clock_timestamp()
        )
        ON CONFLICT (lot_id, step_code, shard_number) DO UPDATE
        SET approved_count = public.production_lot_stage_counter_shards.approved_count + excluded.approved_count,
            rejected_count = public.production_lot_stage_counter_shards.rejected_count + excluded.rejected_count,
            blocked_count = public.production_lot_stage_counter_shards.blocked_count + excluded.blocked_count,
            duplicated_count = public.production_lot_stage_counter_shards.duplicated_count + excluded.duplicated_count,
            pending_review_count = public.production_lot_stage_counter_shards.pending_review_count + excluded.pending_review_count,
            quantity_total = public.production_lot_stage_counter_shards.quantity_total + excluded.quantity_total,
            state_version = public.production_lot_stage_counter_shards.state_version + 1,
            updated_at = excluded.updated_at;
      END IF;

      IF v_item.previous_decision = 'approved'
         AND v_item.decision <> 'approved'
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_entry_reversal', v_item.payload
         ) THEN
        -- A função de reprovação já pode ter feito este estorno. O predicado
        -- torna a compensação idempotente e também cobre correções emitidas
        -- por outros fluxos administrativos.
        UPDATE public.production_entries
        SET approval_status = 'reversed',
            correction_reason = coalesce(
              nullif(correction_reason, ''),
              'Estorno assíncrono Collection Fabric v3'
            ),
            corrected_by = coalesce(nullif(corrected_by, ''), 'collection_fabric_v3'),
            corrected_at = coalesce(corrected_at, clock_timestamp()),
            updated_at = clock_timestamp()
        WHERE client_event_id = v_item.client_event_id
          AND coalesce(approval_status, 'valid') = 'valid';
      END IF;

      IF v_item.reading_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'realtime_counter', v_item.payload
         ) THEN
        -- Aprovações são contabilizadas pelo trigger de production_entries.
        -- Aqui entram somente categorias não aprovadas e suas compensações;
        -- assim uma aprovação não soma duas vezes (projetor + entry trigger).
        IF v_item.decision <> 'approved'
           OR (
             v_item.previous_decision IS NOT NULL
             AND v_item.previous_decision <> 'approved'
           ) THEN
          PERFORM public.adjust_production_realtime_counter(
            coalesce(v_item.reading_date, current_date),
            v_item.lot_id,
            v_item.lot_code,
            v_item.load_number,
            v_item.order_number,
            v_item.customer_name,
            v_item.environment_name,
            v_item.cell_name,
            v_item.machine_id,
            v_item.machine_name,
            public.production_metric_unit_for_cell(
              v_item.cell_name, v_item.step_code, v_item.step_code
            ),
            NULL,
            0,
            0,
            CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
            CASE WHEN v_item.decision IN ('blocked', 'duplicated') THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision IN ('blocked', 'duplicated') THEN v_item.quantity ELSE 0 END,
            CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
          );
        END IF;
      END IF;

      IF v_item.decision = 'approved'
         AND v_item.reading_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_entry', v_item.payload
         ) THEN
        INSERT INTO public.production_entries (
          date, shift, cell, hour, produced, target, scrap, downtime,
          operator, notes, client_event_id, operator_id, production_order_id,
          order_id, lot_id, step_code, order_number, lot_code, load_number,
          customer_name, process_step, station_name, entry_mode, source,
          machine_id, machine_name, environment_name, operation_name,
          pcp_import_batch_id, metric_unit, metric_unit_label,
          realized_quantity, pieces_quantity
        ) VALUES (
          coalesce(v_item.reading_date, current_date),
          coalesce(nullif(v_item.shift_snapshot, ''), 'Não informado'),
          coalesce(nullif(v_item.cell_name, ''), 'Não informada'),
          coalesce(nullif(v_item.reading_hour, ''), to_char(clock_timestamp(), 'HH24:MI')),
          v_item.quantity, 0, 0, 0,
          v_item.operator_name,
          'Projeção assíncrona Collection Fabric v3',
          v_item.client_event_id, v_item.operator_id, v_item.production_order_id,
          v_item.production_order_id, v_item.lot_id, v_item.step_code,
          v_item.order_number, v_item.lot_code, v_item.load_number,
          v_item.customer_name, v_item.step_code, v_item.machine_name,
          'automatic', 'collection_fabric_v3',
          v_item.machine_id, v_item.machine_name,
          v_item.environment_name, v_item.step_code, v_item.pcp_import_batch_id,
          public.production_metric_unit_for_cell(v_item.cell_name, v_item.step_code, v_item.step_code),
          public.production_metric_unit_label(
            public.production_metric_unit_for_cell(v_item.cell_name, v_item.step_code, v_item.step_code)
          ),
          v_item.quantity, v_item.quantity
        )
        ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL
        DO UPDATE SET
          approval_status = 'valid',
          correction_reason = NULL,
          corrected_by = NULL,
          corrected_at = NULL,
          updated_at = clock_timestamp()
        RETURNING id INTO v_entry_id;

        UPDATE public.production_collection_events
        SET production_entry_id = v_entry_id,
            updated_at = clock_timestamp()
        WHERE client_event_id = v_item.client_event_id;

        UPDATE public.production_stage_readings
        SET production_entry_id = v_entry_id
        WHERE id = v_item.reading_id
          AND pipeline_version = 3;
      END IF;

      IF v_item.piece_id IS NOT NULL
         AND v_item.traceability_code IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_event', v_item.payload
         ) THEN
        INSERT INTO public.production_events (
          piece_id, traceability_code, production_order_id, lot_id,
          event_type, from_stage, to_stage, cell_name, machine_id, device_id,
          operator_id, event_status, rejection_reason, reading_source,
          barcode_raw_value, notes, metadata, legacy_stage_reading_id, created_at
        ) VALUES (
          v_item.piece_id, v_item.traceability_code, v_item.production_order_id, v_item.lot_id,
          CASE WHEN v_item.decision = 'approved' THEN 'stage_advance' ELSE 'block' END,
          NULL, v_item.step_code, v_item.cell_name, v_item.machine_id::text,
          v_item.device_id, v_item.operator_id,
          CASE v_item.decision
            WHEN 'approved' THEN 'accepted'
            WHEN 'rejected' THEN 'rejected'
            WHEN 'blocked' THEN 'blocked'
            WHEN 'duplicated' THEN 'duplicated'
            ELSE 'warning'
          END,
          CASE WHEN v_item.decision = 'approved' THEN NULL ELSE v_item.payload ->> 'reason_code' END,
          v_item.reader_type, v_item.tag_value,
          'Projeção assíncrona Collection Fabric v3',
          jsonb_build_object(
            'collection_pipeline_version', 3,
            'outbox_id', v_item.outbox_id,
            'client_event_id', v_item.client_event_id,
            'projection_revision', v_item.projection_revision,
            'projection_kind', v_item.projection_kind,
            'previous_decision', v_item.previous_decision
          ),
          v_item.reading_id,
          v_item.outbox_created_at
        );
      END IF;

      IF v_item.lot_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_lot_lifecycle', v_item.payload
         ) THEN
        -- O fechamento/troca de lote continua usando as regras legadas já
        -- homologadas, mas agora fora da transação que decide e trava a peça.
        IF v_item.decision = 'approved'
           AND v_item.legacy_production_lot_item_id IS NOT NULL THEN
          UPDATE public.production_lot_items legacy_item
          SET current_step = coalesce(
                (
                  SELECT routing_step.name
                  FROM public.routing_steps routing_step
                  WHERE routing_step.code = v_item.current_stage
                  LIMIT 1
                ),
                v_item.current_stage
              ),
              status = CASE
                WHEN v_item.current_stage = 'Concluída' THEN 'completed'
                ELSE 'in_progress'
              END,
              updated_at = clock_timestamp()
          WHERE legacy_item.id = v_item.legacy_production_lot_item_id;
        END IF;

      END IF;

      v_now := clock_timestamp();
      UPDATE public.collection_projection_outbox
      SET projected_at = v_now,
          projection_lag_ms = extract(epoch FROM (v_now - created_at)) * 1000,
          last_error_code = NULL
      WHERE id = v_item.outbox_id;

      UPDATE public.production_collection_events
      SET projected_at = v_now,
          updated_at = v_now
      WHERE client_event_id = v_item.client_event_id
        AND pipeline_version = 3;

      UPDATE public.coletas_producao
      SET projected_at = v_now,
          updated_at = v_now
      WHERE client_event_id = v_item.client_event_id
        AND pipeline_version = 3;

      PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);

      v_result := jsonb_build_object(
        'outbox_id', v_item.outbox_id,
        'client_event_id', v_item.client_event_id,
        'projected', true,
        'projected_at', v_now
      );
      v_results := v_results || jsonb_build_array(v_result);
      v_finalized_count := v_finalized_count + 1;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      v_now := clock_timestamp();
      v_retryable := private.collection_v3_is_retryable_sqlstate(v_sqlstate);

      IF v_retryable AND coalesce(v_item.read_ct, 1) < 5 THEN
        v_backoff_ms := private.collection_v3_backoff_ms(
          coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          v_item.read_ct
        );
        PERFORM pgmq.set_vt(
          v_item.queue_name,
          v_item.msg_id,
          greatest(1, ceil(v_backoff_ms / 1000.0)::integer)
        );
        UPDATE public.collection_projection_outbox
        SET available_at = v_now + make_interval(secs => v_backoff_ms / 1000.0),
            attempt_count = greatest(attempt_count, v_item.read_ct),
            last_error_code = v_sqlstate
        WHERE id = v_item.outbox_id;

        v_result := jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'projected', false,
          'state', 'retrying',
          'reason_code', v_sqlstate,
          'retry_in_ms', v_backoff_ms
        );
      ELSE
        SELECT pgmq.send(
          'collection_dead_letter_v3',
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'projection',
            'source_queue', v_item.queue_name,
            'source_message_id', v_item.msg_id,
            'outbox_id', v_item.outbox_id,
            'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
            'attempts', coalesce(v_item.read_ct, 1),
            'sqlstate', v_sqlstate,
            'failed_at', v_now
          ))
        ) INTO v_dead_letter_message_id;

        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
        UPDATE public.collection_projection_outbox
        SET attempt_count = greatest(attempt_count, v_item.read_ct),
            last_error_code = v_sqlstate,
            dead_lettered_at = v_now
        WHERE id = v_item.outbox_id;

        v_result := jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'projected', false,
          'state', 'dead_lettered',
          'reason_code', CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE v_sqlstate END
        );
        v_finalized_count := v_finalized_count + 1;
      END IF;

      v_results := v_results || jsonb_build_array(v_result);
    END;
  END LOOP;


  -- collection_v3_capacity_coalesced_v1
  -- This is still the SAME database transaction. Any failure rolls back the
  -- checkpoints, effects and archives together; replay cannot double-count.
  CREATE TEMP TABLE pg_temp.collection_v3_projection_success
  ON COMMIT DROP AS
  SELECT input.*, outbox.projected_at
  FROM pg_temp.collection_v3_projection_input input
  JOIN public.collection_projection_outbox outbox ON outbox.id = input.outbox_id
  JOIN jsonb_to_recordset(v_results) result(
    outbox_id uuid, projected boolean, idempotent_replay boolean
  ) ON result.outbox_id = input.outbox_id
  WHERE result.projected IS TRUE
    AND coalesce(result.idempotent_replay, false) IS FALSE;

  -- Activate only AFTER row-level effects. All downstream calculations see one
  -- canonical route snapshot per import, discarded on commit/rollback.
  CREATE TEMP TABLE pg_temp.collection_v3_route_progress_cache (
    batch_id uuid PRIMARY KEY, progress jsonb NOT NULL
  ) ON COMMIT DROP;
  PERFORM set_config('acprod.collection_v3_projection_cache', 'on', true);

  -- Latest event wins for each station; delayed replay cannot restore an old lot.
  FOR v_item IN
    SELECT DISTINCT ON (cell_name, step_code, machine_id) *
    FROM pg_temp.collection_v3_projection_success
    WHERE decision = 'approved' AND lot_id IS NOT NULL
      AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY cell_name, step_code, machine_id,
             outbox_created_at DESC, client_event_id DESC
  LOOP
    PERFORM public.switch_cell_active_lot_context(
      v_item.cell_name, v_item.step_code, v_item.machine_id,
      v_item.lot_id, v_item.pcp_import_batch_id,
      v_item.outbox_created_at, v_item.client_event_id
    );
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT ON (lot_id, cell_name, step_code, machine_id) *
    FROM pg_temp.collection_v3_projection_success
    WHERE lot_id IS NOT NULL AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY lot_id, cell_name, step_code, machine_id,
             outbox_created_at DESC, client_event_id DESC
  LOOP
    PERFORM public.recalculate_cell_lot_state(
      v_item.lot_id, v_item.cell_name, v_item.step_code,
      v_item.machine_id, v_item.operator_id
    );
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT lot_id FROM pg_temp.collection_v3_projection_success
    WHERE lot_id IS NOT NULL ORDER BY lot_id
  LOOP
    -- Parameter two is a reading UUID, NOT an operator UUID. NULL deliberately
    -- requests a single canonical rebuild for all readings of this batch/lot.
    PERFORM public.refresh_collection_lot_state(v_item.lot_id, NULL::uuid);
    UPDATE public.production_stage_readings reading
    SET lot_state_version = lot.state_version
    FROM public.production_lots lot,
         pg_temp.collection_v3_projection_success success
    WHERE lot.id = v_item.lot_id AND success.lot_id = lot.id
      AND reading.id = success.reading_id AND reading.pipeline_version = 3;
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT success.pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success success
    WHERE success.pcp_import_batch_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.production_lots lot
        JOIN pg_temp.collection_v3_projection_success refreshed ON refreshed.lot_id = lot.id
        WHERE lot.pcp_import_batch_id = success.pcp_import_batch_id
      )
    ORDER BY success.pcp_import_batch_id
  LOOP
    PERFORM public.refresh_pcp_batch_progress(v_item.pcp_import_batch_id);
  END LOOP;
  PERFORM private.mark_collection_projection_v3(
    success.outbox_id, 'pcp_batch_progress', success.payload
  )
  FROM pg_temp.collection_v3_projection_success success
  WHERE success.pcp_import_batch_id IS NOT NULL;

  -- The batch dashboard must cover every required lot, including untouched
  -- lots. Summing only populated per-machine lot states undercounts planning.
  FOR v_item IN
    SELECT DISTINCT pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success
    WHERE pcp_import_batch_id IS NOT NULL ORDER BY pcp_import_batch_id
  LOOP
    PERFORM private.refresh_shared_collection_batch_snapshot(v_item.pcp_import_batch_id);
  END LOOP;

  -- Timestamp the COMPLETED projection, not the earlier row-level checkpoint.
  -- All three public surfaces and emitted deltas share this same final time.
  v_now := clock_timestamp();
  UPDATE public.collection_projection_outbox outbox
  SET projected_at = v_now,
      projection_lag_ms = extract(epoch FROM (v_now - outbox.created_at)) * 1000
  FROM pg_temp.collection_v3_projection_success success
  WHERE outbox.id = success.outbox_id;
  UPDATE public.production_collection_events event
  SET projected_at = v_now, updated_at = v_now
  FROM pg_temp.collection_v3_projection_success success
  WHERE event.client_event_id = success.client_event_id AND event.pipeline_version = 3;
  UPDATE public.coletas_producao receipt
  SET projected_at = v_now, updated_at = v_now
  FROM pg_temp.collection_v3_projection_success success
  WHERE receipt.client_event_id = success.client_event_id AND receipt.pipeline_version = 3;
  UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now WHERE outbox_id IS NOT NULL;
  SELECT coalesce(jsonb_agg(
    CASE WHEN success.outbox_id IS NOT NULL THEN
      result.value || jsonb_build_object('projected_at', v_now)
    ELSE result.value END ORDER BY result.ordinality
  ), '[]'::jsonb) INTO v_results
  FROM jsonb_array_elements(v_results) WITH ORDINALITY result(value, ordinality)
  LEFT JOIN pg_temp.collection_v3_projection_success success
    ON success.outbox_id = (result.value ->> 'outbox_id')::uuid;

  -- Enqueue broadcasts only after all snapshots and lifecycle state agree.
  FOR v_item IN SELECT * FROM pg_temp.collection_v3_projection_success LOOP
    v_now := v_item.projected_at;
      IF v_broadcast_enabled
         AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
        IF v_item.device_id IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', v_item.client_event_id,
              'outbox_id', v_item.outbox_id,
              'projection_revision', v_item.projection_revision,
              'projection_kind', v_item.projection_kind,
              'previous_decision', v_item.previous_decision,
              'decision', v_item.decision,
              'quantity', v_item.quantity,
              'cell_name', v_item.cell_name,
              'machine_id', v_item.machine_id,
              'operator_id', v_item.operator_id,
              'pcp_import_batch_id', v_item.pcp_import_batch_id,
              'delta', jsonb_build_object(
                'total', CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
                'approved',
                  CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
                'rejected',
                  CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
                'blocked',
                  CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
                'duplicated',
                  CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
                'pending',
                  CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              ),
              'projection_lag_ms', extract(epoch FROM (v_now - v_item.outbox_created_at)) * 1000,
              'projected_at', v_now
            ),
            'collection.projection_delta',
            'collection:device:' || v_item.device_id,
            true
          );
        END IF;

        IF v_item.cell_id IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', v_item.client_event_id,
              'outbox_id', v_item.outbox_id,
              'projection_revision', v_item.projection_revision,
              'projection_kind', v_item.projection_kind,
              'previous_decision', v_item.previous_decision,
              'decision', v_item.decision,
              'lot_id', v_item.lot_id,
              'step_code', v_item.step_code,
              'quantity', v_item.quantity,
              'cell_name', v_item.cell_name,
              'machine_id', v_item.machine_id,
              'operator_id', v_item.operator_id,
              'pcp_import_batch_id', v_item.pcp_import_batch_id,
              'delta', jsonb_build_object(
                'total', CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
                'approved',
                  CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
                'rejected',
                  CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
                'blocked',
                  CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
                'duplicated',
                  CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
                'pending',
                  CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              ),
              'projected_at', v_now
            ),
            'collection.projection_delta',
            'collection:cell:' || v_item.cell_id::text,
            true
          );
        END IF;
      END IF;

  END LOOP;

  UPDATE private.collection_worker_heartbeats
  SET heartbeat_at = clock_timestamp(),
      finished_at = clock_timestamp(),
      finalized_count = v_finalized_count,
      last_error_code = NULL
  WHERE worker_id = v_worker_id;

  RETURN v_results;
END;
$function$
;

-- Source: 20260926133308_shared_batch_stage_snapshots.sql

CREATE OR REPLACE FUNCTION private.process_collection_projection_batch_v3(p_worker_id text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pgmq', 'realtime', 'pg_temp'
AS $function$
DECLARE
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), ''), 160);
  v_item record;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_now timestamptz;
  v_shard smallint;
  v_entry_id uuid;
  v_retryable boolean;
  v_backoff_ms integer;
  v_sqlstate text;
  v_error_message text;
  v_dead_letter_message_id bigint;
  v_broadcast_enabled boolean := false;
  v_finalized_count integer := 0;
  v_input_count integer;
  v_lock_timeout_ms integer := 1000;
  v_statement_timeout_ms integer := 10000;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_worker_id = '' THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTOR_ID_REQUIRED'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_ITEMS_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_input_count := jsonb_array_length(p_items);
  IF v_input_count < 1 OR v_input_count > 25 THEN
    RAISE EXCEPTION 'COLLECTION_PROJECTION_BATCH_SIZE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    greatest(100, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'lock_timeout_ms'), 1000
    ), 5000))::integer,
    greatest(1000, least(coalesce(
      private.try_collection_bigint_v3(flag.rollout_scope ->> 'statement_timeout_ms'), 10000
    ), 30000))::integer
  INTO v_lock_timeout_ms, v_statement_timeout_ms
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_projection'
    AND flag.enabled IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTION_PIPELINE_V3_PROJECTION_DISABLED'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('lock_timeout', v_lock_timeout_ms::text || 'ms', true);
  PERFORM set_config('statement_timeout', v_statement_timeout_ms::text || 'ms', true);

  SELECT coalesce(flag.enabled, false)
  INTO v_broadcast_enabled
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name = 'collection_pipeline_v3_broadcast';

  CREATE TEMP TABLE pg_temp.collection_v3_projection_input
  ON COMMIT DROP
  AS
  WITH messages AS (
    SELECT
      item.ordinality::integer AS ordinal,
      item.value ->> 'queue_name' AS queue_name,
      private.try_collection_bigint_v3(item.value ->> 'msg_id') AS msg_id,
      greatest(1, coalesce(private.try_collection_bigint_v3(item.value ->> 'read_ct'), 1))::integer AS read_ct,
      private.try_collection_uuid_v3(item.value -> 'message' ->> 'outbox_id') AS outbox_id_from_message,
      item.value -> 'message' ->> 'client_event_id' AS client_event_id_from_message
    FROM jsonb_array_elements(p_items) WITH ORDINALITY item(value, ordinality)
  )
  SELECT
    messages.*,
    outbox.id AS outbox_id,
    outbox.client_event_id,
    outbox.projection_revision,
    outbox.projection_kind,
    outbox.previous_decision,
    outbox.reading_id,
    outbox.piece_id,
    outbox.lot_id,
    outbox.cell_id,
    outbox.machine_id,
    outbox.operator_id,
    outbox.shift_snapshot,
    outbox.step_code,
    outbox.decision,
    outbox.quantity,
    outbox.payload,
    outbox.created_at AS outbox_created_at,
    reading.date AS reading_date,
    reading.hour AS reading_hour,
    reading.cell_name,
    reading.machine_name,
    reading.operator AS operator_name,
    reading.reader_type,
    reading.tag_value,
    reading.lot_code,
    reading.load_number,
    reading.order_number,
    reading.production_order_id,
    reading.customer_name,
    reading.environment_name,
    piece.traceability_code,
    piece.current_stage,
    piece.legacy_production_lot_item_id,
    piece.pcp_import_batch_id,
    receipt.device_id
  FROM messages
  LEFT JOIN public.collection_projection_outbox outbox
    ON outbox.id = messages.outbox_id_from_message
   AND outbox.client_event_id = messages.client_event_id_from_message
  LEFT JOIN public.production_stage_readings reading ON reading.id = outbox.reading_id
  LEFT JOIN public.production_pieces piece ON piece.id = outbox.piece_id
  LEFT JOIN public.coletas_producao receipt
    ON receipt.client_event_id = outbox.client_event_id
   AND receipt.pipeline_version = 3;

  FOR v_item IN
    -- Ordem estável das chaves compartilhadas reduz ciclos entre projetores
    -- concorrentes; a coleta já foi decidida e não espera estes locks.
    SELECT *
    FROM pg_temp.collection_v3_projection_input
    ORDER BY lot_id NULLS LAST,
             step_code NULLS LAST,
             cell_id NULLS LAST,
             machine_id NULLS LAST,
             piece_id NULLS LAST,
             outbox_id NULLS LAST,
             ordinal
  LOOP
    v_sqlstate := NULL;
    v_error_message := NULL;
    v_entry_id := NULL;

    BEGIN
      IF v_item.queue_name <> 'collection_projection_v3'
         OR v_item.msg_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_QUEUE_MESSAGE_INVALID'
          USING ERRCODE = '22023';
      END IF;

      IF v_item.outbox_id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_OUTBOX_NOT_FOUND'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_item.client_event_id IS DISTINCT FROM v_item.client_event_id_from_message THEN
        RAISE EXCEPTION 'COLLECTION_PROJECTION_MESSAGE_MISMATCH'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.collection_projection_outbox outbox
        WHERE outbox.id = v_item.outbox_id
          AND outbox.projected_at IS NOT NULL
      ) THEN
        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', v_item.client_event_id,
          'projected', true,
          'idempotent_replay', true
        ));
        CONTINUE;
      END IF;

      IF v_item.lot_id IS NOT NULL
         AND v_item.step_code IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id,
           'lot_stage_shard',
           jsonb_build_object(
             'decision', v_item.decision,
             'previous_decision', v_item.previous_decision,
             'quantity', v_item.quantity,
             'projection_revision', v_item.projection_revision
           )
         ) THEN
        v_shard := (
          (
            hashtextextended(
              coalesce(v_item.piece_id::text, v_item.client_event_id), 0
            ) % 16
          ) + 16
        ) % 16;

        INSERT INTO public.production_lot_stage_counter_shards (
          lot_id, step_code, shard_number,
          approved_count, rejected_count, blocked_count,
          duplicated_count, pending_review_count, quantity_total,
          state_version, updated_at
        ) VALUES (
          v_item.lot_id, v_item.step_code, v_shard,
          CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
            - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END,
          CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
          1,
          clock_timestamp()
        )
        ON CONFLICT (lot_id, step_code, shard_number) DO UPDATE
        SET approved_count = public.production_lot_stage_counter_shards.approved_count + excluded.approved_count,
            rejected_count = public.production_lot_stage_counter_shards.rejected_count + excluded.rejected_count,
            blocked_count = public.production_lot_stage_counter_shards.blocked_count + excluded.blocked_count,
            duplicated_count = public.production_lot_stage_counter_shards.duplicated_count + excluded.duplicated_count,
            pending_review_count = public.production_lot_stage_counter_shards.pending_review_count + excluded.pending_review_count,
            quantity_total = public.production_lot_stage_counter_shards.quantity_total + excluded.quantity_total,
            state_version = public.production_lot_stage_counter_shards.state_version + 1,
            updated_at = excluded.updated_at;
      END IF;

      IF v_item.previous_decision = 'approved'
         AND v_item.decision <> 'approved'
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_entry_reversal', v_item.payload
         ) THEN
        -- A função de reprovação já pode ter feito este estorno. O predicado
        -- torna a compensação idempotente e também cobre correções emitidas
        -- por outros fluxos administrativos.
        UPDATE public.production_entries
        SET approval_status = 'reversed',
            correction_reason = coalesce(
              nullif(correction_reason, ''),
              'Estorno assíncrono Collection Fabric v3'
            ),
            corrected_by = coalesce(nullif(corrected_by, ''), 'collection_fabric_v3'),
            corrected_at = coalesce(corrected_at, clock_timestamp()),
            updated_at = clock_timestamp()
        WHERE client_event_id = v_item.client_event_id
          AND coalesce(approval_status, 'valid') = 'valid';
      END IF;

      IF v_item.reading_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'realtime_counter', v_item.payload
         ) THEN
        -- Aprovações são contabilizadas pelo trigger de production_entries.
        -- Aqui entram somente categorias não aprovadas e suas compensações;
        -- assim uma aprovação não soma duas vezes (projetor + entry trigger).
        IF v_item.decision <> 'approved'
           OR (
             v_item.previous_decision IS NOT NULL
             AND v_item.previous_decision <> 'approved'
           ) THEN
          PERFORM public.adjust_production_realtime_counter(
            coalesce(v_item.reading_date, current_date),
            v_item.lot_id,
            v_item.lot_code,
            v_item.load_number,
            v_item.order_number,
            v_item.customer_name,
            v_item.environment_name,
            v_item.cell_name,
            v_item.machine_id,
            v_item.machine_name,
            public.production_metric_unit_for_cell(
              v_item.cell_name, v_item.step_code, v_item.step_code
            ),
            NULL,
            0,
            0,
            CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
            CASE WHEN v_item.decision IN ('blocked', 'duplicated') THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision IN ('blocked', 'duplicated') THEN v_item.quantity ELSE 0 END,
            CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
          );
        END IF;
      END IF;

      IF v_item.decision = 'approved'
         AND v_item.reading_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_entry', v_item.payload
         ) THEN
        INSERT INTO public.production_entries (
          date, shift, cell, hour, produced, target, scrap, downtime,
          operator, notes, client_event_id, operator_id, production_order_id,
          order_id, lot_id, step_code, order_number, lot_code, load_number,
          customer_name, process_step, station_name, entry_mode, source,
          machine_id, machine_name, environment_name, operation_name,
          pcp_import_batch_id, metric_unit, metric_unit_label,
          realized_quantity, pieces_quantity
        ) VALUES (
          coalesce(v_item.reading_date, current_date),
          coalesce(nullif(v_item.shift_snapshot, ''), 'Não informado'),
          coalesce(nullif(v_item.cell_name, ''), 'Não informada'),
          coalesce(nullif(v_item.reading_hour, ''), to_char(clock_timestamp(), 'HH24:MI')),
          v_item.quantity, 0, 0, 0,
          v_item.operator_name,
          'Projeção assíncrona Collection Fabric v3',
          v_item.client_event_id, v_item.operator_id, v_item.production_order_id,
          v_item.production_order_id, v_item.lot_id, v_item.step_code,
          v_item.order_number, v_item.lot_code, v_item.load_number,
          v_item.customer_name, v_item.step_code, v_item.machine_name,
          'automatic', 'collection_fabric_v3',
          v_item.machine_id, v_item.machine_name,
          v_item.environment_name, v_item.step_code, v_item.pcp_import_batch_id,
          public.production_metric_unit_for_cell(v_item.cell_name, v_item.step_code, v_item.step_code),
          public.production_metric_unit_label(
            public.production_metric_unit_for_cell(v_item.cell_name, v_item.step_code, v_item.step_code)
          ),
          v_item.quantity, v_item.quantity
        )
        ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL
        DO UPDATE SET
          approval_status = 'valid',
          correction_reason = NULL,
          corrected_by = NULL,
          corrected_at = NULL,
          updated_at = clock_timestamp()
        RETURNING id INTO v_entry_id;

        UPDATE public.production_collection_events
        SET production_entry_id = v_entry_id,
            updated_at = clock_timestamp()
        WHERE client_event_id = v_item.client_event_id;

        UPDATE public.production_stage_readings
        SET production_entry_id = v_entry_id
        WHERE id = v_item.reading_id
          AND pipeline_version = 3;
      END IF;

      IF v_item.piece_id IS NOT NULL
         AND v_item.traceability_code IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_production_event', v_item.payload
         ) THEN
        INSERT INTO public.production_events (
          piece_id, traceability_code, production_order_id, lot_id,
          event_type, from_stage, to_stage, cell_name, machine_id, device_id,
          operator_id, event_status, rejection_reason, reading_source,
          barcode_raw_value, notes, metadata, legacy_stage_reading_id, created_at
        ) VALUES (
          v_item.piece_id, v_item.traceability_code, v_item.production_order_id, v_item.lot_id,
          CASE WHEN v_item.decision = 'approved' THEN 'stage_advance' ELSE 'block' END,
          NULL, v_item.step_code, v_item.cell_name, v_item.machine_id::text,
          v_item.device_id, v_item.operator_id,
          CASE v_item.decision
            WHEN 'approved' THEN 'accepted'
            WHEN 'rejected' THEN 'rejected'
            WHEN 'blocked' THEN 'blocked'
            WHEN 'duplicated' THEN 'duplicated'
            ELSE 'warning'
          END,
          CASE WHEN v_item.decision = 'approved' THEN NULL ELSE v_item.payload ->> 'reason_code' END,
          v_item.reader_type, v_item.tag_value,
          'Projeção assíncrona Collection Fabric v3',
          jsonb_build_object(
            'collection_pipeline_version', 3,
            'outbox_id', v_item.outbox_id,
            'client_event_id', v_item.client_event_id,
            'projection_revision', v_item.projection_revision,
            'projection_kind', v_item.projection_kind,
            'previous_decision', v_item.previous_decision
          ),
          v_item.reading_id,
          v_item.outbox_created_at
        );
      END IF;

      IF v_item.lot_id IS NOT NULL
         AND private.mark_collection_projection_v3(
           v_item.outbox_id, 'legacy_lot_lifecycle', v_item.payload
         ) THEN
        -- O fechamento/troca de lote continua usando as regras legadas já
        -- homologadas, mas agora fora da transação que decide e trava a peça.
        IF v_item.decision = 'approved'
           AND v_item.legacy_production_lot_item_id IS NOT NULL THEN
          UPDATE public.production_lot_items legacy_item
          SET current_step = coalesce(
                (
                  SELECT routing_step.name
                  FROM public.routing_steps routing_step
                  WHERE routing_step.code = v_item.current_stage
                  LIMIT 1
                ),
                v_item.current_stage
              ),
              status = CASE
                WHEN v_item.current_stage = 'Concluída' THEN 'completed'
                ELSE 'in_progress'
              END,
              updated_at = clock_timestamp()
          WHERE legacy_item.id = v_item.legacy_production_lot_item_id;
        END IF;

      END IF;

      v_now := clock_timestamp();
      UPDATE public.collection_projection_outbox
      SET projected_at = v_now,
          projection_lag_ms = extract(epoch FROM (v_now - created_at)) * 1000,
          last_error_code = NULL
      WHERE id = v_item.outbox_id;

      UPDATE public.production_collection_events
      SET projected_at = v_now,
          updated_at = v_now
      WHERE client_event_id = v_item.client_event_id
        AND pipeline_version = 3;

      UPDATE public.coletas_producao
      SET projected_at = v_now,
          updated_at = v_now
      WHERE client_event_id = v_item.client_event_id
        AND pipeline_version = 3;

      PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);

      v_result := jsonb_build_object(
        'outbox_id', v_item.outbox_id,
        'client_event_id', v_item.client_event_id,
        'projected', true,
        'projected_at', v_now
      );
      v_results := v_results || jsonb_build_array(v_result);
      v_finalized_count := v_finalized_count + 1;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;

      v_now := clock_timestamp();
      v_retryable := private.collection_v3_is_retryable_sqlstate(v_sqlstate);

      IF v_retryable AND coalesce(v_item.read_ct, 1) < 5 THEN
        v_backoff_ms := private.collection_v3_backoff_ms(
          coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          v_item.read_ct
        );
        PERFORM pgmq.set_vt(
          v_item.queue_name,
          v_item.msg_id,
          greatest(1, ceil(v_backoff_ms / 1000.0)::integer)
        );
        UPDATE public.collection_projection_outbox
        SET available_at = v_now + make_interval(secs => v_backoff_ms / 1000.0),
            attempt_count = greatest(attempt_count, v_item.read_ct),
            last_error_code = v_sqlstate
        WHERE id = v_item.outbox_id;

        v_result := jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'projected', false,
          'state', 'retrying',
          'reason_code', v_sqlstate,
          'retry_in_ms', v_backoff_ms
        );
      ELSE
        SELECT pgmq.send(
          'collection_dead_letter_v3',
          jsonb_strip_nulls(jsonb_build_object(
            'kind', 'projection',
            'source_queue', v_item.queue_name,
            'source_message_id', v_item.msg_id,
            'outbox_id', v_item.outbox_id,
            'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
            'attempts', coalesce(v_item.read_ct, 1),
            'sqlstate', v_sqlstate,
            'failed_at', v_now
          ))
        ) INTO v_dead_letter_message_id;

        PERFORM pgmq.archive(v_item.queue_name, v_item.msg_id);
        UPDATE public.collection_projection_outbox
        SET attempt_count = greatest(attempt_count, v_item.read_ct),
            last_error_code = v_sqlstate,
            dead_lettered_at = v_now
        WHERE id = v_item.outbox_id;

        v_result := jsonb_build_object(
          'outbox_id', v_item.outbox_id,
          'client_event_id', coalesce(v_item.client_event_id, v_item.client_event_id_from_message),
          'projected', false,
          'state', 'dead_lettered',
          'reason_code', CASE WHEN v_retryable THEN 'RETRY_EXHAUSTED' ELSE v_sqlstate END
        );
        v_finalized_count := v_finalized_count + 1;
      END IF;

      v_results := v_results || jsonb_build_array(v_result);
    END;
  END LOOP;


  -- collection_v3_capacity_coalesced_v1
  -- This is still the SAME database transaction. Any failure rolls back the
  -- checkpoints, effects and archives together; replay cannot double-count.
  CREATE TEMP TABLE pg_temp.collection_v3_projection_success
  ON COMMIT DROP AS
  SELECT input.*, outbox.projected_at
  FROM pg_temp.collection_v3_projection_input input
  JOIN public.collection_projection_outbox outbox ON outbox.id = input.outbox_id
  JOIN jsonb_to_recordset(v_results) result(
    outbox_id uuid, projected boolean, idempotent_replay boolean
  ) ON result.outbox_id = input.outbox_id
  WHERE result.projected IS TRUE
    AND coalesce(result.idempotent_replay, false) IS FALSE;

  -- Activate only AFTER row-level effects. All downstream calculations see one
  -- canonical route snapshot per import, discarded on commit/rollback.
  CREATE TEMP TABLE pg_temp.collection_v3_route_progress_cache (
    batch_id uuid PRIMARY KEY, progress jsonb NOT NULL
  ) ON COMMIT DROP;
  PERFORM set_config('acprod.collection_v3_projection_cache', 'on', true);

  -- Latest event wins for each station; delayed replay cannot restore an old lot.
  FOR v_item IN
    SELECT DISTINCT ON (cell_name, step_code, machine_id) *
    FROM pg_temp.collection_v3_projection_success
    WHERE decision = 'approved' AND lot_id IS NOT NULL
      AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY cell_name, step_code, machine_id,
             outbox_created_at DESC, client_event_id DESC
  LOOP
    PERFORM public.switch_cell_active_lot_context(
      v_item.cell_name, v_item.step_code, v_item.machine_id,
      v_item.lot_id, v_item.pcp_import_batch_id,
      v_item.outbox_created_at, v_item.client_event_id
    );
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT ON (lot_id, cell_name, step_code, machine_id) *
    FROM pg_temp.collection_v3_projection_success
    WHERE lot_id IS NOT NULL AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY lot_id, cell_name, step_code, machine_id,
             outbox_created_at DESC, client_event_id DESC
  LOOP
    PERFORM public.recalculate_cell_lot_state(
      v_item.lot_id, v_item.cell_name, v_item.step_code,
      v_item.machine_id, v_item.operator_id
    );
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT lot_id FROM pg_temp.collection_v3_projection_success
    WHERE lot_id IS NOT NULL ORDER BY lot_id
  LOOP
    -- Parameter two is a reading UUID, NOT an operator UUID. NULL deliberately
    -- requests a single canonical rebuild for all readings of this batch/lot.
    PERFORM public.refresh_collection_lot_state(v_item.lot_id, NULL::uuid);
    UPDATE public.production_stage_readings reading
    SET lot_state_version = lot.state_version
    FROM public.production_lots lot,
         pg_temp.collection_v3_projection_success success
    WHERE lot.id = v_item.lot_id AND success.lot_id = lot.id
      AND reading.id = success.reading_id AND reading.pipeline_version = 3;
  END LOOP;

  FOR v_item IN
    SELECT DISTINCT success.pcp_import_batch_id
    FROM pg_temp.collection_v3_projection_success success
    WHERE success.pcp_import_batch_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.production_lots lot
        JOIN pg_temp.collection_v3_projection_success refreshed ON refreshed.lot_id = lot.id
        WHERE lot.pcp_import_batch_id = success.pcp_import_batch_id
      )
    ORDER BY success.pcp_import_batch_id
  LOOP
    PERFORM public.refresh_pcp_batch_progress(v_item.pcp_import_batch_id);
  END LOOP;
  PERFORM private.mark_collection_projection_v3(
    success.outbox_id, 'pcp_batch_progress', success.payload
  )
  FROM pg_temp.collection_v3_projection_success success
  WHERE success.pcp_import_batch_id IS NOT NULL;

  -- The batch dashboard must cover every required lot, including untouched
  -- lots. Summing only populated per-machine lot states undercounts planning.
  FOR v_item IN
    SELECT DISTINCT pcp_import_batch_id, cell_name, step_code
    FROM pg_temp.collection_v3_projection_success
    WHERE pcp_import_batch_id IS NOT NULL
      AND cell_name IS NOT NULL AND step_code IS NOT NULL
    ORDER BY pcp_import_batch_id, cell_name, step_code
  LOOP
    PERFORM private.refresh_collection_dashboard_batch_snapshot(
      v_item.pcp_import_batch_id, v_item.cell_name, v_item.step_code
    );
  END LOOP;

  -- Timestamp the COMPLETED projection, not the earlier row-level checkpoint.
  -- All three public surfaces and emitted deltas share this same final time.
  v_now := clock_timestamp();
  UPDATE public.collection_projection_outbox outbox
  SET projected_at = v_now,
      projection_lag_ms = extract(epoch FROM (v_now - outbox.created_at)) * 1000
  FROM pg_temp.collection_v3_projection_success success
  WHERE outbox.id = success.outbox_id;
  UPDATE public.production_collection_events event
  SET projected_at = v_now, updated_at = v_now
  FROM pg_temp.collection_v3_projection_success success
  WHERE event.client_event_id = success.client_event_id AND event.pipeline_version = 3;
  UPDATE public.coletas_producao receipt
  SET projected_at = v_now, updated_at = v_now
  FROM pg_temp.collection_v3_projection_success success
  WHERE receipt.client_event_id = success.client_event_id AND receipt.pipeline_version = 3;
  UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now WHERE outbox_id IS NOT NULL;
  SELECT coalesce(jsonb_agg(
    CASE WHEN success.outbox_id IS NOT NULL THEN
      result.value || jsonb_build_object('projected_at', v_now)
    ELSE result.value END ORDER BY result.ordinality
  ), '[]'::jsonb) INTO v_results
  FROM jsonb_array_elements(v_results) WITH ORDINALITY result(value, ordinality)
  LEFT JOIN pg_temp.collection_v3_projection_success success
    ON success.outbox_id = (result.value ->> 'outbox_id')::uuid;

  -- Enqueue broadcasts only after all snapshots and lifecycle state agree.
  FOR v_item IN SELECT * FROM pg_temp.collection_v3_projection_success LOOP
    v_now := v_item.projected_at;
      IF v_broadcast_enabled
         AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
        IF v_item.device_id IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', v_item.client_event_id,
              'outbox_id', v_item.outbox_id,
              'projection_revision', v_item.projection_revision,
              'projection_kind', v_item.projection_kind,
              'previous_decision', v_item.previous_decision,
              'decision', v_item.decision,
              'quantity', v_item.quantity,
              'cell_name', v_item.cell_name,
              'machine_id', v_item.machine_id,
              'operator_id', v_item.operator_id,
              'pcp_import_batch_id', v_item.pcp_import_batch_id,
              'delta', jsonb_build_object(
                'total', CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
                'approved',
                  CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
                'rejected',
                  CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
                'blocked',
                  CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
                'duplicated',
                  CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
                'pending',
                  CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              ),
              'projection_lag_ms', extract(epoch FROM (v_now - v_item.outbox_created_at)) * 1000,
              'projected_at', v_now
            ),
            'collection.projection_delta',
            'collection:device:' || v_item.device_id,
            true
          );
        END IF;

        IF v_item.cell_id IS NOT NULL THEN
          PERFORM realtime.send(
            jsonb_build_object(
              'client_event_id', v_item.client_event_id,
              'outbox_id', v_item.outbox_id,
              'projection_revision', v_item.projection_revision,
              'projection_kind', v_item.projection_kind,
              'previous_decision', v_item.previous_decision,
              'decision', v_item.decision,
              'lot_id', v_item.lot_id,
              'step_code', v_item.step_code,
              'quantity', v_item.quantity,
              'cell_name', v_item.cell_name,
              'machine_id', v_item.machine_id,
              'operator_id', v_item.operator_id,
              'pcp_import_batch_id', v_item.pcp_import_batch_id,
              'delta', jsonb_build_object(
                'total', CASE WHEN v_item.previous_decision IS NULL THEN v_item.quantity ELSE 0 END,
                'approved',
                  CASE WHEN v_item.decision = 'approved' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'approved' THEN v_item.quantity ELSE 0 END,
                'rejected',
                  CASE WHEN v_item.decision = 'rejected' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'rejected' THEN v_item.quantity ELSE 0 END,
                'blocked',
                  CASE WHEN v_item.decision = 'blocked' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'blocked' THEN v_item.quantity ELSE 0 END,
                'duplicated',
                  CASE WHEN v_item.decision = 'duplicated' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'duplicated' THEN v_item.quantity ELSE 0 END,
                'pending',
                  CASE WHEN v_item.decision = 'pending_review' THEN v_item.quantity ELSE 0 END
                  - CASE WHEN v_item.previous_decision = 'pending_review' THEN v_item.quantity ELSE 0 END
              ),
              'projected_at', v_now
            ),
            'collection.projection_delta',
            'collection:cell:' || v_item.cell_id::text,
            true
          );
        END IF;
      END IF;

  END LOOP;

  UPDATE private.collection_worker_heartbeats
  SET heartbeat_at = clock_timestamp(),
      finished_at = clock_timestamp(),
      finalized_count = v_finalized_count,
      last_error_code = NULL
  WHERE worker_id = v_worker_id;

  RETURN v_results;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_collection_dashboard_snapshot_v3(p_cell_name text, p_workstation_id uuid DEFAULT NULL::uuid, p_operator_id uuid DEFAULT NULL::uuid, p_pcp_import_batch_id uuid DEFAULT NULL::uuid, p_lot_id uuid DEFAULT NULL::uuid, p_reference_time timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_step_code text;
  v_context public.production_cell_active_contexts%ROWTYPE;
  v_target_lot_id uuid;
  v_target_batch_id uuid;
  v_expected bigint := 0;
  v_approved bigint := 0;
  v_rejected bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_state_version bigint := 0;
  v_cache_rows bigint := 0;
  v_fallback jsonb;
  v_metrics_source text := 'production_cell_lot_states';
BEGIN
  PERFORM private.assert_collection_read_scope(NULL, p_cell_name);

  v_step_code := coalesce(
    public.resolve_production_stage_for_cell(NULL, p_cell_name),
    '__unmapped_cell__'
  );

  SELECT * INTO v_context
  FROM public.production_cell_active_contexts context
  WHERE lower(btrim(context.cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(context.step_code)) = lower(btrim(v_step_code))
    AND (p_workstation_id IS NULL OR context.machine_id = p_workstation_id)
  ORDER BY context.last_event_occurred_at DESC NULLS LAST, context.updated_at DESC
  LIMIT 1;

  IF p_lot_id IS NOT NULL THEN
    v_target_lot_id := p_lot_id;
    v_target_batch_id := coalesce(
      p_pcp_import_batch_id,
      (
        SELECT lot.pcp_import_batch_id
        FROM public.production_lots lot
        WHERE lot.id = p_lot_id
      )
    );
  ELSIF p_pcp_import_batch_id IS NOT NULL THEN
    v_target_batch_id := p_pcp_import_batch_id;
  ELSIF v_context.active_pcp_import_batch_id IS NOT NULL THEN
    v_target_batch_id := v_context.active_pcp_import_batch_id;
  ELSIF v_context.active_lot_id IS NOT NULL THEN
    v_target_lot_id := v_context.active_lot_id;
  END IF;

  IF v_target_lot_id IS NULL AND v_target_batch_id IS NOT NULL THEN
    -- A batch must include ALL its lots, including lots not scanned yet.
    -- Summing only workstation/lot caches silently truncates the planned universe.
    SELECT 1, cache.expected_count, cache.approved_count, cache.rejected_count,
           cache.pending_count, cache.rework_count, cache.replacement_count,
           cache.state_version
    INTO v_cache_rows, v_expected, v_approved, v_rejected, v_pending,
         v_rework, v_replacement, v_state_version
    FROM private.collection_dashboard_batch_snapshots cache
    JOIN public.promob_import_batches batch ON batch.id = cache.pcp_import_batch_id
      AND cache.source_batch_updated_at IS NOT DISTINCT FROM batch.collection_snapshot_updated_at
    WHERE cache.pcp_import_batch_id = v_target_batch_id
      AND cache.cell_name = lower(btrim(p_cell_name))
      AND cache.step_code = lower(btrim(v_step_code));
    IF NOT FOUND THEN v_cache_rows := 0; END IF;
    v_metrics_source := 'collection_dashboard_batch_snapshots';
  ELSE
    SELECT
    count(*),
    coalesce(sum(state.expected_count), 0),
    coalesce(sum(state.approved_count), 0),
    coalesce(sum(state.rejected_count), 0),
    coalesce(sum(state.pending_count), 0),
    coalesce(sum(state.rework_count), 0),
    coalesce(sum(state.replacement_count), 0),
    coalesce(max(state.state_version), 0)
  INTO
    v_cache_rows,
    v_expected,
    v_approved,
    v_rejected,
    v_pending,
    v_rework,
    v_replacement,
    v_state_version
  FROM public.production_cell_lot_states state
  WHERE lower(btrim(state.cell_name)) = lower(btrim(p_cell_name))
    AND lower(btrim(state.step_code)) = lower(btrim(v_step_code))
    AND coalesce(
          state.machine_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          p_workstation_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
    AND (
      (v_target_lot_id IS NOT NULL AND state.lot_id = v_target_lot_id)
      OR (
        v_target_lot_id IS NULL
        AND v_target_batch_id IS NOT NULL
        AND state.pcp_import_batch_id = v_target_batch_id
      )
    );
  END IF;

  IF v_cache_rows = 0 THEN
    v_metrics_source := 'route_metrics_fallback';
    v_fallback := public.get_collection_route_stage_metrics(
      v_target_batch_id,
      v_target_lot_id,
      v_step_code
    );
    v_expected := coalesce((v_fallback ->> 'expected')::bigint, 0);
    v_approved := coalesce((v_fallback ->> 'approved')::bigint, 0);
    v_rejected := coalesce((v_fallback ->> 'rejected')::bigint, 0);
    v_pending := coalesce((v_fallback ->> 'pending')::bigint, 0);
    v_rework := coalesce((v_fallback ->> 'rework')::bigint, 0);
    v_replacement := coalesce((v_fallback ->> 'replacement')::bigint, 0);
  END IF;

  v_state_version := greatest(
    coalesce(v_state_version, 0),
    coalesce(v_context.state_version, 0)
  );

  RETURN jsonb_build_object(
    'server_time', clock_timestamp(),
    'reference_time', p_reference_time,
    'state_version', v_state_version,
    'step_code', v_step_code,
    'metrics_source', v_metrics_source,
    'active_context', CASE
      WHEN v_context.id IS NULL THEN NULL
      ELSE to_jsonb(v_context)
    END,
    'active_general_lots', CASE
      WHEN v_context.id IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'id', v_context.active_pcp_import_batch_id,
        'general_lot_code', v_context.active_general_lot_code,
        'lot_id', v_context.active_lot_id,
        'lot_code', v_context.active_lot_code,
        'state_version', v_context.state_version
      ))
    END,
    'lot_kpis', jsonb_build_object(
      'expected', v_expected,
      'approved', v_approved,
      'rejected', v_rejected,
      'pending', v_pending,
      'rework', v_rework,
      'replacement', v_replacement
    ),
    'expected', v_expected,
    'approved', v_approved,
    'rejected', v_rejected,
    'pending', v_pending,
    'rework', v_rework,
    'replacement', v_replacement,
    'total', v_expected
  );
END;
$function$
;
DROP FUNCTION private.refresh_shared_collection_batch_snapshot(uuid);
DROP FUNCTION private.collection_batch_stage_metrics(uuid);
DROP TABLE private.collection_shared_batch_stage_snapshots;

-- Source: 20260926132334_shared_read_policy_scopes.sql

ALTER POLICY production_lots_scoped_read ON public.production_lots USING (public.can_access_production_lot(id));
ALTER POLICY production_orders_scoped_read ON public.production_orders USING (public.can_access_production_order(id));
ALTER POLICY production_stage_readings_scoped_read ON public.production_stage_readings USING (
  public.current_profile_has_global_cell_access() OR public.profile_can_access_cell(cell_name)
  OR (nullif(btrim(cell_name),'') IS NULL AND piece_id IS NOT NULL AND public.can_access_production_piece(piece_id))
  OR (nullif(btrim(cell_name),'') IS NULL AND piece_id IS NULL AND public.can_access_production_lot(lot_id))
);
DROP FUNCTION public.current_profile_readable_cell_names();

-- Source: 20260926132209_grouped_lot_tracking.sql

CREATE OR REPLACE FUNCTION public.get_general_lot_tracking_base(p_batch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
stage_catalog(stage_code, stage_label, stage_order, default_minutes_per_piece) as (
  values
    ('cut'::text, 'Corte'::text, 1, 2.0::numeric),
    ('edge'::text, 'Borda'::text, 2, 3.0::numeric),
    ('cnc'::text, 'Usinagem'::text, 3, 5.0::numeric),
    ('joinery'::text, 'Marcenaria'::text, 4, 20.0::numeric)
),
recent_readings as (
  select
    case
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cut', 'corte') then 'cut'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('edge', 'bordo', 'borda') then 'edge'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cnc', 'usinagem') then 'cnc'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('joinery', 'marcenaria') then 'joinery'
      else null
    end as stage_code,
    (r.created_at at time zone 'America/Sao_Paulo')::date as production_day,
    r.created_at
  from public.production_stage_readings r
  where r.status = 'approved'
    and r.created_at >= now() - interval '90 days'
),
daily_stage_rates as (
  select
    rr.stage_code,
    rr.production_day,
    count(*)::integer as approved_readings,
    extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0 as active_minutes,
    case
      when count(*) >= 3
       and max(rr.created_at) - min(rr.created_at) >= interval '5 minutes'
      then (extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0)
           / greatest(count(*) - 1, 1)
      else null
    end as minutes_per_piece
  from recent_readings rr
  where rr.stage_code is not null
  group by rr.stage_code, rr.production_day
),
learned_metrics as (
  select
    d.stage_code,
    count(*) filter (where d.minutes_per_piece is not null)::integer as observed_days,
    coalesce(sum(d.approved_readings), 0)::integer as sample_count,
    percentile_cont(0.5) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as median_minutes_per_piece,
    percentile_cont(0.8) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as p80_minutes_per_piece
  from daily_stage_rates d
  group by d.stage_code
),
stage_models as (
  select
    s.stage_code,
    s.stage_label,
    s.stage_order,
    s.default_minutes_per_piece,
    coalesce(l.observed_days, 0) as observed_days,
    coalesce(l.sample_count, 0) as sample_count,
    round(coalesce(l.median_minutes_per_piece, s.default_minutes_per_piece)::numeric, 2) as minutes_per_piece,
    round(coalesce(l.p80_minutes_per_piece, s.default_minutes_per_piece * 1.25)::numeric, 2) as p80_minutes_per_piece,
    case
      when coalesce(l.observed_days, 0) >= 5 and coalesce(l.sample_count, 0) >= 500 then 'high'
      when coalesce(l.observed_days, 0) >= 1 and coalesce(l.sample_count, 0) >= 100 then 'medium'
      else 'low'
    end as confidence,
    case when coalesce(l.observed_days, 0) > 0 then 'learned' else 'baseline' end as model_source
  from stage_catalog s
  left join learned_metrics l on l.stage_code = s.stage_code
),
selected_batches as (
  select b.*
  from public.promob_import_batches b
  where (p_batch_id is not null and b.id = p_batch_id)
     or (
       p_batch_id is null
       and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'error', 'failed')
       and exists (
         select 1 from public.production_lots pl where pl.pcp_import_batch_id = b.id
       )
     )
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
),
selected_lots as (
  select l.*
  from public.production_lots l
  join selected_batches b on b.id = l.pcp_import_batch_id
  where lower(coalesce(l.status, '')) not in ('cancelled', 'canceled')
),
selected_pieces as (
  select p.*
  from public.production_pieces p
  join selected_batches b on b.id = p.pcp_import_batch_id
  where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')
),
piece_stage as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    p.id as piece_id,
    s.stage_code,
    s.stage_label,
    s.stage_order,
    case s.stage_code
      when 'cut' then coalesce(p.requires_cut, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then coalesce(p.requires_edge, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then coalesce(p.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then coalesce(p.requires_joinery, false) or coalesce(p.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_required,
    case s.stage_code
      when 'cut' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_completed
  from selected_pieces p
  cross join stage_catalog s
),
piece_completion as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.piece_id,
    count(*) filter (where ps.is_required)::integer as required_operations,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_operations,
    (
      count(*) filter (where ps.is_required) > 0
      and count(*) filter (where ps.is_required) = count(*) filter (where ps.is_required and ps.is_completed)
    ) as ready_for_separation
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.piece_id
),
lot_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
lot_stage_forecast as (
  select
    lr.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(lr.required_pieces - lr.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when lr.required_pieces > 0
      then round((100.0 * lr.completed_pieces / lr.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from lot_stage_rollup lr
  join stage_models m on m.stage_code = lr.stage_code
),
lot_stage_json as (
  select
    lf.pcp_import_batch_id,
    lf.lot_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', lf.stage_code,
        'stage_label', lf.stage_label,
        'stage_order', lf.stage_order,
        'required_pieces', lf.required_pieces,
        'completed_pieces', lf.completed_pieces,
        'remaining_pieces', lf.remaining_pieces,
        'progress_percent', lf.progress_percent,
        'estimated_remaining_minutes', lf.estimated_remaining_minutes,
        'p80_remaining_minutes', lf.p80_remaining_minutes,
        'confidence', lf.confidence,
        'model_source', lf.model_source
      ) order by lf.stage_order
    ) as stages,
    coalesce(sum(lf.estimated_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(lf.p80_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(lf.stage_label order by lf.estimated_remaining_minutes desc)
        filter (where lf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case lf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where lf.required_pieces > 0 and lf.remaining_pieces > 0) as confidence_rank
  from lot_stage_forecast lf
  group by lf.pcp_import_batch_id, lf.lot_id
),
lot_piece_rollup as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    count(*)::integer as total_pieces,
    count(*) filter (where pc.ready_for_separation)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations), 0)::integer as completed_operations,
    count(*) filter (where p.is_blocked)::integer as blocked_pieces,
    count(*) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as rework_pieces,
    count(*) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id, p.lot_id
),
lot_results as (
  select
    l.pcp_import_batch_id,
    l.id as lot_id,
    l.lot_code,
    l.customer_name,
    l.status,
    coalesce(l.current_stage, l.current_step, 'imported') as current_stage,
    l.planned_end,
    coalesce(pr.total_pieces, 0) as total_pieces,
    coalesce(pr.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(pr.total_operations, 0) as total_operations,
    coalesce(pr.completed_operations, 0) as completed_operations,
    coalesce(pr.blocked_pieces, 0) as blocked_pieces,
    coalesce(pr.rework_pieces, 0) as rework_pieces,
    coalesce(pr.replacement_pieces, 0) as replacement_pieces,
    case when coalesce(pr.total_operations, 0) > 0
      then round((100.0 * pr.completed_operations / pr.total_operations)::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(sj.stages, '[]'::jsonb) as stages,
    coalesce(sj.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(sj.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(sj.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(sj.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(pr.blocked_pieces, 0) + coalesce(pr.rework_pieces, 0) + coalesce(pr.replacement_pieces, 0) > 0 then 'attention'
      when l.planned_end is not null and l.planned_end < now() and coalesce(pr.ready_for_separation_pieces, 0) < coalesce(pr.total_pieces, 0) then 'delayed'
      when coalesce(pr.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status
  from selected_lots l
  left join lot_piece_rollup pr on pr.lot_id = l.id
  left join lot_stage_json sj on sj.lot_id = l.id
),
batch_piece_rollup as (
  select
    p.pcp_import_batch_id,
    count(*)::integer as total_pieces,
    count(*) filter (where pc.ready_for_separation)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations), 0)::integer as completed_operations,
    count(*) filter (where p.is_blocked)::integer as blocked_pieces,
    count(*) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as rework_pieces,
    count(*) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id
),
batch_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage_forecast as (
  select
    br.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(br.required_pieces - br.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when br.required_pieces > 0
      then round((100.0 * br.completed_pieces / br.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from batch_stage_rollup br
  join stage_models m on m.stage_code = br.stage_code
),
batch_stage_json as (
  select
    bf.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', bf.stage_code,
        'stage_label', bf.stage_label,
        'stage_order', bf.stage_order,
        'required_pieces', bf.required_pieces,
        'completed_pieces', bf.completed_pieces,
        'remaining_pieces', bf.remaining_pieces,
        'progress_percent', bf.progress_percent,
        'estimated_remaining_minutes', bf.estimated_remaining_minutes,
        'p80_remaining_minutes', bf.p80_remaining_minutes,
        'minutes_per_piece', bf.minutes_per_piece,
        'confidence', bf.confidence,
        'model_source', bf.model_source
      ) order by bf.stage_order
    ) as stages,
    coalesce(sum(bf.estimated_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(bf.p80_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(bf.stage_label order by bf.estimated_remaining_minutes desc)
        filter (where bf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case bf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where bf.required_pieces > 0 and bf.remaining_pieces > 0) as confidence_rank
  from batch_stage_forecast bf
  group by bf.pcp_import_batch_id
),
client_lot_json as (
  select
    lr.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'lot_id', lr.lot_id,
        'lot_code', lr.lot_code,
        'customer_name', lr.customer_name,
        'status', lr.status,
        'current_stage', lr.current_stage,
        'planned_end', lr.planned_end,
        'total_pieces', lr.total_pieces,
        'ready_for_separation_pieces', lr.ready_for_separation_pieces,
        'total_operations', lr.total_operations,
        'completed_operations', lr.completed_operations,
        'progress_percent', lr.progress_percent,
        'blocked_pieces', lr.blocked_pieces,
        'rework_pieces', lr.rework_pieces,
        'replacement_pieces', lr.replacement_pieces,
        'integrity_percent', case when lr.total_pieces > 0 then round((100.0 * greatest(lr.total_pieces - lr.blocked_pieces - lr.rework_pieces - lr.replacement_pieces, 0) / lr.total_pieces)::numeric, 2) else 100.0 end,
        'stages', lr.stages,
        'bottleneck_stage', lr.bottleneck_stage,
        'estimated_remaining_minutes', lr.estimated_remaining_minutes,
        'p80_remaining_minutes', lr.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(lr.estimated_remaining_minutes)::integer),
        'forecast_confidence', lr.forecast_confidence,
        'forecast_status', lr.forecast_status,
        'ready_for_separation', lr.total_pieces > 0 and lr.ready_for_separation_pieces = lr.total_pieces
      ) order by lr.customer_name nulls last, lr.lot_code
    ) as client_lots
  from lot_results lr
  group by lr.pcp_import_batch_id
),
batch_results as (
  select
    b.id as batch_id,
    b.general_lot_code,
    b.file_name,
    b.status,
    b.created_at,
    b.imported_at,
    coalesce(bp.total_pieces, b.total_parts, 0) as total_pieces,
    coalesce(bp.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(bp.total_operations, b.total_operations, 0) as total_operations,
    coalesce(bp.completed_operations, b.completed_operations, 0) as completed_operations,
    coalesce(bp.blocked_pieces, 0) as blocked_pieces,
    coalesce(bp.rework_pieces, 0) as rework_pieces,
    coalesce(bp.replacement_pieces, 0) as replacement_pieces,
    coalesce((select count(*) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as client_lots_count,
    coalesce((select count(distinct nullif(trim(l.customer_name), '')) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as customers_count,
    case when coalesce(bp.total_operations, b.total_operations, 0) > 0
      then round((100.0 * coalesce(bp.completed_operations, b.completed_operations, 0) / coalesce(bp.total_operations, b.total_operations, 0))::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(bs.stages, '[]'::jsonb) as stages,
    coalesce(bs.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(bs.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(bs.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(bs.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(bp.blocked_pieces, 0) + coalesce(bp.rework_pieces, 0) + coalesce(bp.replacement_pieces, 0) > 0 then 'attention'
      when coalesce(bp.completed_operations, b.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status,
    case when p_batch_id is not null then coalesce(cl.client_lots, '[]'::jsonb) else '[]'::jsonb end as client_lots
  from selected_batches b
  left join batch_piece_rollup bp on bp.pcp_import_batch_id = b.id
  left join batch_stage_json bs on bs.pcp_import_batch_id = b.id
  left join client_lot_json cl on cl.pcp_import_batch_id = b.id
)
select jsonb_build_object(
  'generated_at', now(),
  'prediction_target', 'ready_for_separation',
  'model_window_days', 90,
  'stage_models', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', m.stage_code,
        'stage_label', m.stage_label,
        'stage_order', m.stage_order,
        'sample_count', m.sample_count,
        'observed_days', m.observed_days,
        'minutes_per_piece', m.minutes_per_piece,
        'p80_minutes_per_piece', m.p80_minutes_per_piece,
        'confidence', m.confidence,
        'model_source', m.model_source
      ) order by m.stage_order
    ) from stage_models m
  ), '[]'::jsonb),
  'general_lots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'batch_id', br.batch_id,
        'general_lot_code', br.general_lot_code,
        'file_name', br.file_name,
        'status', br.status,
        'created_at', br.created_at,
        'imported_at', br.imported_at,
        'total_pieces', br.total_pieces,
        'ready_for_separation_pieces', br.ready_for_separation_pieces,
        'total_operations', br.total_operations,
        'completed_operations', br.completed_operations,
        'progress_percent', br.progress_percent,
        'client_lots_count', br.client_lots_count,
        'customers_count', br.customers_count,
        'blocked_pieces', br.blocked_pieces,
        'rework_pieces', br.rework_pieces,
        'replacement_pieces', br.replacement_pieces,
        'integrity_percent', case when br.total_pieces > 0 then round((100.0 * greatest(br.total_pieces - br.blocked_pieces - br.rework_pieces - br.replacement_pieces, 0) / br.total_pieces)::numeric, 2) else 100.0 end,
        'stages', br.stages,
        'bottleneck_stage', br.bottleneck_stage,
        'estimated_remaining_minutes', br.estimated_remaining_minutes,
        'p80_remaining_minutes', br.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(br.estimated_remaining_minutes)::integer),
        'forecast_confidence', br.forecast_confidence,
        'forecast_status', br.forecast_status,
        'ready_for_separation', br.total_pieces > 0 and br.ready_for_separation_pieces = br.total_pieces,
        'client_lots', br.client_lots
      ) order by br.created_at desc
    ) from batch_results br
  ), '[]'::jsonb)
);
$function$;


-- Source: 20260926131946_setwise_read_authorization.sql

CREATE OR REPLACE FUNCTION public.current_profile_readable_lot_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT lot.id FROM public.production_lots lot
  WHERE (SELECT auth.uid()) IS NOT NULL AND public.can_access_production_lot(lot.id);
$function$;

CREATE OR REPLACE FUNCTION public.current_profile_readable_order_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT orders.id FROM public.production_orders orders
  WHERE (SELECT auth.uid()) IS NOT NULL AND public.can_access_production_order(orders.id);
$function$;

DROP FUNCTION private.current_profile_authorized_cells();

-- Source: 20260920164812_piece_read_scope_initplan.sql

ALTER POLICY production_pieces_scoped_read ON public.production_pieces
  USING (public.can_access_production_piece(id));
DROP FUNCTION public.current_profile_readable_lot_ids();
DROP FUNCTION public.current_profile_readable_order_ids();
DROP FUNCTION public.current_profile_readable_recorded_piece_ids();

-- Source: 20260920164337_stage_member_route_normalization.sql

CREATE OR REPLACE FUNCTION public.get_collection_route_stage_metrics(p_pcp_import_batch_id uuid, p_lot_id uuid, p_step_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_batch_id uuid := p_pcp_import_batch_id;
  v_step_code text := coalesce(
    public.normalize_route_step_code(p_step_code),
    lower(btrim(p_step_code))
  );
  v_progress jsonb;
  v_stage jsonb;
  v_expected bigint := 0;
  v_approved bigint := 0;
  v_pending bigint := 0;
  v_rejected bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
BEGIN
  IF v_batch_id IS NULL AND p_lot_id IS NOT NULL THEN
    SELECT lot.pcp_import_batch_id
    INTO v_batch_id
    FROM public.production_lots lot
    WHERE lot.id = p_lot_id;
  END IF;

  IF v_batch_id IS NOT NULL THEN
    v_progress := public.get_lot_route_stage_progress(v_batch_id);

    IF p_lot_id IS NULL THEN
      SELECT stage.value
      INTO v_stage
      FROM jsonb_array_elements(coalesce(v_progress -> 'batch_stages', '[]'::jsonb)) stage(value)
      WHERE public.normalize_route_step_code(stage.value ->> 'stage_code') = v_step_code
      LIMIT 1;
    ELSE
      SELECT stage.value
      INTO v_stage
      FROM jsonb_array_elements(
        coalesce(v_progress -> 'lot_stages' -> p_lot_id::text, '[]'::jsonb)
      ) stage(value)
      WHERE public.normalize_route_step_code(stage.value ->> 'stage_code') = v_step_code
      LIMIT 1;
    END IF;
  END IF;

  IF v_stage IS NOT NULL THEN
    v_expected := coalesce((v_stage ->> 'required_pieces')::bigint, 0);
    v_approved := coalesce((v_stage ->> 'effective_completed_pieces')::bigint, 0);
    v_pending := coalesce(
      (v_stage ->> 'remaining_pieces')::bigint,
      greatest(v_expected - v_approved, 0)
    );
  ELSE
    WITH members AS (
      SELECT
        piece.id,
        coalesce(piece.original_piece_id, piece.id) AS logical_piece_id,
        piece.status,
        piece.rework_status,
        piece.replacement_status,
        coalesce(piece.is_replacement, false) AS is_replacement
      FROM public.production_pieces piece
      JOIN public.production_lots lot ON lot.id = piece.lot_id
      WHERE coalesce(piece.is_active, true) IS TRUE
        AND piece.status NOT IN ('cancelled', 'shipped')
        AND (p_lot_id IS NULL OR piece.lot_id = p_lot_id)
        AND (
          v_batch_id IS NULL
          OR coalesce(piece.pcp_import_batch_id, lot.pcp_import_batch_id) = v_batch_id
        )
        AND public.piece_requires_routing_step(
          v_step_code,
          piece.route_steps,
          piece.requires_cut,
          piece.requires_edge,
          piece.requires_cnc,
          piece.requires_joinery,
          piece.requires_separation,
          piece.requires_packaging
        )
    ),
    approved_slots AS (
      SELECT DISTINCT member.logical_piece_id
      FROM members member
      JOIN LATERAL (
        SELECT scoped.step_name
        FROM public.production_stage_readings scoped
        WHERE scoped.piece_id = member.id AND scoped.status = 'approved'
        OFFSET 0
      ) reading ON public.normalize_route_step_code(reading.step_name) = v_step_code
    )
    SELECT
      count(DISTINCT member.logical_piece_id)::bigint,
      count(DISTINCT approved.logical_piece_id)::bigint
    INTO v_expected, v_approved
    FROM members member
    LEFT JOIN approved_slots approved
      ON approved.logical_piece_id = member.logical_piece_id;

    v_pending := greatest(v_expected - v_approved, 0);
  END IF;

  WITH members AS (
    SELECT
      piece.id,
      coalesce(piece.original_piece_id, piece.id) AS logical_piece_id,
      piece.status,
      piece.rework_status,
      piece.replacement_status,
      coalesce(piece.is_replacement, false) AS is_replacement
    FROM public.production_pieces piece
    JOIN public.production_lots lot ON lot.id = piece.lot_id
    WHERE coalesce(piece.is_active, true) IS TRUE
      AND piece.status NOT IN ('cancelled', 'shipped')
      AND (p_lot_id IS NULL OR piece.lot_id = p_lot_id)
      AND (
        v_batch_id IS NULL
        OR coalesce(piece.pcp_import_batch_id, lot.pcp_import_batch_id) = v_batch_id
      )
      AND public.piece_requires_routing_step(
        v_step_code,
        piece.route_steps,
        piece.requires_cut,
        piece.requires_edge,
        piece.requires_cnc,
        piece.requires_joinery,
        piece.requires_separation,
        piece.requires_packaging
      )
  ),
  slots AS (
    SELECT
      member.logical_piece_id,
      bool_or(member.status = 'rejected')
        AND NOT bool_or(
          member.replacement_status = 'replaced'
          OR (
            member.is_replacement
            AND member.status IN ('completed','packed','inspected','ready_for_shipping','shipped')
          )
        ) AS rejected_open,
      bool_or(
        member.rework_status IN ('pending','in_progress')
        OR member.status IN ('rework','rework_pending','rework_in_progress')
      ) AS rework_open,
      bool_or(
        member.replacement_status IN ('requested','in_production')
        OR member.status IN ('replacement_requested','replacement_in_production')
      )
        AND NOT bool_or(
          member.replacement_status = 'replaced'
          OR (
            member.is_replacement
            AND member.status IN ('completed','packed','inspected','ready_for_shipping','shipped')
          )
        ) AS replacement_open
    FROM members member
    GROUP BY member.logical_piece_id
  )
  SELECT
    count(*) FILTER (WHERE slot.rejected_open)::bigint,
    count(*) FILTER (WHERE slot.rework_open)::bigint,
    count(*) FILTER (WHERE slot.replacement_open)::bigint
  INTO v_rejected, v_rework, v_replacement
  FROM slots slot;

  RETURN jsonb_build_object(
    'pcp_import_batch_id', v_batch_id,
    'lot_id', p_lot_id,
    'step_code', v_step_code,
    'expected', coalesce(v_expected, 0),
    'approved', coalesce(v_approved, 0),
    'pending', coalesce(v_pending, 0),
    'rejected', coalesce(v_rejected, 0),
    'rework', coalesce(v_rework, 0),
    'replacement', coalesce(v_replacement, 0),
    'route_stage', v_stage
  );
END;
$function$;

DROP FUNCTION public.collection_stage_members_for_scope(uuid,uuid,text);

-- Source: 20260920163159_scoped_piece_accounting.sql
-- Restores the exact predecessor definitions; no business rows are changed.

CREATE OR REPLACE FUNCTION public.get_lot_route_stage_progress(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
      DECLARE v_result jsonb;
      BEGIN
        IF coalesce(auth.role(), '') = 'service_role'
           AND current_setting('acprod.collection_v3_projection_cache', true) = 'on' THEN
          -- Dynamic resolution keeps private-schema privileges out of normal
          -- API calls; no SECURITY DEFINER/RLS bypass is introduced.
          EXECUTE 'SELECT private.get_lot_route_stage_progress_cached_capacity($1)'
            INTO v_result USING p_batch_id;
          RETURN v_result;
        END IF;
        RETURN (
with
stage_catalog(stage_code, stage_label, stage_order) as (
  values
    ('cut'::text, 'Corte'::text, 1),
    ('edge'::text, 'Borda'::text, 2),
    ('drill'::text, 'Furação'::text, 3),
    ('cnc'::text, 'Usinagem CNC'::text, 4),
    ('joinery'::text, 'Marcenaria'::text, 5),
    ('separation'::text, 'Separação'::text, 6),
    ('packaging'::text, 'Embalagem'::text, 7)
),
pieces as materialized (
  select
    root.id,
    root.lot_id,
    root.pcp_import_batch_id,
    root.requires_cut,
    root.requires_edge,
    root.requires_cnc,
    root.requires_joinery,
    root.requires_separation,
    root.requires_packaging,
    root.manual_joinery,
    cardinality(coalesce(root.route_steps, '{}'::text[])) > 0 as has_explicit_route,
    accounting.replacement_pending,
    public.canonicalize_production_route(root.route_steps) as route_steps,
    public.canonicalize_production_route(effective.completed_steps) as completed_steps
  from public.production_piece_accounting accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join public.production_pieces effective on effective.id = accounting.effective_piece_id
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
piece_stage as (
  select
    piece.lot_id,
    piece.id as piece_id,
    stage.stage_code,
    stage.stage_label,
    stage.stage_order,
    -- collection_route_precedence_v1: explicit routes beat stale requires flags.
    case when piece.has_explicit_route then
      stage.stage_code = any(piece.route_steps)
    else public.piece_requires_routing_step(
      stage.stage_code, NULL::text[], piece.requires_cut, piece.requires_edge,
      piece.requires_cnc,
      coalesce(piece.requires_joinery,false) or coalesce(piece.manual_joinery,false),
      piece.requires_separation, piece.requires_packaging
    ) end as is_required,
    stage.stage_code = any(piece.completed_steps) as is_completed,
    piece.replacement_pending
  from pieces piece
  cross join stage_catalog stage
),
lot_stage as (
  select
    progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order,
    count(*) filter (where progress.is_required)::integer as required_pieces,
    count(*) filter (where progress.is_required and progress.is_completed)::integer as traceable_completed_pieces,
    count(*) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    )::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order
),
batch_stage as (
  select
    progress.stage_code, progress.stage_label, progress.stage_order,
    count(*) filter (where progress.is_required)::integer as required_pieces,
    count(*) filter (where progress.is_required and progress.is_completed)::integer as traceable_completed_pieces,
    count(*) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    )::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.stage_code, progress.stage_label, progress.stage_order
),
manual_stage as (
  select record.stage_code,
         coalesce(sum(record.quantity), 0)::integer as recorded_manual_quantity,
         count(*)::integer as manual_entry_count
  from public.manual_production_records record
  where record.pcp_import_batch_id = p_batch_id
    and record.traceability_type = 'aggregate_untraceable'
    and coalesce(record.status, 'approved') = 'approved'
  group by record.stage_code
),
lot_remaining as (
  select stage.*, lot.created_at as lot_created_at,
         greatest(stage.required_pieces - stage.replacement_pending_pieces - stage.traceable_completed_pieces, 0)::integer as traceable_remaining,
         coalesce(manual.recorded_manual_quantity, 0)::integer as batch_manual_quantity
  from lot_stage stage
  left join public.production_lots lot on lot.id = stage.lot_id
  left join manual_stage manual on manual.stage_code = stage.stage_code
),
lot_allocated as (
  select remaining.*,
         greatest(least(
           remaining.traceable_remaining,
           remaining.batch_manual_quantity - coalesce(sum(remaining.traceable_remaining) over (
             partition by remaining.stage_code
             order by remaining.lot_created_at nulls last, remaining.lot_id
             rows between unbounded preceding and 1 preceding
           ), 0)
         ), 0)::integer as manual_quantity
  from lot_remaining remaining
),
lot_effective as (
  select allocated.*,
         least(allocated.required_pieces - allocated.replacement_pending_pieces,
               allocated.traceable_completed_pieces + allocated.manual_quantity)::integer as effective_completed_pieces
  from lot_allocated allocated
),
batch_effective as (
  select batch.*,
         coalesce(manual.recorded_manual_quantity, 0)::integer as recorded_manual_quantity,
         least(greatest(batch.required_pieces - batch.replacement_pending_pieces - batch.traceable_completed_pieces, 0),
               coalesce(manual.recorded_manual_quantity, 0))::integer as manual_quantity,
         coalesce(manual.manual_entry_count, 0)::integer as manual_entry_count
  from batch_stage batch
  left join manual_stage manual on manual.stage_code = batch.stage_code
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_completed', not exists (
    select 1 from batch_effective stage
    where stage.required_pieces > 0
      and (stage.replacement_pending_pieces > 0
        or stage.traceable_completed_pieces + stage.manual_quantity < stage.required_pieces)
  ),
  'batch_stages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'stage_code', batch.stage_code,
      'stage_label', batch.stage_label,
      'stage_order', batch.stage_order,
      'required_pieces', batch.required_pieces,
      'traceable_completed_pieces', batch.traceable_completed_pieces,
      'replacement_pending_pieces', batch.replacement_pending_pieces,
      'manual_quantity', batch.manual_quantity,
      'recorded_manual_quantity', batch.recorded_manual_quantity,
      'completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                batch.traceable_completed_pieces + batch.manual_quantity),
      'effective_completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                          batch.traceable_completed_pieces + batch.manual_quantity),
      'remaining_pieces', greatest(batch.required_pieces - batch.traceable_completed_pieces - batch.manual_quantity, 0),
      'progress_percent', case when batch.required_pieces > 0 then round((
        100.0 * least(batch.required_pieces - batch.replacement_pending_pieces,
                      batch.traceable_completed_pieces + batch.manual_quantity) / batch.required_pieces
      )::numeric, 2) else 100.0::numeric end,
      'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
      'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
      'manual_entry_count', batch.manual_entry_count
    ) order by batch.stage_order)
    from batch_effective batch
    left join public.production_stage_policies policy on policy.stage_code = batch.stage_code
  ), '[]'::jsonb),
  'lot_stages', coalesce((
    select jsonb_object_agg(lot.lot_id::text, lot.stages)
    from (
      select stage.lot_id,
             jsonb_agg(jsonb_build_object(
               'stage_code', stage.stage_code,
               'stage_label', stage.stage_label,
               'stage_order', stage.stage_order,
               'required_pieces', stage.required_pieces,
               'traceable_completed_pieces', stage.traceable_completed_pieces,
               'replacement_pending_pieces', stage.replacement_pending_pieces,
               'manual_quantity', stage.manual_quantity,
               'completed_pieces', stage.effective_completed_pieces,
               'effective_completed_pieces', stage.effective_completed_pieces,
               'remaining_pieces', greatest(stage.required_pieces - stage.effective_completed_pieces, 0),
               'progress_percent', case when stage.required_pieces > 0
                 then round((100.0 * stage.effective_completed_pieces / stage.required_pieces)::numeric, 2)
                 else 100.0::numeric end,
               'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
               'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false)
             ) order by stage.stage_order) as stages
      from lot_effective stage
      left join public.production_stage_policies policy on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
));
      END;
      $function$
;
CREATE OR REPLACE FUNCTION private.get_lot_route_stage_progress_uncached_capacity(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
stage_catalog(stage_code, stage_label, stage_order) as (
  values
    ('cut'::text, 'Corte'::text, 1),
    ('edge'::text, 'Borda'::text, 2),
    ('drill'::text, 'Furação'::text, 3),
    ('cnc'::text, 'Usinagem CNC'::text, 4),
    ('joinery'::text, 'Marcenaria'::text, 5),
    ('separation'::text, 'Separação'::text, 6),
    ('packaging'::text, 'Embalagem'::text, 7)
),
pieces as materialized (
  select
    root.id,
    root.lot_id,
    root.pcp_import_batch_id,
    root.requires_cut,
    root.requires_edge,
    root.requires_cnc,
    root.requires_joinery,
    root.requires_separation,
    root.requires_packaging,
    root.manual_joinery,
    cardinality(coalesce(root.route_steps, '{}'::text[])) > 0 as has_explicit_route,
    accounting.replacement_pending,
    public.canonicalize_production_route(root.route_steps) as route_steps,
    public.canonicalize_production_route(effective.completed_steps) as completed_steps
  from public.production_piece_accounting accounting
  join public.production_pieces root on root.id = accounting.root_piece_id
  left join public.production_pieces effective on effective.id = accounting.effective_piece_id
  where root.pcp_import_batch_id = p_batch_id
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
piece_stage as (
  select
    piece.lot_id,
    piece.id as piece_id,
    stage.stage_code,
    stage.stage_label,
    stage.stage_order,
    -- collection_route_precedence_v1: explicit routes beat stale requires flags.
    case when piece.has_explicit_route then
      stage.stage_code = any(piece.route_steps)
    else public.piece_requires_routing_step(
      stage.stage_code, NULL::text[], piece.requires_cut, piece.requires_edge,
      piece.requires_cnc,
      coalesce(piece.requires_joinery,false) or coalesce(piece.manual_joinery,false),
      piece.requires_separation, piece.requires_packaging
    ) end as is_required,
    stage.stage_code = any(piece.completed_steps) as is_completed,
    piece.replacement_pending
  from pieces piece
  cross join stage_catalog stage
),
lot_stage as (
  select
    progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order,
    count(*) filter (where progress.is_required)::integer as required_pieces,
    count(*) filter (where progress.is_required and progress.is_completed)::integer as traceable_completed_pieces,
    count(*) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    )::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order
),
batch_stage as (
  select
    progress.stage_code, progress.stage_label, progress.stage_order,
    count(*) filter (where progress.is_required)::integer as required_pieces,
    count(*) filter (where progress.is_required and progress.is_completed)::integer as traceable_completed_pieces,
    count(*) filter (
      where progress.is_required and progress.replacement_pending and not progress.is_completed
    )::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.stage_code, progress.stage_label, progress.stage_order
),
manual_stage as (
  select record.stage_code,
         coalesce(sum(record.quantity), 0)::integer as recorded_manual_quantity,
         count(*)::integer as manual_entry_count
  from public.manual_production_records record
  where record.pcp_import_batch_id = p_batch_id
    and record.traceability_type = 'aggregate_untraceable'
    and coalesce(record.status, 'approved') = 'approved'
  group by record.stage_code
),
lot_remaining as (
  select stage.*, lot.created_at as lot_created_at,
         greatest(stage.required_pieces - stage.replacement_pending_pieces - stage.traceable_completed_pieces, 0)::integer as traceable_remaining,
         coalesce(manual.recorded_manual_quantity, 0)::integer as batch_manual_quantity
  from lot_stage stage
  left join public.production_lots lot on lot.id = stage.lot_id
  left join manual_stage manual on manual.stage_code = stage.stage_code
),
lot_allocated as (
  select remaining.*,
         greatest(least(
           remaining.traceable_remaining,
           remaining.batch_manual_quantity - coalesce(sum(remaining.traceable_remaining) over (
             partition by remaining.stage_code
             order by remaining.lot_created_at nulls last, remaining.lot_id
             rows between unbounded preceding and 1 preceding
           ), 0)
         ), 0)::integer as manual_quantity
  from lot_remaining remaining
),
lot_effective as (
  select allocated.*,
         least(allocated.required_pieces - allocated.replacement_pending_pieces,
               allocated.traceable_completed_pieces + allocated.manual_quantity)::integer as effective_completed_pieces
  from lot_allocated allocated
),
batch_effective as (
  select batch.*,
         coalesce(manual.recorded_manual_quantity, 0)::integer as recorded_manual_quantity,
         least(greatest(batch.required_pieces - batch.replacement_pending_pieces - batch.traceable_completed_pieces, 0),
               coalesce(manual.recorded_manual_quantity, 0))::integer as manual_quantity,
         coalesce(manual.manual_entry_count, 0)::integer as manual_entry_count
  from batch_stage batch
  left join manual_stage manual on manual.stage_code = batch.stage_code
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_completed', not exists (
    select 1 from batch_effective stage
    where stage.required_pieces > 0
      and (stage.replacement_pending_pieces > 0
        or stage.traceable_completed_pieces + stage.manual_quantity < stage.required_pieces)
  ),
  'batch_stages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'stage_code', batch.stage_code,
      'stage_label', batch.stage_label,
      'stage_order', batch.stage_order,
      'required_pieces', batch.required_pieces,
      'traceable_completed_pieces', batch.traceable_completed_pieces,
      'replacement_pending_pieces', batch.replacement_pending_pieces,
      'manual_quantity', batch.manual_quantity,
      'recorded_manual_quantity', batch.recorded_manual_quantity,
      'completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                batch.traceable_completed_pieces + batch.manual_quantity),
      'effective_completed_pieces', least(batch.required_pieces - batch.replacement_pending_pieces,
                                          batch.traceable_completed_pieces + batch.manual_quantity),
      'remaining_pieces', greatest(batch.required_pieces - batch.traceable_completed_pieces - batch.manual_quantity, 0),
      'progress_percent', case when batch.required_pieces > 0 then round((
        100.0 * least(batch.required_pieces - batch.replacement_pending_pieces,
                      batch.traceable_completed_pieces + batch.manual_quantity) / batch.required_pieces
      )::numeric, 2) else 100.0::numeric end,
      'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
      'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
      'manual_entry_count', batch.manual_entry_count
    ) order by batch.stage_order)
    from batch_effective batch
    left join public.production_stage_policies policy on policy.stage_code = batch.stage_code
  ), '[]'::jsonb),
  'lot_stages', coalesce((
    select jsonb_object_agg(lot.lot_id::text, lot.stages)
    from (
      select stage.lot_id,
             jsonb_agg(jsonb_build_object(
               'stage_code', stage.stage_code,
               'stage_label', stage.stage_label,
               'stage_order', stage.stage_order,
               'required_pieces', stage.required_pieces,
               'traceable_completed_pieces', stage.traceable_completed_pieces,
               'replacement_pending_pieces', stage.replacement_pending_pieces,
               'manual_quantity', stage.manual_quantity,
               'completed_pieces', stage.effective_completed_pieces,
               'effective_completed_pieces', stage.effective_completed_pieces,
               'remaining_pieces', greatest(stage.required_pieces - stage.effective_completed_pieces, 0),
               'progress_percent', case when stage.required_pieces > 0
                 then round((100.0 * stage.effective_completed_pieces / stage.required_pieces)::numeric, 2)
                 else 100.0::numeric end,
               'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
               'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false)
             ) order by stage.stage_order) as stages
      from lot_effective stage
      left join public.production_stage_policies policy on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
);
$function$
;
CREATE OR REPLACE FUNCTION public.refresh_pcp_batch_progress(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_progress jsonb;
  v_total_parts bigint := 0;
  v_completed_parts bigint := 0;
  v_total_operations bigint := 0;
  v_completed_operations bigint := 0;
  v_progress_percent numeric := 0;
  v_batch_completed boolean := false;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_progress := public.get_lot_route_stage_progress(p_batch_id);
  v_batch_completed := coalesce((v_progress ->> 'batch_completed')::boolean, false);

  SELECT
    coalesce(sum((stage.value ->> 'required_pieces')::bigint), 0),
    coalesce(sum((stage.value ->> 'effective_completed_pieces')::bigint), 0)
  INTO v_total_operations, v_completed_operations
  FROM jsonb_array_elements(coalesce(v_progress -> 'batch_stages', '[]'::jsonb)) stage(value);

  SELECT count(*)::bigint
  INTO v_total_parts
  FROM public.production_piece_accounting accounting
  JOIN public.production_pieces root
    ON root.id = accounting.root_piece_id
  WHERE root.pcp_import_batch_id = p_batch_id
    AND lower(coalesce(root.status, '')) NOT IN ('cancelled','canceled');

  WITH lot_roots AS (
    SELECT root.lot_id, count(*)::bigint AS root_count
    FROM public.production_piece_accounting accounting
    JOIN public.production_pieces root
      ON root.id = accounting.root_piece_id
    WHERE root.pcp_import_batch_id = p_batch_id
      AND lower(coalesce(root.status, '')) NOT IN ('cancelled','canceled')
    GROUP BY root.lot_id
  ),
  lot_completion AS (
    SELECT
      lot_root.lot_id,
      lot_root.root_count,
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          coalesce(v_progress -> 'lot_stages' -> lot_root.lot_id::text, '[]'::jsonb)
        ) stage(value)
        WHERE coalesce((stage.value ->> 'required_pieces')::integer, 0) > 0
          AND (
            coalesce((stage.value ->> 'remaining_pieces')::integer, 0) > 0
            OR coalesce((stage.value ->> 'replacement_pending_pieces')::integer, 0) > 0
          )
      ) AS is_complete
    FROM lot_roots lot_root
  )
  SELECT coalesce(sum(root_count) FILTER (WHERE is_complete), 0)::bigint
  INTO v_completed_parts
  FROM lot_completion;

  IF v_batch_completed THEN
    v_completed_parts := v_total_parts;
  END IF;

  v_progress_percent := CASE
    WHEN v_total_operations > 0
      THEN round((100.0 * v_completed_operations / v_total_operations)::numeric, 2)
    WHEN v_total_parts > 0
      THEN round((100.0 * v_completed_parts / v_total_parts)::numeric, 2)
    ELSE 0
  END;

  UPDATE public.promob_import_batches batch
  SET total_parts = v_total_parts,
      completed_parts = least(v_completed_parts, v_total_parts),
      pending_parts = greatest(v_total_parts - v_completed_parts, 0),
      total_operations = v_total_operations,
      completed_operations = least(v_completed_operations, v_total_operations),
      progress_percent = least(greatest(v_progress_percent, 0), 100)
  WHERE batch.id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'batch_completed', v_batch_completed,
    'total_parts', v_total_parts,
    'completed_parts', least(v_completed_parts, v_total_parts),
    'pending_parts', greatest(v_total_parts - v_completed_parts, 0),
    'total_operations', v_total_operations,
    'completed_operations', least(v_completed_operations, v_total_operations),
    'progress_percent', least(greatest(v_progress_percent, 0), 100),
    'route_progress', v_progress
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_collection_lot_route_metrics(p_lot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_lot public.production_lots%ROWTYPE;
  v_progress jsonb;
  v_stages jsonb := '[]'::jsonb;
  v_total_parts bigint := 0;
  v_completed_parts bigint := 0;
  v_required_operations bigint := 0;
  v_completed_operations bigint := 0;
  v_rejected bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_pending bigint := 0;
  v_progress_percent numeric := 0;
  v_bottleneck numeric := 0;
  v_is_complete boolean := false;
  v_current_stage text;
  v_current_stage_label text;
BEGIN
  SELECT *
  INTO v_lot
  FROM public.production_lots
  WHERE id = p_lot_id;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason_code', 'LOT_NOT_FOUND');
  END IF;

  IF v_lot.pcp_import_batch_id IS NOT NULL THEN
    v_progress := public.get_lot_route_stage_progress(v_lot.pcp_import_batch_id);
    v_stages := coalesce(v_progress -> 'lot_stages' -> p_lot_id::text, '[]'::jsonb);
  END IF;

  -- Non-PCP/manual lots do not have a batch stage projection. Build the same
  -- canonical stage contract from each piece route and approved stage facts.
  IF jsonb_array_length(v_stages) = 0 THEN
    WITH route_scope AS (
      SELECT
        coalesce(
          public.normalize_route_step_code(route.route_step),
          lower(btrim(route.route_step))
        ) AS stage_code,
        min(route.ordinality)::integer AS stage_order
      FROM public.production_pieces piece
      CROSS JOIN LATERAL unnest(coalesce(piece.route_steps, '{}'::text[]))
        WITH ORDINALITY route(route_step, ordinality)
      WHERE piece.lot_id = p_lot_id
        AND coalesce(piece.is_active, true) IS TRUE
        AND piece.status NOT IN ('cancelled', 'shipped')
      GROUP BY coalesce(
        public.normalize_route_step_code(route.route_step),
        lower(btrim(route.route_step))
      )
    ),
    stage_scope AS MATERIALIZED (
      SELECT
        route.stage_code,
        route.stage_order,
        coalesce(
          (
            SELECT step.name
            FROM public.routing_steps step
            WHERE public.normalize_route_step_code(step.code) = route.stage_code
               OR public.normalize_route_step_code(step.name) = route.stage_code
            ORDER BY step.sequence NULLS LAST
            LIMIT 1
          ),
          route.stage_code
        ) AS stage_label,
        public.get_collection_route_stage_metrics(
          NULL::uuid,
          p_lot_id,
          route.stage_code
        ) AS metrics
      FROM route_scope route
      WHERE nullif(route.stage_code, '') IS NOT NULL
    )
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stage_code', stage.stage_code,
          'stage_label', stage.stage_label,
          'stage_order', stage.stage_order,
          'required_pieces', coalesce((stage.metrics ->> 'expected')::bigint, 0),
          'effective_completed_pieces', coalesce((stage.metrics ->> 'approved')::bigint, 0),
          'remaining_pieces', coalesce((stage.metrics ->> 'pending')::bigint, 0),
          'replacement_pending_pieces', coalesce((stage.metrics ->> 'replacement')::bigint, 0),
          'rejected_pieces', coalesce((stage.metrics ->> 'rejected')::bigint, 0),
          'rework_pending_pieces', coalesce((stage.metrics ->> 'rework')::bigint, 0)
        )
        ORDER BY stage.stage_order, stage.stage_code
      ),
      '[]'::jsonb
    )
    INTO v_stages
    FROM stage_scope stage;
  END IF;

  SELECT count(*)::bigint
  INTO v_total_parts
  FROM public.production_piece_accounting accounting
  JOIN public.production_pieces root
    ON root.id = accounting.root_piece_id
  WHERE root.lot_id = p_lot_id
    AND lower(coalesce(root.status, '')) NOT IN ('cancelled','canceled','shipped');

  IF jsonb_array_length(v_stages) > 0 THEN
    SELECT
      coalesce(sum((stage.value ->> 'required_pieces')::bigint), 0),
      coalesce(sum((stage.value ->> 'effective_completed_pieces')::bigint), 0),
      coalesce(min(
        CASE
          WHEN coalesce((stage.value ->> 'required_pieces')::numeric, 0) > 0
          THEN least(
            coalesce((stage.value ->> 'effective_completed_pieces')::numeric, 0)
              / (stage.value ->> 'required_pieces')::numeric,
            1
          )
        END
      ), 0),
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_stages) pending_stage(value)
        WHERE coalesce((pending_stage.value ->> 'required_pieces')::bigint, 0) > 0
          AND (
            coalesce((pending_stage.value ->> 'remaining_pieces')::bigint, 0) > 0
            OR coalesce((pending_stage.value ->> 'replacement_pending_pieces')::bigint, 0) > 0
          )
      )
    INTO v_required_operations, v_completed_operations, v_bottleneck, v_is_complete
    FROM jsonb_array_elements(v_stages) stage(value);

    SELECT
      pending_stage.value ->> 'stage_code',
      pending_stage.value ->> 'stage_label'
    INTO v_current_stage, v_current_stage_label
    FROM jsonb_array_elements(v_stages) pending_stage(value)
    WHERE coalesce((pending_stage.value ->> 'required_pieces')::bigint, 0) > 0
      AND (
        coalesce((pending_stage.value ->> 'remaining_pieces')::bigint, 0) > 0
        OR coalesce((pending_stage.value ->> 'replacement_pending_pieces')::bigint, 0) > 0
      )
    ORDER BY coalesce((pending_stage.value ->> 'stage_order')::integer, 999)
    LIMIT 1;
  END IF;

  WITH members AS (
    SELECT
      piece.id,
      coalesce(piece.original_piece_id, piece.id) AS logical_piece_id,
      piece.status,
      piece.rework_status,
      piece.replacement_status,
      coalesce(piece.is_replacement, false) AS is_replacement
    FROM public.production_pieces piece
    WHERE piece.lot_id = p_lot_id
      AND coalesce(piece.is_active, true) IS TRUE
      AND piece.status NOT IN ('cancelled', 'shipped')
  ),
  slots AS (
    SELECT
      member.logical_piece_id,
      bool_or(member.status = 'rejected')
        AND NOT bool_or(
          member.replacement_status = 'replaced'
          OR (
            member.is_replacement
            AND member.status IN ('completed','packed','inspected','ready_for_shipping','shipped')
          )
        ) AS rejected_open,
      bool_or(
        member.rework_status IN ('pending','in_progress')
        OR member.status IN ('rework','rework_pending','rework_in_progress')
      ) AS rework_open,
      bool_or(
        member.replacement_status IN ('requested','in_production')
        OR member.status IN ('replacement_requested','replacement_in_production')
      )
        AND NOT bool_or(
          member.replacement_status = 'replaced'
          OR (
            member.is_replacement
            AND member.status IN ('completed','packed','inspected','ready_for_shipping','shipped')
          )
        ) AS replacement_open
    FROM members member
    GROUP BY member.logical_piece_id
  )
  SELECT
    count(*) FILTER (WHERE slot.rejected_open)::bigint,
    count(*) FILTER (WHERE slot.rework_open)::bigint,
    count(*) FILTER (WHERE slot.replacement_open)::bigint
  INTO v_rejected, v_rework, v_replacement
  FROM slots slot;

  v_is_complete := v_is_complete
    AND v_total_parts > 0
    AND coalesce(v_rejected, 0) = 0
    AND coalesce(v_rework, 0) = 0
    AND coalesce(v_replacement, 0) = 0;

  IF v_is_complete THEN
    v_completed_parts := v_total_parts;
  ELSE
    v_completed_parts := least(
      v_total_parts,
      floor(v_total_parts::numeric * coalesce(v_bottleneck, 0))::bigint
    );
  END IF;

  v_pending := greatest(v_total_parts - v_completed_parts, 0);
  v_progress_percent := CASE
    WHEN v_required_operations > 0
      THEN round((100.0 * v_completed_operations / v_required_operations)::numeric, 2)
    WHEN v_total_parts > 0
      THEN round((100.0 * v_completed_parts / v_total_parts)::numeric, 2)
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'success', true,
    'lot_id', p_lot_id,
    'pcp_import_batch_id', v_lot.pcp_import_batch_id,
    'total_parts', v_total_parts,
    'completed_parts', v_completed_parts,
    'pending_parts', v_pending,
    'rejected', coalesce(v_rejected, 0),
    'rework', coalesce(v_rework, 0),
    'replacement', coalesce(v_replacement, 0),
    'total_operations', v_required_operations,
    'completed_operations', v_completed_operations,
    'progress_percent', least(greatest(v_progress_percent, 0), 100),
    'is_complete', v_is_complete,
    'current_stage', coalesce(v_current_stage, CASE WHEN v_is_complete THEN 'completed' END),
    'current_stage_label', coalesce(v_current_stage_label, CASE WHEN v_is_complete THEN 'Concluído' END),
    'stages', v_stages
  );
END;
$function$
;
DROP FUNCTION public.production_piece_accounting_for_scope(uuid,uuid);

-- Source: 20260920160859_replacement_reconcile_lock_scope.sql

DO $rollback$
DECLARE definition text; needle text;
BEGIN
  definition:=pg_get_functiondef('public.reconcile_replacement_piece_trail(uuid)'::regprocedure);
  needle:='select * into v_piece from public.production_pieces where id = p_piece_id and is_replacement is true for no key update;';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'REPLACEMENT_LOCK_ROLLBACK_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,'select * into v_piece from public.production_pieces where id = p_piece_id for update;');
  definition:=pg_get_functiondef('public.sync_replacement_trail_from_reading()'::regprocedure);
  needle:=$old$  if tg_op = 'UPDATE' and
    row(old.piece_id, old.step_name, old.status) is not distinct from
    row(new.piece_id, new.step_name, new.status) then
    return null;
  end if;
$old$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'REPLACEMENT_TRIGGER_ROLLBACK_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,'');
END;
$rollback$;

-- Source: 20260920160503_collection_piece_lock_and_route_cost.sql
-- Roll back only this migration's three definition changes; preserve all facts.

DO $rollback$
DECLARE definition text; needle text; replacement text;
BEGIN
  definition:=pg_get_functiondef('private.process_collection_batch_v3(text,jsonb)'::regprocedure);
  needle:=E'FROM public.production_pieces piece\n        WHERE piece.id = v_item.piece_id\n        FOR NO KEY UPDATE;';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'ROLLBACK_DECISION_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,replace(needle,'FOR NO KEY UPDATE;','FOR UPDATE;'));
  definition:=pg_get_functiondef('public.get_collection_lot_route_metrics(uuid)'::regprocedure);
  IF position('stage_scope AS MATERIALIZED (' IN definition)=0 THEN RAISE EXCEPTION 'ROLLBACK_LOT_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,'stage_scope AS MATERIALIZED (','stage_scope AS (');
  definition:=pg_get_functiondef('public.get_collection_route_stage_metrics(uuid,uuid,text)'::regprocedure);
  needle:=$new$JOIN LATERAL (
        SELECT scoped.step_name
        FROM public.production_stage_readings scoped
        WHERE scoped.piece_id = member.id AND scoped.status = 'approved'
        OFFSET 0
      ) reading ON public.normalize_route_step_code(reading.step_name) = v_step_code$new$;
  replacement:=$old$JOIN public.production_stage_readings reading
        ON reading.piece_id = member.id
       AND public.normalize_route_step_code(reading.step_name) = v_step_code
       AND reading.status = 'approved'$old$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'ROLLBACK_STAGE_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(definition,needle,replacement);
END;
$rollback$;

-- Source: 20260920154917_collection_immediate_error_details.sql

CREATE OR REPLACE FUNCTION public.ingest_collection_batch_immediate_v3(p_batch_id uuid, p_device_id uuid, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pgmq', 'pg_temp'
AS $function$
DECLARE
 actor uuid:=auth.uid();
 worker text:='immediate:backend:'||pg_backend_pid()::text;
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
  VALUES(worker,'decision',clock_timestamp(),clock_timestamp(),jsonb_array_length(items))
  ON CONFLICT(worker_id) DO UPDATE SET
    worker_kind=excluded.worker_kind,
    invocation_id=NULL,
    started_at=excluded.started_at,
    heartbeat_at=excluded.heartbeat_at,
    finished_at=NULL,
    claimed_count=excluded.claimed_count,
    finalized_count=0,
    last_error_code=NULL;
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
$function$
;
CREATE OR REPLACE FUNCTION private.audit_collection_immediate_release_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT public.get_public_collection_runtime_health() AS value
  ),
  objects AS (
    SELECT
      to_regprocedure(
        'public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'
      ) AS immediate_rpc,
      to_regprocedure(
        'private.collection_immediate_context_active_v3()'
      ) AS immediate_context_function,
      to_regclass(
        'private.collection_immediate_context_v3'
      ) AS immediate_context_table
  ),
  definitions AS (
    SELECT coalesce(regexp_replace(
      lower(pg_get_functiondef(objects.immediate_rpc)),
      '[[:space:]]+',
      '',
      'g'
    ), '') AS immediate_rpc
    FROM objects
  ),
  rollout AS (
    SELECT
      coalesce(flag.enabled, false) AS enabled,
      coalesce(flag.rollout_scope, '{}'::jsonb) AS scope
    FROM (SELECT 1) AS seed
    LEFT JOIN private.collection_pipeline_flags flag
      ON flag.flag_name = 'collection_pipeline_v3_ingress'
  ),
  immediate_flags AS (
    SELECT jsonb_build_object(
      'collection_immediate_rpc_exists',
        objects.immediate_rpc IS NOT NULL,
      'collection_immediate_definition_approved',
        objects.immediate_rpc IS NOT NULL
        AND md5(pg_get_functiondef(objects.immediate_rpc))
          = '90ffa0ee5c0f4b6b82c3a92a7d056bcf',
      'collection_immediate_rpc_owner',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        ),
      'collection_immediate_rpc_security',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND function_row.prosecdef IS TRUE
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        )
        AND coalesce(
          has_function_privilege('authenticated', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('service_role', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_proc function_row,
               aclexplode(coalesce(
                 function_row.proacl,
                 acldefault('f', function_row.proowner)
               )) privilege
          WHERE function_row.oid = objects.immediate_rpc
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ),
      'collection_immediate_context_private',
        objects.immediate_context_table IS NOT NULL
        AND objects.immediate_context_function IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_class table_row
          WHERE table_row.oid = objects.immediate_context_table
            AND table_row.relrowsecurity IS TRUE
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('authenticated', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('service_role', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'anon', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'service_role', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        ),
      'collection_immediate_batch_limit_5',
        position('collection_immediate_batch_limit_5' IN definitions.immediate_rpc) > 0
        AND position('jsonb_array_length(p_events->''events'')>5' IN definitions.immediate_rpc) > 0,
      'collection_immediate_decision_committed',
        position('private.process_collection_batch_v3' IN definitions.immediate_rpc) > 0
        AND position('collection_immediate_decision_missing' IN definitions.immediate_rpc) > 0
        AND position('decision_committed_at' IN definitions.immediate_rpc) > 0,
      'collection_immediate_projection_async',
        position('private.process_collection_projection_batch_v3' IN definitions.immediate_rpc) = 0,
      'collection_immediate_rollout_all',
        rollout.enabled IS TRUE
        AND rollout.scope ->> 'immediate_rpc' = 'ingest_collection_batch_immediate_v3'
        AND coalesce((rollout.scope ->> 'immediate_max_events')::integer, 0) = 5
        AND coalesce((rollout.scope ->> 'all')::boolean, false) IS TRUE
    ) AS value
    FROM objects, definitions, rollout
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.value ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM immediate_flags, jsonb_each_text(immediate_flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', '20260908154004',
    'release_version', '20260908_acprod_collection_immediate_decision_v3',
    'gate_migration_version', '20260913043419',
    'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1_1',
    'transport', 'immediate_v3',
    'ingress_rpc', 'ingest_collection_batch_immediate_v3',
    'max_events_per_request', 5,
    'projection', 'async_v3_outbox',
    'schema_flags', immediate_flags.value
  )
  FROM base, immediate_flags;
$function$
;
UPDATE private.collection_immediate_release_snapshot_v1 SET expected_audit_function_hash='d5be4470cb4a9623487c95611914cb07' WHERE singleton;
SELECT private.refresh_collection_immediate_release_snapshot_v1();

-- Source: 20260920153320_collection_projector_lock_order.sql
-- Stop load and drain workers before rollback. Production facts are preserved.

CREATE OR REPLACE FUNCTION public.refresh_collection_lot_state(p_lot_id uuid, p_reading_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_lot public.production_lots%ROWTYPE;
  v_metrics jsonb;
  v_existing_version bigint;
  v_new_version bigint;
  v_is_complete boolean;
  v_completed_operations bigint;
  v_current_stage text;
  v_current_stage_label text;
BEGIN
  IF p_lot_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('production-lot:' || p_lot_id::text, 0));

  IF p_reading_id IS NOT NULL THEN
    SELECT reading.lot_state_version
    INTO v_existing_version
    FROM public.production_stage_readings reading
    WHERE reading.id = p_reading_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    IF v_existing_version IS NOT NULL THEN
      RETURN public.get_collection_lot_snapshot(p_lot_id);
    END IF;
  END IF;

  SELECT * INTO v_lot
  FROM public.production_lots
  WHERE id = p_lot_id
  FOR UPDATE;

  IF v_lot.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_metrics := public.get_collection_lot_route_metrics(p_lot_id);
  v_is_complete := coalesce((v_metrics ->> 'is_complete')::boolean, false);
  v_completed_operations := coalesce((v_metrics ->> 'completed_operations')::bigint, 0);
  v_current_stage := v_metrics ->> 'current_stage';
  v_current_stage_label := v_metrics ->> 'current_stage_label';

  UPDATE public.production_lots lot
  SET state_version = lot.state_version + 1,
      planned_quantity = coalesce((v_metrics ->> 'total_parts')::integer, lot.planned_quantity),
      progress_percent = coalesce((v_metrics ->> 'progress_percent')::numeric, 0),
      produced_quantity = coalesce((v_metrics ->> 'completed_parts')::numeric, 0),
      approved_quantity = coalesce((v_metrics ->> 'completed_parts')::numeric, 0),
      rejected_quantity = coalesce((v_metrics ->> 'rejected')::numeric, 0),
      pending_quantity = coalesce((v_metrics ->> 'pending_parts')::numeric, 0),
      missing_count = coalesce((v_metrics ->> 'pending_parts')::integer, 0),
      rework_count = coalesce((v_metrics ->> 'rework')::integer, 0),
      status = CASE
        WHEN v_is_complete THEN 'closed'
        WHEN v_completed_operations > 0 THEN 'in_progress'
        WHEN lot.status IN ('closed','shipped') THEN 'planned'
        ELSE lot.status
      END,
      current_status = CASE
        WHEN v_is_complete THEN 'completed'
        WHEN v_completed_operations > 0 THEN 'in_progress'
        ELSE coalesce(lot.current_status, lot.status)
      END,
      current_stage = coalesce(v_current_stage, lot.current_stage),
      current_step = coalesce(v_current_stage, lot.current_step),
      current_cell = coalesce(v_current_stage_label, lot.current_cell),
      actual_start = CASE
        WHEN v_completed_operations > 0 THEN coalesce(lot.actual_start, clock_timestamp())
        ELSE lot.actual_start
      END,
      actual_end = CASE WHEN v_is_complete THEN coalesce(lot.actual_end, clock_timestamp()) ELSE NULL END,
      closed_at = CASE WHEN v_is_complete THEN coalesce(lot.closed_at, clock_timestamp()) ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE lot.id = p_lot_id
  RETURNING lot.state_version INTO v_new_version;

  IF p_reading_id IS NOT NULL THEN
    UPDATE public.production_stage_readings
    SET lot_state_version = v_new_version
    WHERE id = p_reading_id;
  END IF;

  IF v_lot.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(v_lot.pcp_import_batch_id);
  END IF;

  RETURN public.get_collection_lot_snapshot(p_lot_id);
END;
$function$
;

NOTIFY pgrst, 'reload schema';
COMMIT;

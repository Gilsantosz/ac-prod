-- Reutiliza a linha de telemetria por conexão física; não cria uma por leitura.
-- O backend executa uma transação de cada vez, evitando disputa entre chamadas.
-- A autorização continua no marcador privado de usuário/transação/recibo.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 body text:=pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure);
 old_worker text:=$old$worker text:='immediate:'||gen_random_uuid()::text;$old$;
 old_heartbeat text:=$old$  VALUES(worker,'decision',clock_timestamp(),clock_timestamp(),jsonb_array_length(items));$old$;
 new_heartbeat text:=$new$  VALUES(worker,'decision',clock_timestamp(),clock_timestamp(),jsonb_array_length(items))
  ON CONFLICT(worker_id) DO UPDATE SET
    worker_kind=excluded.worker_kind,
    invocation_id=NULL,
    started_at=excluded.started_at,
    heartbeat_at=excluded.heartbeat_at,
    finished_at=NULL,
    claimed_count=excluded.claimed_count,
    finalized_count=0,
    last_error_code=NULL;$new$;
BEGIN
 IF md5(body)<>'e147cef4f1ad70afe37ede4a2b08237a' THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_WORKER_BASELINE_CHANGED';
 END IF;
 IF position(old_worker IN body)=0 OR position(old_heartbeat IN body)=0 THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_WORKER_SHAPE_CHANGED';
 END IF;
 body:=replace(body,old_worker,$new$worker text:='immediate:backend:'||pg_backend_pid()::text;$new$);
 body:=replace(body,old_heartbeat,new_heartbeat);
 EXECUTE body;
 IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))
    <>'90ffa0ee5c0f4b6b82c3a92a7d056bcf' THEN
  RAISE EXCEPTION 'COLLECTION_IMMEDIATE_WORKER_POSTCHECK_FAILED';
 END IF;
END;
$patch$;
NOTIFY pgrst,'reload schema';

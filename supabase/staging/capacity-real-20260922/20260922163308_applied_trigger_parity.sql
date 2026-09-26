-- Historical record of migration already applied to capacity-test only.
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s';
DO $guard$
BEGIN
 IF to_regprocedure('public.capacity_test_mes1150_create_run(uuid,text,bigint,text,text)') IS NULL OR to_regprocedure('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'CAPACITY_STAGE_BASELINE_CHANGED'; END IF;
 IF md5(pg_get_functiondef('public.sync_pcp_batch_progress_from_piece()'::regprocedure)) <> 'e0998ca91163fadf2ba231afc51c0ad5' THEN RAISE EXCEPTION 'CAPACITY_STAGE_TRIGGER_BASELINE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM pgmq.q_collection_live_v3) OR EXISTS(SELECT 1 FROM pgmq.q_collection_replay_v3) OR EXISTS(SELECT 1 FROM pgmq.q_collection_projection_v3) OR EXISTS(SELECT 1 FROM public.collection_projection_outbox WHERE projected_at IS NULL AND dead_lettered_at IS NULL) THEN RAISE EXCEPTION 'CAPACITY_STAGE_QUEUES_NOT_DRAINED'; END IF;
END;
$guard$;
CREATE TABLE private.capacity_20260922_definition_backup(signature text PRIMARY KEY,definition text NOT NULL,definition_md5 text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE private.capacity_20260922_definition_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.capacity_20260922_definition_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.capacity_20260922_definition_backup(signature,definition,definition_md5) SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid),md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid IN ('public.sync_pcp_batch_progress_from_piece()'::regprocedure,'private.process_collection_batch_v3(text,jsonb)'::regprocedure);
CREATE OR REPLACE FUNCTION public.sync_pcp_batch_progress_from_piece()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF current_setting('acprod.collection_v3_decision', true) = 'on'
     AND coalesce(auth.role(), '') = 'service_role' THEN
    -- The decision writes its durable projection outbox in the same transaction.
    -- No shared import-batch row is updated while the piece locks are held.
    RETURN NEW;
  END IF;
  -- Preserve production's existing import guard: the import RPC performs
  -- one authoritative batch refresh after attaching its new pieces.
  IF OLD.pcp_import_batch_id IS NULL AND NEW.pcp_import_batch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.pcp_import_batch_id IS DISTINCT FROM NEW.pcp_import_batch_id
     AND OLD.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(OLD.pcp_import_batch_id);
  END IF;
  IF NEW.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(NEW.pcp_import_batch_id);
  END IF;
  RETURN NEW;
END;
$function$;
DO $postcheck$ BEGIN IF md5(pg_get_functiondef('public.sync_pcp_batch_progress_from_piece()'::regprocedure))<>'06ebbec1fcd7fef010449b94dc859801' THEN RAISE EXCEPTION 'CAPACITY_STAGE_TRIGGER_PARITY_FAILED'; END IF; END; $postcheck$;
NOTIFY pgrst,'reload schema';
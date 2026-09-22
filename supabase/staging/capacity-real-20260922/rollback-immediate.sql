-- PROPOSED ROLLBACK, NOT EXECUTED OR HOMOLOGATED.
-- Staging only, after stopping runners and draining queues. Review before use.
-- Restores saved definitions; does not erase migration history or remove fixture helpers.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $rollback$
DECLARE b record;
BEGIN
 IF current_user<>'postgres' OR to_regclass('private.capacity_20260922_definition_backup') IS NULL THEN RAISE EXCEPTION 'STAGING_ONLY'; END IF;
 IF md5(pg_get_functiondef('public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'::regprocedure))<>'90ffa0ee5c0f4b6b82c3a92a7d056bcf'
 OR md5(pg_get_functiondef('private.process_collection_batch_v3(text,jsonb)'::regprocedure))<>'0aeb456f60de5e681884d2901ecd515c'
 OR md5(pg_get_functiondef('public.sync_pcp_batch_progress_from_piece()'::regprocedure))<>'8706873317b0d09c9e7778bb901f21dc' THEN RAISE EXCEPTION 'ROLLBACK_BASELINE_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM pgmq.q_collection_live_v3) OR EXISTS(SELECT 1 FROM pgmq.q_collection_replay_v3)
 OR EXISTS(SELECT 1 FROM pgmq.q_collection_projection_v3) OR EXISTS(SELECT 1 FROM public.collection_projection_outbox WHERE projected_at IS NULL AND dead_lettered_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.capacity_test_runs WHERE runner_instance_id IS NOT NULL AND runner_stopped_at IS NULL)
 THEN RAISE EXCEPTION 'ROLLBACK_REQUIRES_STOPPED_AND_DRAINED'; END IF;
 IF (SELECT count(*) FROM private.capacity_20260922_definition_backup)<>2
 OR NOT EXISTS(SELECT 1 FROM private.capacity_20260922_definition_backup WHERE signature='sync_pcp_batch_progress_from_piece()')
 OR NOT EXISTS(SELECT 1 FROM private.capacity_20260922_definition_backup WHERE signature='private.process_collection_batch_v3(text,jsonb)')
 THEN RAISE EXCEPTION 'BACKUP_SCOPE_CHANGED'; END IF;
 FOR b IN SELECT * FROM private.capacity_20260922_definition_backup LOOP
  IF md5(b.definition)<>b.definition_md5 THEN RAISE EXCEPTION 'BACKUP_CHECKSUM_MISMATCH'; END IF;
  EXECUTE b.definition;
 END LOOP;
END;$rollback$;
DROP FUNCTION public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb);
DROP FUNCTION private.collection_immediate_context_active_v3();
DROP TABLE private.collection_immediate_context_v3;
UPDATE private.collection_pipeline_flags SET rollout_scope=rollout_scope-'immediate_rpc'-'immediate_max_events',updated_at=clock_timestamp()
 WHERE flag_name='collection_pipeline_v3_ingress';
NOTIFY pgrst,'reload schema';

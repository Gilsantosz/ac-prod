-- A cached dashboard is valid only for the import revision it actually read.
-- External PCP/quality edits invalidate it without serving indefinitely stale totals.
ALTER TABLE private.collection_dashboard_batch_snapshots
  ADD COLUMN IF NOT EXISTS source_batch_updated_at timestamptz;

DO $revision$
DECLARE v_definition text;
BEGIN
  v_definition := pg_get_functiondef('private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)'::regprocedure);
  IF position('source_batch_updated_at' IN v_definition) = 0 THEN
    IF position('rework_count, replacement_count, snapshot_at' IN v_definition) = 0
       OR position('statement_timestamp()' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'COLLECTION_BATCH_CACHE_REVISION_SHAPE_CHANGED';
    END IF;
    v_definition := replace(v_definition, 'rework_count, replacement_count, snapshot_at',
      'rework_count, replacement_count, source_batch_updated_at, snapshot_at');
    v_definition := replace(v_definition, E'    statement_timestamp()\n',
      E'    (SELECT batch.updated_at FROM public.promob_import_batches batch WHERE batch.id = p_pcp_import_batch_id),\n    statement_timestamp()\n');
    v_definition := replace(v_definition, 'snapshot_at = excluded.snapshot_at,',
      'source_batch_updated_at = excluded.source_batch_updated_at, snapshot_at = excluded.snapshot_at,');
    EXECUTE v_definition;
  END IF;

  v_definition := pg_get_functiondef('public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure);
  IF position('source_batch_updated_at' IN v_definition) = 0 THEN
    IF position('FROM private.collection_dashboard_batch_snapshots cache' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'COLLECTION_BATCH_CACHE_READ_SHAPE_CHANGED';
    END IF;
    v_definition := replace(v_definition,
      'FROM private.collection_dashboard_batch_snapshots cache',
      E'FROM private.collection_dashboard_batch_snapshots cache\n    JOIN public.promob_import_batches batch ON batch.id = cache.pcp_import_batch_id\n      AND cache.source_batch_updated_at IS NOT DISTINCT FROM batch.updated_at');
    EXECUTE v_definition;
  END IF;
END;
$revision$;
NOTIFY pgrst, 'reload schema';

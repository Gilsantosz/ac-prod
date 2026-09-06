-- Import batches predate updated_at. Add an explicit read-model revision clock
-- without relying on a column that does not exist in the isolated schema.
ALTER TABLE public.promob_import_batches
  ADD COLUMN IF NOT EXISTS collection_snapshot_updated_at timestamptz;

CREATE OR REPLACE FUNCTION private.stamp_collection_batch_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $stamp$
BEGIN
  NEW.collection_snapshot_updated_at := clock_timestamp();
  RETURN NEW;
END;
$stamp$;
REVOKE ALL ON FUNCTION private.stamp_collection_batch_revision() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_collection_batch_revision
  BEFORE INSERT OR UPDATE ON public.promob_import_batches
  FOR EACH ROW EXECUTE FUNCTION private.stamp_collection_batch_revision();

DO $fix$
DECLARE v_definition text;
BEGIN
  v_definition := pg_get_functiondef('private.refresh_collection_dashboard_batch_snapshot(uuid,text,text)'::regprocedure);
  EXECUTE replace(v_definition, 'SELECT batch.updated_at FROM public.promob_import_batches',
     'SELECT batch.collection_snapshot_updated_at FROM public.promob_import_batches');
  v_definition := pg_get_functiondef('public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure);
  EXECUTE replace(v_definition, 'cache.source_batch_updated_at IS NOT DISTINCT FROM batch.updated_at',
     'cache.source_batch_updated_at IS NOT DISTINCT FROM batch.collection_snapshot_updated_at');
END;
$fix$;
NOTIFY pgrst, 'reload schema';

-- Keep pg-safeupdate enabled in PostgREST sessions. The success worktable is
-- transaction-local, but UPDATE still requires an explicit qualified scope.
DO $patch$
DECLARE
  v_definition text := pg_get_functiondef(
    'private.process_collection_projection_batch_v3(text,jsonb)'::regprocedure
  );
  v_unqualified text := 'UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now;';
BEGIN
  IF position(v_unqualified IN v_definition) = 0 THEN
    RAISE EXCEPTION 'COLLECTION_V3_SAFEUPDATE_PROJECTOR_SHAPE_CHANGED';
  END IF;
  v_definition := replace(v_definition, v_unqualified,
    'UPDATE pg_temp.collection_v3_projection_success SET projected_at = v_now WHERE outbox_id IS NOT NULL;');
  EXECUTE v_definition;
END;
$patch$;

NOTIFY pgrst, 'reload schema';

BEGIN;

SELECT public.assert_collection_projection_schema_v3();

DO $$
BEGIN
  IF to_regclass('private.collection_worker_leases_v3') IS NULL THEN
    RAISE EXCEPTION 'collection_worker_leases_v3 missing';
  END IF;
  IF to_regprocedure('public.acquire_collection_worker_lease_v3(text,text,integer)') IS NULL
     OR to_regprocedure('public.begin_collection_worker_lease_v3(text,text,text,integer)') IS NULL
     OR to_regprocedure('public.renew_collection_worker_lease_v3(text,text,integer)') IS NULL
     OR to_regprocedure('public.claim_collection_worker_batch_v3(text,text,text,integer)') IS NULL
     OR to_regprocedure('public.release_collection_worker_lease_v3(text,text)') IS NULL THEN
    RAISE EXCEPTION 'worker lease RPC contract missing';
  END IF;
  IF has_table_privilege('anon', 'private.collection_worker_leases_v3', 'SELECT')
     OR has_table_privilege('authenticated', 'private.collection_worker_leases_v3', 'SELECT') THEN
    RAISE EXCEPTION 'worker lease table leaked through grants';
  END IF;
END;
$$;

ROLLBACK;

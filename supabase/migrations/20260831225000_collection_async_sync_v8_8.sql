-- AC.Prod2 v8.8c — marcador público seguro e fail-closed do release.

ALTER TABLE public.app_schema_releases
  ADD COLUMN IF NOT EXISTS migration_version text,
  ADD COLUMN IF NOT EXISTS ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schema_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

WITH base AS (
  SELECT public.get_public_collection_release() AS release
),
ingress_definition AS (
  SELECT lower(pg_get_functiondef(
    'public.process_coleta_producao_ingress()'::regprocedure
  )) AS definition
),
hotpath_definition AS (
  SELECT lower(pg_get_functiondef(
    'public.process_production_reading_impl_v2(jsonb)'::regprocedure
  )) AS definition
),
wake_definition AS (
  SELECT lower(pg_get_functiondef(
    'private.wake_collection_inbox_worker(text,integer)'::regprocedure
  )) AS definition
),
dashboard_definition AS (
  SELECT lower(pg_get_functiondef(
    'public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamp with time zone)'::regprocedure
  )) AS definition
),
shift_definitions AS (
  SELECT
    count(*) AS overloads,
    bool_and(
      position('production_stage_readings' in lower(pg_get_functiondef(p.oid))) > 0
    ) AS uses_stage_ledger,
    bool_and(
      position('join public.production_collection_events' in lower(pg_get_functiondef(p.oid))) = 0
    ) AS avoids_event_join
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_operator_shift_kpis_v2'
),
flags AS (
  SELECT jsonb_build_object(
    'collection_async_inbox_columns',
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'coletas_producao'
          AND column_name = 'attempt_count'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'coletas_producao'
          AND column_name = 'lease_expires_at'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'coletas_producao'
          AND column_name = 'queue_delay_ms'
      ),
    'collection_async_ingress_is_lightweight',
      (
        SELECT position('coleta_producao_credentials' in definition) > 0
           AND position('process_production_reading_v2' in definition) = 0
        FROM ingress_definition
      ),
    'collection_async_private_credentials',
      to_regclass('private.coleta_producao_credentials') IS NOT NULL
      AND NOT has_table_privilege(
        'authenticated',
        'private.coleta_producao_credentials',
        'SELECT'
      )
      AND NOT has_table_privilege(
        'service_role',
        'private.coleta_producao_credentials',
        'SELECT'
      ),
    'collection_async_worker_rpcs',
      to_regprocedure(
        'public.claim_collection_inbox(text,integer)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.process_collection_inbox_item(uuid,text)'
      ) IS NOT NULL
      AND has_function_privilege(
        'service_role',
        'public.claim_collection_inbox(text,integer)',
        'EXECUTE'
      )
      AND has_function_privilege(
        'service_role',
        'public.process_collection_inbox_item(uuid,text)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'public.claim_collection_inbox(text,integer)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'public.process_collection_inbox_item(uuid,text)',
        'EXECUTE'
      ),
    'collection_async_session_lock_removed',
      (
        SELECT position('for update of session' in definition) = 0
        FROM hotpath_definition
      ),
    'collection_async_realtime',
      EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'coletas_producao'
      ),
    'collection_async_wakeup_trigger',
      EXISTS (
        SELECT 1 FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.coletas_producao'::regclass
          AND trigger_row.tgname = 'trg_wake_collection_inbox_worker'
          AND trigger_row.tgenabled <> 'D'
      ),
    'collection_async_fallback_cron',
      EXISTS (
        SELECT 1 FROM cron.job
        WHERE jobname = 'run-process-collection-inbox'
          AND active IS TRUE
          AND schedule = '* * * * *'
      ),
    'collection_async_vault_secrets',
      EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'acprod_collection_worker_secret'
      )
      AND EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'acprod_collection_worker_url'
      ),
    'collection_async_worker_concurrency_bounded',
      (
        SELECT position('''concurrency'', 4' in definition) > 0
        FROM wake_definition
      ),
    'collection_event_payload_sanitizer',
      EXISTS (
        SELECT 1 FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'public.production_collection_events'::regclass
          AND trigger_row.tgname = 'trg_sanitize_collection_event_payload'
          AND trigger_row.tgenabled <> 'D'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.production_collection_events event
        WHERE event.payload ?| ARRAY[
                'operatorSessionToken',
                'operator_session_token',
                'session_token'
              ]
           OR event.result_payload ?| ARRAY[
                'operatorSessionToken',
                'operator_session_token',
                'session_token'
              ]
      ),
    'collection_dashboard_state_cache',
      (
        SELECT position('production_cell_lot_states' in definition) > 0
        FROM dashboard_definition
      ),
    'collection_shift_kpis_direct_stage_index',
      (
        SELECT overloads = 2
           AND uses_stage_ledger IS TRUE
           AND avoids_event_join IS TRUE
        FROM shift_definitions
      )
      AND to_regclass(
        'public.idx_stage_readings_operator_created_status'
      ) IS NOT NULL
  ) AS value
),
release_row AS (
  SELECT
    '20260831_acprod_collection_async_sync_v8_8'::text AS version,
    'v8.8'::text AS migration_version,
    'async-ack-final-poll-cache-dashboard-realtime-coalescing'::text AS checksum,
    'Processamento assíncrono real, tokens removidos do ledger, dashboard em cache transacional, KPIs de turno sem join e worker com concorrência controlada.'::text AS notes,
    (
      coalesce((base.release ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM flags, jsonb_each_text(flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      )
    ) AS ready,
    (base.release -> 'schema_flags') || flags.value AS schema_flags
  FROM base, flags
)
INSERT INTO public.app_schema_releases (
  version,
  migration_version,
  checksum,
  notes,
  ready,
  schema_flags
)
SELECT
  version,
  migration_version,
  checksum,
  notes,
  ready,
  schema_flags
FROM release_row
ON CONFLICT (version) DO UPDATE
SET migration_version = excluded.migration_version,
    checksum = excluded.checksum,
    notes = excluded.notes,
    ready = excluded.ready,
    schema_flags = excluded.schema_flags,
    applied_at = clock_timestamp();

CREATE OR REPLACE FUNCTION public.get_public_collection_async_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'ready', release.ready,
    'migration_version', release.migration_version,
    'release_version', release.version,
    'schema_flags', release.schema_flags,
    'applied_at', release.applied_at
  )
  FROM public.app_schema_releases release
  WHERE release.version = '20260831_acprod_collection_async_sync_v8_8'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_async_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_async_release()
  TO anon, authenticated;;

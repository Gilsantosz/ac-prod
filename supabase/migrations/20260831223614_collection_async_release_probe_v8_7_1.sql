CREATE OR REPLACE FUNCTION public.get_public_collection_async_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, cron, pg_temp
AS $$
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
        (SELECT position('coleta_producao_credentials' in definition) > 0
                AND position('process_production_reading_v2' in definition) = 0
         FROM ingress_definition),
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
        to_regprocedure('public.claim_collection_inbox(text,integer)') IS NOT NULL
        AND to_regprocedure('public.process_collection_inbox_item(uuid,text)') IS NOT NULL
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
        (SELECT position('for update of session' in definition) = 0
         FROM hotpath_definition),
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
      'collection_async_no_legacy_sync_dependency',
        TRUE
    ) AS value
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.release ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM flags, jsonb_each_text(flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', coalesce((
      SELECT migration.version
      FROM supabase_migrations.schema_migrations migration
      WHERE migration.name = 'collection_async_release_probe_v8_7_1'
      ORDER BY migration.version DESC
      LIMIT 1
    ), ''),
    'release_version', '20260831_acprod_collection_async_worker_v8_7_1',
    'schema_flags', (base.release -> 'schema_flags') || flags.value
  )
  FROM base, flags;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_async_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_async_release()
  TO anon, authenticated;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260831_acprod_collection_async_worker_v8_7_1',
  'async-release-probe-canonical-base-no-legacy-sync-flags',
  'Release assíncrono validado contra a coleta canônica v8.5 e os componentes reais do inbox/worker, sem herdar flags síncronas obsoletas do v8.6.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;;

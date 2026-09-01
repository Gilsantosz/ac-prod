-- AC.Prod2 v9.2.2 — saúde dinâmica e fail-closed da coleta em produção.
--
-- O marcador v8.8 persistia uma fotografia dos flags em app_schema_releases.
-- Este probe não consulta essa fotografia: cada chamada recompõe a saúde real
-- a partir do catálogo, privilégios, definições, triggers, publication, Vault,
-- cron e índices que sustentam o caminho assíncrono atual.

-- A Edge Function pode concluir um lote depois do antigo timeout de 2s do
-- pg_net. Mantemos exatamente o worker final v9.2, ampliando apenas a janela
-- HTTP para evitar falsos timeouts enquanto o processamento continua na Edge.
CREATE OR REPLACE FUNCTION private.wake_collection_inbox_worker(
  p_source text DEFAULT 'database',
  p_limit integer DEFAULT 60
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, net, pg_temp
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.coletas_producao inbox
    WHERE (
      inbox.status_sincronizacao = 'recebida'
      AND coalesce(inbox.next_attempt_at, '-infinity'::timestamptz)
        <= clock_timestamp()
    ) OR (
      inbox.status_sincronizacao = 'processando'
      AND coalesce(inbox.lease_expires_at, '-infinity'::timestamptz)
        <= clock_timestamp()
    )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret
  INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_url'
  LIMIT 1;

  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'acprod_collection_worker_secret'
  LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'source', coalesce(nullif(btrim(p_source), ''), 'database'),
      'limit', greatest(1, least(coalesce(p_limit, 60), 100)),
      'concurrency', 8,
      'max_rounds', 5
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    timeout_milliseconds := 30000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.wake_collection_inbox_worker(text, integer)
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.get_public_collection_runtime_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, cron, pg_temp
AS $runtime_health$
  WITH objects AS (
    SELECT
      to_regclass('public.coletas_producao') AS inbox_table,
      to_regclass('private.coleta_producao_credentials') AS credentials_table,
      to_regclass('public.production_collection_events') AS event_table,
      to_regprocedure('public.process_coleta_producao_ingress()') AS ingress_function,
      to_regprocedure('public.claim_collection_inbox(text,integer)') AS claim_function,
      to_regprocedure('public.process_collection_inbox_item(uuid,text)') AS process_function,
      to_regprocedure('public.verify_collection_worker_cron_secret(text)') AS verify_secret_function,
      to_regprocedure('private.wake_collection_inbox_worker(text,integer)') AS wake_function,
      to_regprocedure('private.notify_collection_inbox_worker()') AS notify_function,
      to_regprocedure('private.sanitize_collection_event_payload()') AS sanitizer_function,
      to_regprocedure('public.process_production_reading_impl_v2(jsonb)') AS hotpath_function,
      to_regprocedure(
        'public.get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamptz)'
      ) AS dashboard_function,
      to_regprocedure(
        'public.get_operator_shift_kpis_v2(text,timestamptz)'
      ) AS token_kpi_function,
      to_regprocedure(
        'public.get_operator_shift_kpis_v2(uuid,timestamptz)'
      ) AS uuid_kpi_function,
      to_regprocedure(
        'public.resolve_operator_shift_window(uuid,timestamptz)'
      ) AS shift_window_function,
      to_regclass(
        'public.idx_collection_events_operator_window_cover_v89'
      ) AS operator_index,
      to_regclass(
        'public.idx_manual_production_batch_stage_approved_v89'
      ) AS manual_index,
      to_regclass(
        'public.idx_coletas_producao_worker_claim_v89'
      ) AS claim_index
  ),
  definitions AS (
    SELECT
      coalesce(lower(pg_get_functiondef(objects.ingress_function)), '')
        AS ingress_definition,
      coalesce(lower(pg_get_functiondef(objects.claim_function)), '')
        AS claim_definition,
      coalesce(lower(pg_get_functiondef(objects.process_function)), '')
        AS process_definition,
      coalesce(lower(pg_get_functiondef(objects.wake_function)), '')
        AS wake_definition,
      coalesce(lower(pg_get_functiondef(objects.sanitizer_function)), '')
        AS sanitizer_definition,
      coalesce(lower(pg_get_functiondef(objects.hotpath_function)), '')
        AS hotpath_definition,
      coalesce(lower(pg_get_functiondef(objects.dashboard_function)), '')
        AS dashboard_definition,
      coalesce(lower(pg_get_functiondef(objects.token_kpi_function)), '')
        AS token_kpi_definition,
      coalesce(lower(pg_get_functiondef(objects.uuid_kpi_function)), '')
        AS uuid_kpi_definition,
      coalesce(lower(pg_get_functiondef(objects.shift_window_function)), '')
        AS shift_window_definition,
      coalesce(lower(pg_get_indexdef(objects.operator_index)), '')
        AS operator_index_definition,
      coalesce(lower(pg_get_indexdef(objects.manual_index)), '')
        AS manual_index_definition,
      coalesce(lower(pg_get_indexdef(objects.claim_index)), '')
        AS claim_index_definition
    FROM objects
  ),
  legacy_release AS (
    -- Este marcador também é calculado em tempo de chamada; não lê a tabela
    -- app_schema_releases e preserva as verificações v8.5/reposição existentes.
    SELECT public.get_public_collection_release() AS value
  ),
  async_flags AS (
    SELECT jsonb_build_object(
      'collection_async_inbox_columns',
        objects.inbox_table IS NOT NULL
        AND (
          SELECT count(*) = 7
          FROM information_schema.columns column_row
          WHERE column_row.table_schema = 'public'
            AND column_row.table_name = 'coletas_producao'
            AND column_row.column_name = ANY (ARRAY[
              'attempt_count',
              'next_attempt_at',
              'lease_expires_at',
              'worker_id',
              'last_error_code',
              'last_error_at',
              'queue_delay_ms'
            ])
        ),
      'collection_runtime_inbox_rls',
        objects.inbox_table IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_class table_row
          WHERE table_row.oid = objects.inbox_table
            AND table_row.relrowsecurity IS TRUE
        )
        AND coalesce(
          has_table_privilege('authenticated', objects.inbox_table, 'INSERT'),
          false
        )
        AND coalesce(
          has_table_privilege('authenticated', objects.inbox_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.inbox_table, 'INSERT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.inbox_table, 'SELECT'),
          false
        )
        AND EXISTS (
          SELECT 1
          FROM pg_policies policy
          WHERE policy.schemaname = 'public'
            AND policy.tablename = 'coletas_producao'
            AND policy.policyname = 'coletas_producao_insert_own'
        )
        AND EXISTS (
          SELECT 1
          FROM pg_policies policy
          WHERE policy.schemaname = 'public'
            AND policy.tablename = 'coletas_producao'
            AND policy.policyname = 'coletas_producao_select_own'
        ),
      'collection_async_ingress_is_lightweight',
        objects.ingress_function IS NOT NULL
        AND position('coleta_producao_credentials' in definitions.ingress_definition) > 0
        AND position('process_production_reading_v2' in definitions.ingress_definition) = 0,
      'collection_runtime_ingress_trigger',
        objects.ingress_function IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          WHERE trigger_row.tgrelid = objects.inbox_table
            AND trigger_row.tgname = 'trg_process_coleta_producao_ingress'
            AND trigger_row.tgfoid = objects.ingress_function
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal IS FALSE
            AND position(
              'before insert'
              in lower(pg_get_triggerdef(trigger_row.oid))
            ) > 0
        ),
      'collection_async_private_credentials',
        objects.credentials_table IS NOT NULL
        AND (
          SELECT count(*) = 5
          FROM information_schema.columns column_row
          WHERE column_row.table_schema = 'private'
            AND column_row.table_name = 'coleta_producao_credentials'
            AND column_row.column_name = ANY (ARRAY[
              'coleta_id',
              'auth_user_id',
              'session_token',
              'created_at',
              'expires_at'
            ])
        )
        AND NOT coalesce(
          has_table_privilege(
            'authenticated',
            objects.credentials_table,
            'SELECT'
          ),
          false
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.credentials_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('service_role', objects.credentials_table, 'SELECT'),
          false
        ),
      'collection_async_worker_rpcs',
        objects.claim_function IS NOT NULL
        AND objects.process_function IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_proc function_row
          WHERE function_row.oid = objects.claim_function
            AND function_row.prosecdef IS TRUE
        )
        AND EXISTS (
          SELECT 1 FROM pg_proc function_row
          WHERE function_row.oid = objects.process_function
            AND function_row.prosecdef IS TRUE
        )
        AND position('for update skip locked' in definitions.claim_definition) > 0
        AND position('lease_expires_at' in definitions.claim_definition) > 0
        AND position('next_attempt_at' in definitions.claim_definition) > 0
        AND position('coleta_producao_credentials' in definitions.process_definition) > 0
        AND position('process_production_reading_v2' in definitions.process_definition) > 0
        AND coalesce(
          has_function_privilege(
            'service_role',
            objects.claim_function,
            'EXECUTE'
          ),
          false
        )
        AND coalesce(
          has_function_privilege(
            'service_role',
            objects.process_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated',
            objects.claim_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated',
            objects.process_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.claim_function, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.process_function, 'EXECUTE'),
          false
        ),
      'collection_runtime_worker_secret_verifier',
        objects.verify_secret_function IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pg_proc function_row
          WHERE function_row.oid = objects.verify_secret_function
            AND function_row.prosecdef IS TRUE
        )
        AND coalesce(
          has_function_privilege(
            'service_role',
            objects.verify_secret_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated',
            objects.verify_secret_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'anon',
            objects.verify_secret_function,
            'EXECUTE'
          ),
          false
        ),
      'collection_async_vault_secrets',
        EXISTS (
          SELECT 1
          FROM vault.decrypted_secrets secret
          WHERE secret.name = 'acprod_collection_worker_secret'
            AND nullif(btrim(secret.decrypted_secret), '') IS NOT NULL
        )
        AND EXISTS (
          SELECT 1
          FROM vault.decrypted_secrets secret
          WHERE secret.name = 'acprod_collection_worker_url'
            AND secret.decrypted_secret =
              'https://uozuzdfvnufsjsonswag.supabase.co/functions/v1/process-collection-inbox'
        ),
      'collection_async_realtime',
        objects.inbox_table IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_publication_tables publication_table
          WHERE publication_table.pubname = 'supabase_realtime'
            AND publication_table.schemaname = 'public'
            AND publication_table.tablename = 'coletas_producao'
        ),
      'collection_async_wakeup_trigger',
        objects.notify_function IS NOT NULL
        AND objects.wake_function IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          WHERE trigger_row.tgrelid = objects.inbox_table
            AND trigger_row.tgname = 'trg_wake_collection_inbox_worker'
            AND trigger_row.tgfoid = objects.notify_function
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal IS FALSE
            AND position(
              'after insert'
              in lower(pg_get_triggerdef(trigger_row.oid))
            ) > 0
            AND position(
              'referencing new table'
              in lower(pg_get_triggerdef(trigger_row.oid))
            ) > 0
        )
        AND coalesce(
          has_function_privilege(
            'service_role',
            objects.wake_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated',
            objects.wake_function,
            'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.wake_function, 'EXECUTE'),
          false
        ),
      'collection_async_fallback_cron',
        EXISTS (
          SELECT 1
          FROM cron.job cron_job
          WHERE cron_job.jobname = 'run-process-collection-inbox'
            AND cron_job.active IS TRUE
            AND cron_job.schedule = '15 seconds'
            AND position(
              'wake_collection_inbox_worker'
              in lower(cron_job.command)
            ) > 0
        ),
      'collection_async_session_lock_removed',
        objects.hotpath_function IS NOT NULL
        AND position('for update of session' in definitions.hotpath_definition) = 0,
      'collection_event_payload_sanitizer',
        objects.sanitizer_function IS NOT NULL
        AND position('operatorsessiontoken' in definitions.sanitizer_definition) > 0
        AND position('operator_session_token' in definitions.sanitizer_definition) > 0
        AND position('session_token' in definitions.sanitizer_definition) > 0
        AND EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          WHERE trigger_row.tgrelid = objects.event_table
            AND trigger_row.tgname = 'trg_sanitize_collection_event_payload'
            AND trigger_row.tgfoid = objects.sanitizer_function
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal IS FALSE
        ),
      'collection_dashboard_state_cache',
        objects.dashboard_function IS NOT NULL
        AND position(
          'production_cell_lot_states'
          in definitions.dashboard_definition
        ) > 0
        AND coalesce(
          has_function_privilege(
            'authenticated',
            objects.dashboard_function,
            'EXECUTE'
          ),
          false
        ),
      'collection_async_worker_concurrency_bounded',
        objects.wake_function IS NOT NULL
        AND position('''concurrency'', 8' in definitions.wake_definition) > 0
        AND position('''max_rounds'', 5' in definitions.wake_definition) > 0,
      'collection_runtime_worker_timeout_30s',
        objects.wake_function IS NOT NULL
        AND position(
          'timeout_milliseconds := 30000'
          in definitions.wake_definition
        ) > 0
    ) AS value
    FROM objects, definitions
  ),
  sync_flags AS (
    SELECT jsonb_build_object(
      'collection_sync_operator_kpis_event_ledger',
        objects.token_kpi_function IS NOT NULL
        AND objects.uuid_kpi_function IS NOT NULL
        AND position(
          'production_collection_events'
          in definitions.token_kpi_definition
        ) > 0
        AND position(
          'production_stage_readings'
          in definitions.token_kpi_definition
        ) = 0
        AND position(
          'production_collection_events'
          in definitions.uuid_kpi_definition
        ) > 0
        AND position(
          'production_stage_readings'
          in definitions.uuid_kpi_definition
        ) = 0,
      'collection_sync_operator_covering_index',
        objects.operator_index IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_index index_row
          WHERE index_row.indexrelid = objects.operator_index
            AND index_row.indisvalid IS TRUE
            AND index_row.indisready IS TRUE
        )
        AND position(
          'production_collection_events'
          in definitions.operator_index_definition
        ) > 0
        AND position('operator_id' in definitions.operator_index_definition) > 0
        AND position('occurred_at' in definitions.operator_index_definition) > 0,
      'collection_sync_manual_stage_index',
        objects.manual_index IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_index index_row
          WHERE index_row.indexrelid = objects.manual_index
            AND index_row.indisvalid IS TRUE
            AND index_row.indisready IS TRUE
        )
        AND position(
          'manual_production_records'
          in definitions.manual_index_definition
        ) > 0
        AND position('pcp_import_batch_id' in definitions.manual_index_definition) > 0
        AND position('stage_code' in definitions.manual_index_definition) > 0,
      'collection_sync_worker_claim_index',
        objects.claim_index IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_index index_row
          WHERE index_row.indexrelid = objects.claim_index
            AND index_row.indisvalid IS TRUE
            AND index_row.indisready IS TRUE
        )
        AND position('coletas_producao' in definitions.claim_index_definition) > 0
        AND position('status_sincronizacao' in definitions.claim_index_definition) > 0
        AND position('next_attempt_at' in definitions.claim_index_definition) > 0,
      'collection_sync_worker_five_rounds',
        objects.wake_function IS NOT NULL
        AND position('''max_rounds'', 5' in definitions.wake_definition) > 0,
      'collection_sync_idle_wakeup_guard',
        objects.wake_function IS NOT NULL
        AND position('if not exists' in definitions.wake_definition) > 0
        AND position(
          'status_sincronizacao = ''recebida'''
          in definitions.wake_definition
        ) > 0
        AND position(
          'status_sincronizacao = ''processando'''
          in definitions.wake_definition
        ) > 0
        AND position('lease_expires_at' in definitions.wake_definition) > 0
        AND position('return null' in definitions.wake_definition) > 0,
      'collection_sync_fallback_fifteen_seconds',
        EXISTS (
          SELECT 1
          FROM cron.job cron_job
          WHERE cron_job.jobname = 'run-process-collection-inbox'
            AND cron_job.active IS TRUE
            AND cron_job.schedule = '15 seconds'
            AND position(
              'wake_collection_inbox_worker'
              in lower(cron_job.command)
            ) > 0
        ),
      'collection_sync_shift_window_constant_time',
        objects.shift_window_function IS NOT NULL
        AND position(
          'pg_timezone_names'
          in definitions.shift_window_definition
        ) = 0
        AND position(
          'exception when invalid_parameter_value'
          in definitions.shift_window_definition
        ) > 0,
      'collection_sync_async_idle_flag',
        objects.wake_function IS NOT NULL
        AND position('if not exists' in definitions.wake_definition) > 0
        AND position('lease_expires_at' in definitions.wake_definition) > 0
        AND position('return null' in definitions.wake_definition) > 0,
      'collection_sync_async_fallback_15s_flag',
        EXISTS (
          SELECT 1
          FROM cron.job cron_job
          WHERE cron_job.jobname = 'run-process-collection-inbox'
            AND cron_job.active IS TRUE
            AND cron_job.schedule = '15 seconds'
        )
    ) AS value
    FROM objects, definitions
  ),
  runtime_flags AS (
    SELECT
      async_flags.value
      || sync_flags.value
      || jsonb_build_object(
        'collection_sync_async_base_ready',
          NOT EXISTS (
            SELECT 1
            FROM jsonb_each_text(async_flags.value) flag
            WHERE flag.value IS DISTINCT FROM 'true'
          ),
        'collection_runtime_snapshot_independent', true
      ) AS value
    FROM async_flags, sync_flags
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((legacy_release.value ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM runtime_flags, jsonb_each_text(runtime_flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', 'v9.2.2',
    'release_version',
      '20260901_acprod_collection_runtime_health_v9_2_2',
    'health_source', 'runtime_catalog',
    'snapshot_used', false,
    'checked_at', statement_timestamp(),
    'schema_flags',
      coalesce(legacy_release.value -> 'schema_flags', '{}'::jsonb)
      || runtime_flags.value
  )
  FROM legacy_release, runtime_flags;
$runtime_health$;

REVOKE ALL ON FUNCTION public.get_public_collection_runtime_health()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_runtime_health()
  TO anon, authenticated;

-- Registro histórico para operadores. Nenhum gate lê esta linha; a decisão de
-- deploy vem exclusivamente de get_public_collection_runtime_health().
WITH runtime_health AS (
  SELECT public.get_public_collection_runtime_health() AS value
)
INSERT INTO public.app_schema_releases (
  version,
  checksum,
  notes,
  migration_version,
  ready,
  schema_flags
)
SELECT
  '20260901_acprod_collection_runtime_health_v9_2_2',
  'dynamic-runtime-catalog-health-worker-timeout-30s-no-release-snapshot',
  'Probe fail-closed recalculado por RPC: catálogo, privilégios, inbox, worker com timeout HTTP de 30s, Vault, Realtime, cron, índices, KPIs e janela de turno.',
  'v9.2.2',
  (value ->> 'ready')::boolean,
  value -> 'schema_flags'
FROM runtime_health
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes,
    migration_version = excluded.migration_version,
    ready = excluded.ready,
    schema_flags = excluded.schema_flags,
    applied_at = clock_timestamp();

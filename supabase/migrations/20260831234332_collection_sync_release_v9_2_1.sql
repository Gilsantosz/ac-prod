-- AC.Prod2 v9.2.1 — marcador fail-closed da coleta assíncrona consolidada.
--
-- Alinha a reconciliação/KPIs rápidos de v8.9.1 com a proteção de wakeup
-- ocioso e o fallback de 15 segundos introduzidos em v9.2.

CREATE OR REPLACE FUNCTION public.get_public_collection_sync_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, cron, pg_temp
AS $$
  WITH async_base AS (
    SELECT public.get_public_collection_async_release() AS release
  ),
  token_kpi_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.get_operator_shift_kpis_v2(text,timestamptz)'::regprocedure
    )) AS definition
  ),
  uuid_kpi_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.get_operator_shift_kpis_v2(uuid,timestamptz)'::regprocedure
    )) AS definition
  ),
  wake_definition AS (
    SELECT lower(pg_get_functiondef(
      'private.wake_collection_inbox_worker(text,integer)'::regprocedure
    )) AS definition
  ),
  shift_window_definition AS (
    SELECT lower(pg_get_functiondef(
      'public.resolve_operator_shift_window(uuid,timestamptz)'::regprocedure
    )) AS definition
  ),
  flags AS (
    SELECT jsonb_build_object(
      'collection_sync_async_base_ready',
        coalesce((async_base.release ->> 'ready')::boolean, false),
      'collection_sync_operator_kpis_event_ledger',
        (SELECT position('production_collection_events' in definition) > 0
                AND position('production_stage_readings' in definition) = 0
         FROM token_kpi_definition)
        AND
        (SELECT position('production_collection_events' in definition) > 0
                AND position('production_stage_readings' in definition) = 0
         FROM uuid_kpi_definition),
      'collection_sync_operator_covering_index',
        to_regclass('public.idx_collection_events_operator_window_cover_v89')
          IS NOT NULL,
      'collection_sync_manual_stage_index',
        to_regclass('public.idx_manual_production_batch_stage_approved_v89')
          IS NOT NULL,
      'collection_sync_worker_claim_index',
        to_regclass('public.idx_coletas_producao_worker_claim_v89') IS NOT NULL,
      'collection_sync_worker_five_rounds',
        (SELECT position('''max_rounds'', 5' in definition) > 0
         FROM wake_definition),
      'collection_sync_idle_wakeup_guard',
        (SELECT position('if not exists' in definition) > 0
                AND position('status_sincronizacao = ''recebida''' in definition) > 0
         FROM wake_definition),
      'collection_sync_fallback_fifteen_seconds',
        EXISTS (
          SELECT 1
          FROM cron.job
          WHERE jobname = 'run-process-collection-inbox'
            AND active IS TRUE
            AND schedule = '15 seconds'
        ),
      'collection_sync_shift_window_constant_time',
        (SELECT position('pg_timezone_names' in definition) = 0
                AND position('exception when invalid_parameter_value' in definition) > 0
         FROM shift_window_definition),
      'collection_sync_async_idle_flag',
        coalesce((async_base.release #>> '{schema_flags,collection_async_empty_wakeup_guard}')::boolean, false),
      'collection_sync_async_fallback_15s_flag',
        coalesce((async_base.release #>> '{schema_flags,collection_async_fallback_interval_15s}')::boolean, false)
    ) AS value
    FROM async_base
  )
  SELECT jsonb_build_object(
    'ready', NOT EXISTS (
      SELECT 1
      FROM flags, jsonb_each_text(flags.value) flag
      WHERE flag.value IS DISTINCT FROM 'true'
    ),
    'migration_version', 'v9.2.1',
    'release_version', '20260831_acprod_collection_sync_v9_2_1',
    'schema_flags',
      (async_base.release -> 'schema_flags') || flags.value
  )
  FROM async_base, flags;
$$;

REVOKE ALL ON FUNCTION public.get_public_collection_sync_release()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_sync_release()
  TO anon, authenticated;

WITH release AS (
  SELECT public.get_public_collection_sync_release() AS value
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
  '20260831_acprod_collection_sync_v9_2_1',
  'async-v9-2-idle-guard-plus-fast-kpis-and-constant-shift-window',
  'Marcador consolidado: inbox leve, worker assíncrono, wakeup ocioso bloqueado, fallback 15s, KPIs por ledger canônico e janela de turno em tempo constante.',
  'v9.2.1',
  (value ->> 'ready')::boolean,
  value -> 'schema_flags'
FROM release
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes,
    migration_version = excluded.migration_version,
    ready = excluded.ready,
    schema_flags = excluded.schema_flags;

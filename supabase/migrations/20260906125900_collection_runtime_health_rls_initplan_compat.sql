-- AC.Prod2 Collection Fabric V3 — compatibilidade do gate legado com RLS initplan.
--
-- O hardening da V3 passou auth.uid() para uma subconsulta estável, evitando
-- reavaliar a função para cada linha. O probe v9.2.3 comparava a expressão RLS
-- como texto e, apesar de a policy estar mais segura/rápida, interpretava a
-- forma `(select auth.uid())` como falha. Este wrapper preserva o probe original,
-- revalida a policy pelo catálogo e recalcula o gate de modo fail-closed.

SET check_function_bodies = on;

ALTER FUNCTION public.get_public_collection_runtime_health()
  RENAME TO get_public_collection_runtime_health_pre_initplan_v3;

REVOKE ALL ON FUNCTION public.get_public_collection_runtime_health_pre_initplan_v3()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_collection_runtime_health_pre_initplan_v3()
  TO postgres;

CREATE OR REPLACE FUNCTION public.get_public_collection_runtime_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, cron, pg_temp
AS $runtime_health$
DECLARE
  v_health jsonb := public.get_public_collection_runtime_health_pre_initplan_v3();
  v_flags jsonb;
  v_inbox_rls boolean;
  v_async_base_ready boolean;
  v_ready boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_class table_row
      WHERE table_row.oid = 'public.coletas_producao'::regclass
        AND table_row.relrowsecurity IS TRUE
    )
    AND coalesce(
      has_table_privilege(
        'authenticated', 'public.coletas_producao', 'INSERT'
      ),
      false
    )
    AND coalesce(
      has_table_privilege(
        'authenticated', 'public.coletas_producao', 'SELECT'
      ),
      false
    )
    AND NOT coalesce(
      has_table_privilege('anon', 'public.coletas_producao', 'INSERT'),
      false
    )
    AND NOT coalesce(
      has_table_privilege('anon', 'public.coletas_producao', 'SELECT'),
      false
    )
    AND EXISTS (
      SELECT 1
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = 'coletas_producao'
        AND policy.policyname = 'coletas_producao_insert_own'
        AND policy.permissive = 'PERMISSIVE'
        AND policy.cmd = 'INSERT'
        AND policy.roles = ARRAY['authenticated'::name]
        AND policy.qual IS NULL
        AND regexp_replace(
          lower(coalesce(policy.with_check, '')),
          '[[:space:]]+',
          '',
          'g'
        ) = '(auth_user_id=(selectauth.uid()asuid))'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = 'coletas_producao'
        AND policy.policyname = 'coletas_producao_select_own'
        AND policy.permissive = 'PERMISSIVE'
        AND policy.cmd = 'SELECT'
        AND policy.roles = ARRAY['authenticated'::name]
        AND policy.with_check IS NULL
        AND regexp_replace(
          lower(coalesce(policy.qual, '')),
          '[[:space:]]+',
          '',
          'g'
        ) = '(auth_user_id=(selectauth.uid()asuid))'
    )
  INTO v_inbox_rls;

  v_flags := coalesce(v_health -> 'schema_flags', '{}'::jsonb)
    || jsonb_build_object(
      'collection_runtime_inbox_rls', coalesce(v_inbox_rls, false)
    );

  -- Recalcula o agregado usando apenas os sinais que compõem o subsistema
  -- assíncrono. Todos os sinais individuais continuam no JSON e o gate final
  -- abaixo exige que absolutamente todos permaneçam verdadeiros.
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_each(v_flags) flag
    WHERE (
      flag.key LIKE 'collection_async_%'
      OR flag.key IN (
        'collection_runtime_inbox_rls',
        'collection_runtime_ingress_trigger',
        'collection_runtime_worker_secret_verifier',
        'collection_runtime_worker_timeout_30s',
        'collection_event_payload_sanitizer',
        'collection_dashboard_state_cache'
      )
    )
      AND flag.value <> 'true'::jsonb
  ) INTO v_async_base_ready;

  v_flags := v_flags || jsonb_build_object(
    'collection_sync_async_base_ready', v_async_base_ready
  );

  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_each(v_flags) flag
    WHERE flag.value <> 'true'::jsonb
  ) INTO v_ready;

  v_health := jsonb_set(v_health, '{schema_flags}', v_flags, true);
  v_health := jsonb_set(v_health, '{ready}', to_jsonb(v_ready), true);

  RETURN v_health || jsonb_build_object(
    'rls_expression_model', 'initplan',
    'checked_at', statement_timestamp()
  );
END;
$runtime_health$;

REVOKE ALL ON FUNCTION public.get_public_collection_runtime_health()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_collection_runtime_health()
  TO anon, authenticated, service_role;

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
  '20260906_acprod_collection_runtime_health_rls_initplan_compat',
  'runtime-health-rls-initplan-catalog-validation-v1',
  'Compatibiliza o probe v9.2.3 com policies RLS initplan e mantém o gate fail-closed por todos os sinais estruturais.',
  'v9.2.3',
  (value ->> 'ready')::boolean,
  value -> 'schema_flags'
FROM runtime_health
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes,
    migration_version = excluded.migration_version,
    ready = excluded.ready,
    schema_flags = excluded.schema_flags;


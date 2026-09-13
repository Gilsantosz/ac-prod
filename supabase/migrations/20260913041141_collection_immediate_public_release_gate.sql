-- Gate público e sem segredos para impedir que o frontend anuncie o transporte
-- imediato quando o runtime V3, seus limites ou seu rollout não estiverem ativos.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_public_collection_immediate_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $release$
  WITH base AS (
    SELECT public.get_public_collection_runtime_health() AS value
  ),
  objects AS (
    SELECT
      to_regprocedure(
        'public.ingest_collection_batch_immediate_v3(uuid,uuid,jsonb)'
      ) AS immediate_rpc,
      to_regprocedure(
        'private.collection_immediate_context_active_v3()'
      ) AS immediate_context_function,
      to_regclass(
        'private.collection_immediate_context_v3'
      ) AS immediate_context_table
  ),
  definitions AS (
    SELECT coalesce(regexp_replace(
      lower(pg_get_functiondef(objects.immediate_rpc)),
      '[[:space:]]+',
      '',
      'g'
    ), '') AS immediate_rpc
    FROM objects
  ),
  rollout AS (
    SELECT
      coalesce(flag.enabled, false) AS enabled,
      coalesce(flag.rollout_scope, '{}'::jsonb) AS scope
    FROM (SELECT 1) AS seed
    LEFT JOIN private.collection_pipeline_flags flag
      ON flag.flag_name = 'collection_pipeline_v3_ingress'
  ),
  immediate_flags AS (
    SELECT jsonb_build_object(
      'collection_immediate_rpc_exists',
        objects.immediate_rpc IS NOT NULL,
      'collection_immediate_definition_approved',
        objects.immediate_rpc IS NOT NULL
        AND md5(pg_get_functiondef(objects.immediate_rpc))
          = '90ffa0ee5c0f4b6b82c3a92a7d056bcf',
      'collection_immediate_rpc_security',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND function_row.prosecdef IS TRUE
        )
        AND coalesce(
          has_function_privilege('authenticated', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('anon', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT coalesce(
          has_function_privilege('service_role', objects.immediate_rpc, 'EXECUTE'),
          false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_proc function_row,
               aclexplode(coalesce(
                 function_row.proacl,
                 acldefault('f', function_row.proowner)
               )) privilege
          WHERE function_row.oid = objects.immediate_rpc
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        ),
      'collection_immediate_context_private',
        objects.immediate_context_table IS NOT NULL
        AND objects.immediate_context_function IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_class table_row
          WHERE table_row.oid = objects.immediate_context_table
            AND table_row.relrowsecurity IS TRUE
        )
        AND NOT coalesce(
          has_table_privilege('anon', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('authenticated', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_table_privilege('service_role', objects.immediate_context_table, 'SELECT'),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'anon', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'authenticated', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        )
        AND NOT coalesce(
          has_function_privilege(
            'service_role', objects.immediate_context_function, 'EXECUTE'
          ),
          false
        ),
      'collection_immediate_batch_limit_5',
        position('collection_immediate_batch_limit_5' IN definitions.immediate_rpc) > 0
        AND position('jsonb_array_length(p_events->''events'')>5' IN definitions.immediate_rpc) > 0,
      'collection_immediate_decision_committed',
        position('private.process_collection_batch_v3' IN definitions.immediate_rpc) > 0
        AND position('collection_immediate_decision_missing' IN definitions.immediate_rpc) > 0
        AND position('decision_committed_at' IN definitions.immediate_rpc) > 0,
      'collection_immediate_projection_async',
        position('private.process_collection_projection_batch_v3' IN definitions.immediate_rpc) = 0,
      'collection_immediate_rollout_all',
        rollout.enabled IS TRUE
        AND rollout.scope ->> 'immediate_rpc' = 'ingest_collection_batch_immediate_v3'
        AND coalesce((rollout.scope ->> 'immediate_max_events')::integer, 0) = 5
        AND coalesce((rollout.scope ->> 'all')::boolean, false) IS TRUE
    ) AS value
    FROM objects, definitions, rollout
  )
  SELECT jsonb_build_object(
    'ready',
      coalesce((base.value ->> 'ready')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM immediate_flags, jsonb_each_text(immediate_flags.value) flag
        WHERE flag.value IS DISTINCT FROM 'true'
      ),
    'migration_version', '20260908154004',
    'release_version', '20260908_acprod_collection_immediate_decision_v3',
    'transport', 'immediate_v3',
    'ingress_rpc', 'ingest_collection_batch_immediate_v3',
    'max_events_per_request', 5,
    'projection', 'async_v3_outbox',
    'schema_flags', immediate_flags.value
  )
  FROM base, immediate_flags;
$release$;

REVOKE ALL ON FUNCTION public.get_public_collection_immediate_release()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_collection_immediate_release()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_collection_immediate_release() IS
  'Probe público fail-closed do transporte imediato V3; não expõe flags privadas, credenciais ou identificadores de rollout.';

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260908_acprod_collection_immediate_decision_v3',
  'public-runtime-gate-immediate-v3-max5-async-projection',
  'Gate público fail-closed para alinhar o build-info ao RPC imediato V3 já instalado.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;

NOTIFY pgrst, 'reload schema';

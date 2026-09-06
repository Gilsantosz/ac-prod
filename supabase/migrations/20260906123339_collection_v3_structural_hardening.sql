-- AC.Prod2 Collection Fabric V3 — correções estruturais pós-auditoria.
--
-- Mantém o caminho crítico enxuto, remove um tipo que impede pg_upgrade,
-- evita auth.uid() por linha nas políticas de recibos e transforma as
-- verificações em sinais permanentes do health check.

SET check_function_bodies = on;

-- regprocedure armazena OIDs do catálogo e não é transportável pelo pg_upgrade.
-- O nome canônico é suficiente: o registry só precisa revalidar/restaurar DDL.
ALTER TABLE private.collection_projection_trigger_registry
  ALTER COLUMN function_name TYPE text
  USING function_name::text;

COMMENT ON COLUMN private.collection_projection_trigger_registry.function_name IS
  'Assinatura textual da função original; texto é estável entre upgrades e restores.';

-- A correção de leitura procura o outbox por reading_id. Sem este índice, o
-- trigger de correção degrada para varredura conforme o histórico cresce.
CREATE INDEX IF NOT EXISTS idx_collection_projection_outbox_reading_v3
  ON public.collection_projection_outbox (reading_id)
  WHERE reading_id IS NOT NULL;

-- Supabase/Postgres avalia a subconsulta initplan uma vez por statement, em vez
-- de chamar auth.uid() para cada recibo do micro-lote.
DROP POLICY IF EXISTS coletas_producao_insert_own ON public.coletas_producao;
CREATE POLICY coletas_producao_insert_own
  ON public.coletas_producao
  FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS coletas_producao_select_own ON public.coletas_producao;
CREATE POLICY coletas_producao_select_own
  ON public.coletas_producao
  FOR SELECT
  TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));

-- Esta função inspeciona catálogo interno e é usada por deploy/worker, não pelo
-- navegador. O worker já utiliza service_role e continua autorizado.
REVOKE ALL ON FUNCTION public.assert_collection_projection_schema_v3()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_collection_projection_schema_v3()
  TO service_role;

-- Encapsula o health check anterior para que regressões estruturais também
-- fechem o gate da V3 automaticamente.
ALTER FUNCTION public.get_collection_runtime_health_v3()
  RENAME TO get_collection_runtime_health_low_latency_v3;

REVOKE ALL ON FUNCTION public.get_collection_runtime_health_low_latency_v3()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_collection_runtime_health_low_latency_v3()
  TO postgres;

CREATE OR REPLACE FUNCTION public.get_collection_runtime_health_v3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_health jsonb := public.get_collection_runtime_health_low_latency_v3();
  v_registry_portable boolean;
  v_registry_functions_valid boolean;
  v_outbox_reading_index_ready boolean;
  v_receipt_rls_initplan boolean;
  v_assert_rpc_private boolean;
  v_structural_ready boolean;
  v_checks jsonb;
BEGIN
  SELECT attribute.atttypid = 'pg_catalog.text'::regtype
  INTO v_registry_portable
  FROM pg_attribute attribute
  WHERE attribute.attrelid =
        'private.collection_projection_trigger_registry'::regclass
    AND attribute.attname = 'function_name'
    AND attribute.attnum > 0
    AND attribute.attisdropped IS FALSE;

  SELECT count(*) = 3
         AND coalesce(bool_and(
           to_regprocedure('public.' || registry.function_name) IS NOT NULL
         ), false)
  INTO v_registry_functions_valid
  FROM private.collection_projection_trigger_registry registry
  WHERE registry.guard_installed IS TRUE;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_index index_state
      ON index_state.indexrelid = index_relation.oid
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname =
          'idx_collection_projection_outbox_reading_v3'
      AND index_state.indisvalid
      AND index_state.indisready
  ) INTO v_outbox_reading_index_ready;

  SELECT count(*) = 2
         AND coalesce(bool_and(
           position('select auth.uid()' IN lower(
             coalesce(policy.qual, policy.with_check, '')
           )) > 0
         ), false)
  INTO v_receipt_rls_initplan
  FROM pg_policies policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = 'coletas_producao'
    AND policy.policyname IN (
      'coletas_producao_insert_own',
      'coletas_producao_select_own'
    );

  SELECT
    NOT has_function_privilege(
      'anon', 'public.assert_collection_projection_schema_v3()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.assert_collection_projection_schema_v3()',
      'EXECUTE'
    )
    AND has_function_privilege(
      'service_role',
      'public.assert_collection_projection_schema_v3()',
      'EXECUTE'
    )
  INTO v_assert_rpc_private;

  v_checks := jsonb_build_object(
    'registry_portable', coalesce(v_registry_portable, false),
    'registry_functions_valid', coalesce(v_registry_functions_valid, false),
    'outbox_reading_index_ready', coalesce(v_outbox_reading_index_ready, false),
    'receipt_rls_initplan', coalesce(v_receipt_rls_initplan, false),
    'assert_rpc_private', coalesce(v_assert_rpc_private, false)
  );

  v_structural_ready :=
    coalesce((v_health ->> 'structural_ready')::boolean, false)
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(v_checks) check_row
      WHERE check_row.value <> 'true'::jsonb
    );

  v_health := jsonb_set(
    v_health,
    '{structural_ready}',
    to_jsonb(v_structural_ready),
    true
  );
  v_health := jsonb_set(
    v_health,
    '{ready}',
    to_jsonb(
      coalesce((v_health ->> 'ready')::boolean, false)
      AND v_structural_ready
    ),
    true
  );

  RETURN v_health || jsonb_build_object('structural_checks', v_checks);
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_runtime_health_v3()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_runtime_health_v3()
  TO authenticated, service_role;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260906_acprod_collection_v3_structural_hardening',
  'collection-v3-portable-registry-rls-initplan-outbox-index-private-assert-v1',
  'Corrige portabilidade do registry, RLS por statement, índice de correção e ACL do assert; health passa a falhar fechado para regressões estruturais.'
)
ON CONFLICT (version) DO UPDATE
SET checksum = excluded.checksum,
    notes = excluded.notes;


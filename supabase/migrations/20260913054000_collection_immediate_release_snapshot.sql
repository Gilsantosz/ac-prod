-- AC.Prod2 Collection Fabric V3 — gate público O(1) com snapshot fail-closed.
--
-- A auditoria completa de catálogo permanece disponível em função privada,
-- executada uma vez por minuto. O RPC público nunca percorre pg_proc,
-- information_schema, policies, Vault, cron ou publication no caminho quente.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Preserva exatamente a função dinâmica aprovada. A primeira aplicação
-- aceita somente o hash e os metadados canônicos instalados por 20260913043729.
DO $preserve_dynamic_audit$
DECLARE
  v_public regprocedure := to_regprocedure(
    'public.get_public_collection_immediate_release()'
  );
  v_private regprocedure := to_regprocedure(
    'private.audit_collection_immediate_release_v1()'
  );
  v_definition text;
  v_owner name;
  v_security_definer boolean;
  v_volatility "char";
  v_return_type oid;
  v_argument_count smallint;
BEGIN
  IF v_private IS NULL THEN
    IF v_public IS NULL THEN
      RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DYNAMIC_GATE_MISSING';
    END IF;

    SELECT
      pg_get_functiondef(function_row.oid),
      pg_get_userbyid(function_row.proowner),
      function_row.prosecdef,
      function_row.provolatile,
      function_row.prorettype,
      function_row.pronargs
    INTO
      v_definition,
      v_owner,
      v_security_definer,
      v_volatility,
      v_return_type,
      v_argument_count
    FROM pg_proc function_row
    WHERE function_row.oid = v_public;

    IF md5(v_definition) <> '6ff7ea833013958a8e54636969ec7d12'
       OR v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM true
       OR v_volatility IS DISTINCT FROM 's'::"char"
       OR v_return_type IS DISTINCT FROM 'jsonb'::regtype
       OR v_argument_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'COLLECTION_IMMEDIATE_DYNAMIC_GATE_BASELINE_CHANGED: %',
        md5(v_definition);
    END IF;

    ALTER FUNCTION public.get_public_collection_immediate_release()
      SET SCHEMA private;
    ALTER FUNCTION private.get_public_collection_immediate_release()
      RENAME TO audit_collection_immediate_release_v1;
  END IF;
END
$preserve_dynamic_audit$;

ALTER FUNCTION private.audit_collection_immediate_release_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audit_collection_immediate_release_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.audit_collection_immediate_release_v1() IS
  'Auditoria dinâmica completa do gate imediato V3; sem grants de aplicação e fora do caminho HTTP.';

-- Preserva também o health estrutural completo. O hash foi lido do catálogo
-- de produção antes desta migração; qualquer corpo diferente exige revisão.
DO $preserve_runtime_audit$
DECLARE
  v_public regprocedure := to_regprocedure(
    'public.get_public_collection_runtime_health()'
  );
  v_private regprocedure := to_regprocedure(
    'private.audit_collection_runtime_health_v1()'
  );
  v_definition text;
  v_owner name;
  v_security_definer boolean;
  v_volatility "char";
  v_return_type oid;
  v_argument_count smallint;
BEGIN
  IF v_private IS NULL THEN
    IF v_public IS NULL THEN
      RAISE EXCEPTION 'COLLECTION_RUNTIME_DYNAMIC_HEALTH_MISSING';
    END IF;

    SELECT
      pg_get_functiondef(function_row.oid),
      pg_get_userbyid(function_row.proowner),
      function_row.prosecdef,
      function_row.provolatile,
      function_row.prorettype,
      function_row.pronargs
    INTO
      v_definition,
      v_owner,
      v_security_definer,
      v_volatility,
      v_return_type,
      v_argument_count
    FROM pg_proc function_row
    WHERE function_row.oid = v_public;

    IF md5(v_definition) <> 'cef8706c65718a4cc2d8aa7b3d4b95e9'
       OR v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM true
       OR v_volatility IS DISTINCT FROM 's'::"char"
       OR v_return_type IS DISTINCT FROM 'jsonb'::regtype
       OR v_argument_count IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'COLLECTION_RUNTIME_DYNAMIC_HEALTH_BASELINE_CHANGED: %',
        md5(v_definition);
    END IF;

    ALTER FUNCTION public.get_public_collection_runtime_health()
      SET SCHEMA private;
    ALTER FUNCTION private.get_public_collection_runtime_health()
      RENAME TO audit_collection_runtime_health_v1;
  END IF;
END
$preserve_runtime_audit$;

ALTER FUNCTION private.audit_collection_runtime_health_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.audit_collection_runtime_health_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.audit_collection_runtime_health_v1() IS
  'Auditoria estrutural completa do runtime V3; sem grants de aplicação e fora do caminho HTTP.';

-- O marcador percorre apenas as poucas flags V3. Ele permite ao getter público
-- invalidar o snapshot imediatamente quando um rollout mudar, sem reabrir a
-- auditoria de catálogo em cada requisição.
CREATE OR REPLACE FUNCTION private.collection_pipeline_revision_v1()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $revision$
  SELECT md5(coalesce(
    jsonb_agg(
      jsonb_build_array(
        flag.flag_name,
        flag.enabled,
        flag.rollout_scope,
        flag.updated_at
      )
      ORDER BY flag.flag_name
    )::text,
    '[]'
  ))
  FROM private.collection_pipeline_flags flag
  WHERE flag.flag_name LIKE 'collection_pipeline_v3_%';
$revision$;

ALTER FUNCTION private.collection_pipeline_revision_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.collection_pipeline_revision_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- Snapshot independente do health estrutural. O getter público mantém o
-- contrato completo de schema_flags, mas marca explicitamente que a fotografia
-- vem de uma auditoria de catálogo cacheada.
CREATE TABLE IF NOT EXISTS private.collection_runtime_health_snapshot_v1 (
  singleton boolean PRIMARY KEY DEFAULT true,
  payload jsonb NOT NULL,
  source_health_hash text NOT NULL,
  expected_audit_function_hash text NOT NULL,
  audit_function_hash text NOT NULL,
  migration_version text NOT NULL,
  release_version text NOT NULL,
  rollout_revision text NOT NULL,
  refreshed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT collection_runtime_health_snapshot_singleton_check
    CHECK (singleton IS TRUE),
  CONSTRAINT collection_runtime_health_snapshot_source_hash_check
    CHECK (source_health_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT collection_runtime_health_snapshot_expected_hash_check
    CHECK (expected_audit_function_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT collection_runtime_health_snapshot_actual_hash_check
    CHECK (audit_function_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT collection_runtime_health_snapshot_ttl_check
    CHECK (
      expires_at > refreshed_at
      AND expires_at <= refreshed_at + interval '3 minutes'
    )
);

ALTER TABLE private.collection_runtime_health_snapshot_v1
  OWNER TO postgres;
ALTER TABLE private.collection_runtime_health_snapshot_v1
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.collection_runtime_health_snapshot_v1
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.collection_runtime_health_snapshot_v1 IS
  'Snapshot singleton, versionado e fail-closed da auditoria estrutural V3; TTL máximo de três minutos.';

INSERT INTO private.collection_runtime_health_snapshot_v1 (
  singleton,
  payload,
  source_health_hash,
  expected_audit_function_hash,
  audit_function_hash,
  migration_version,
  release_version,
  rollout_revision,
  refreshed_at,
  expires_at
)
SELECT
  true,
  jsonb_build_object(
    'ready', false,
    'snapshot_status', 'initializing',
    'migration_version', 'v9.2.3',
    'release_version',
      '20260901_acprod_collection_runtime_health_security_v9_2_3',
    'schema_flags', '{}'::jsonb
  ),
  'cef8706c65718a4cc2d8aa7b3d4b95e9',
  md5(pg_get_functiondef(
    'private.audit_collection_runtime_health_v1()'::regprocedure
  )),
  md5(pg_get_functiondef(
    'private.audit_collection_runtime_health_v1()'::regprocedure
  )),
  'v9.2.3',
  '20260901_acprod_collection_runtime_health_security_v9_2_3',
  private.collection_pipeline_revision_v1(),
  statement_timestamp(),
  statement_timestamp() + interval '1 second'
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION private.refresh_collection_runtime_health_snapshot_v1()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, cron, pg_temp
AS $refresh_runtime$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_payload jsonb;
  v_rollout_revision text;
  v_expected_hash text;
  v_audit_hash text;
  v_ready boolean;
BEGIN
  SELECT snapshot.expected_audit_function_hash
  INTO v_expected_hash
  FROM private.collection_runtime_health_snapshot_v1 snapshot
  WHERE snapshot.singleton IS TRUE
  FOR UPDATE;

  IF v_expected_hash IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_RUNTIME_HEALTH_SNAPSHOT_IDENTITY_MISSING';
  END IF;

  v_audit_hash := md5(pg_get_functiondef(
    'private.audit_collection_runtime_health_v1()'::regprocedure
  ));
  v_rollout_revision := private.collection_pipeline_revision_v1();
  v_payload := private.audit_collection_runtime_health_v1();

  v_ready := coalesce(v_payload @> '{"ready": true}'::jsonb, false)
    AND v_audit_hash = v_expected_hash
    AND v_payload ->> 'migration_version' = 'v9.2.3'
    AND v_payload ->> 'release_version'
      = '20260901_acprod_collection_runtime_health_security_v9_2_3';

  v_payload := jsonb_set(v_payload, '{ready}', to_jsonb(v_ready), true)
    || jsonb_build_object(
      'health_source', 'runtime_catalog_snapshot',
      'snapshot_used', true,
      'snapshot_format', 'collection_runtime_health_snapshot_v1',
      'snapshot_status', CASE WHEN v_ready THEN 'fresh' ELSE 'audit_failed' END,
      'snapshot_refreshed_at', v_now,
      'snapshot_expires_at', v_now + interval '3 minutes'
    );

  UPDATE private.collection_runtime_health_snapshot_v1 snapshot
  SET payload = v_payload,
      audit_function_hash = v_audit_hash,
      migration_version = coalesce(v_payload ->> 'migration_version', ''),
      release_version = coalesce(v_payload ->> 'release_version', ''),
      rollout_revision = v_rollout_revision,
      refreshed_at = v_now,
      expires_at = v_now + interval '3 minutes'
  WHERE snapshot.singleton IS TRUE;

  RETURN v_payload;
END;
$refresh_runtime$;

ALTER FUNCTION private.refresh_collection_runtime_health_snapshot_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.refresh_collection_runtime_health_snapshot_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.refresh_collection_runtime_health_snapshot_v1() IS
  'Recalcula a auditoria estrutural completa V3 e publica snapshot privado com TTL de três minutos.';

SELECT private.refresh_collection_runtime_health_snapshot_v1();

CREATE OR REPLACE FUNCTION public.get_public_collection_runtime_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $runtime_health$
  WITH current_revision AS (
    SELECT private.collection_pipeline_revision_v1() AS value
  ), snapshot AS (
    SELECT stored.*
    FROM private.collection_runtime_health_snapshot_v1 stored
    WHERE stored.singleton IS TRUE
  ), evaluated AS (
    SELECT
      snapshot.*,
      CASE
        WHEN snapshot.singleton IS NULL THEN 'missing'
        WHEN statement_timestamp() >= snapshot.expires_at THEN 'stale'
        WHEN snapshot.source_health_hash
          <> 'cef8706c65718a4cc2d8aa7b3d4b95e9'
          THEN 'source_hash_mismatch'
        WHEN snapshot.audit_function_hash
          <> snapshot.expected_audit_function_hash THEN 'audit_hash_mismatch'
        WHEN snapshot.migration_version <> 'v9.2.3'
          THEN 'migration_version_mismatch'
        WHEN snapshot.release_version
          <> '20260901_acprod_collection_runtime_health_security_v9_2_3'
          THEN 'release_version_mismatch'
        WHEN snapshot.rollout_revision IS DISTINCT FROM current_revision.value
          THEN 'rollout_changed'
        WHEN NOT coalesce(snapshot.payload @> '{"ready": true}'::jsonb, false)
          THEN 'audit_failed'
        ELSE 'fresh'
      END AS snapshot_state
    FROM (SELECT 1) seed
    CROSS JOIN current_revision
    LEFT JOIN snapshot ON true
  )
  SELECT jsonb_set(
    coalesce(
      evaluated.payload,
      jsonb_build_object(
        'migration_version', 'v9.2.3',
        'release_version',
          '20260901_acprod_collection_runtime_health_security_v9_2_3',
        'schema_flags', '{}'::jsonb
      )
    ) || jsonb_build_object(
      'health_source', 'runtime_catalog_snapshot',
      'snapshot_used', true,
      'snapshot_format', 'collection_runtime_health_snapshot_v1',
      'snapshot_status', evaluated.snapshot_state,
      'snapshot_refreshed_at', evaluated.refreshed_at,
      'snapshot_expires_at', evaluated.expires_at
    ),
    '{ready}',
    to_jsonb(evaluated.snapshot_state = 'fresh'),
    true
  )
  FROM evaluated;
$runtime_health$;

ALTER FUNCTION public.get_public_collection_runtime_health()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_collection_runtime_health()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_collection_runtime_health()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_collection_runtime_health() IS
  'Health público O(1) do runtime V3; snapshot privado com TTL e revisão fail-closed.';

-- Singleton privado. expected_audit_function_hash é gravado uma única vez
-- após mover a função; cada refresh compara o corpo atual com essa identidade.
CREATE TABLE IF NOT EXISTS private.collection_immediate_release_snapshot_v1 (
  singleton boolean PRIMARY KEY DEFAULT true,
  payload jsonb NOT NULL,
  source_gate_hash text NOT NULL,
  expected_audit_function_hash text NOT NULL,
  audit_function_hash text NOT NULL,
  gate_migration_version text NOT NULL,
  gate_release_version text NOT NULL,
  rollout_revision text NOT NULL,
  refreshed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT collection_immediate_release_snapshot_singleton_check
    CHECK (singleton IS TRUE),
  CONSTRAINT collection_immediate_release_snapshot_source_hash_check
    CHECK (source_gate_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT collection_immediate_release_snapshot_expected_hash_check
    CHECK (expected_audit_function_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT collection_immediate_release_snapshot_actual_hash_check
    CHECK (audit_function_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT collection_immediate_release_snapshot_ttl_check
    CHECK (
      expires_at > refreshed_at
      AND expires_at <= refreshed_at + interval '3 minutes'
    )
);

ALTER TABLE private.collection_immediate_release_snapshot_v1
  OWNER TO postgres;
ALTER TABLE private.collection_immediate_release_snapshot_v1
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.collection_immediate_release_snapshot_v1
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.collection_immediate_release_snapshot_v1 IS
  'Snapshot singleton, versionado e fail-closed do gate imediato V3; TTL máximo de três minutos.';

-- Semeia apenas a identidade imutável. O refresh abaixo substitui o payload
-- no mesmo transaction boundary antes de o novo getter público ser exposto.
INSERT INTO private.collection_immediate_release_snapshot_v1 (
  singleton,
  payload,
  source_gate_hash,
  expected_audit_function_hash,
  audit_function_hash,
  gate_migration_version,
  gate_release_version,
  rollout_revision,
  refreshed_at,
  expires_at
)
SELECT
  true,
  jsonb_build_object(
    'ready', false,
    'snapshot_status', 'initializing',
    'gate_migration_version', '20260913043419',
    'gate_release_version',
      '20260913_acprod_collection_immediate_owner_gate_v1_1'
  ),
  '6ff7ea833013958a8e54636969ec7d12',
  md5(pg_get_functiondef(
    'private.audit_collection_immediate_release_v1()'::regprocedure
  )),
  md5(pg_get_functiondef(
    'private.audit_collection_immediate_release_v1()'::regprocedure
  )),
  '20260913043419',
  '20260913_acprod_collection_immediate_owner_gate_v1_1',
  private.collection_pipeline_revision_v1(),
  statement_timestamp(),
  statement_timestamp() + interval '1 second'
ON CONFLICT (singleton) DO NOTHING;

-- A função de refresh é o único caminho de escrita do snapshot. Falha de
-- auditoria aborta o refresh; o último valor expira naturalmente e o getter
-- passa a devolver ready=false em no máximo três minutos.
CREATE OR REPLACE FUNCTION private.refresh_collection_immediate_release_snapshot_v1()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, vault, cron, pg_temp
AS $refresh$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_payload jsonb;
  v_rollout_revision text;
  v_expected_hash text;
  v_audit_hash text;
  v_ready boolean;
BEGIN
  -- Mantém o health estrutural e o gate imediato na mesma revisão do cron.
  -- A auditoria imediata abaixo consome o getter público O(1) já atualizado.
  PERFORM private.refresh_collection_runtime_health_snapshot_v1();

  SELECT snapshot.expected_audit_function_hash
  INTO v_expected_hash
  FROM private.collection_immediate_release_snapshot_v1 snapshot
  WHERE snapshot.singleton IS TRUE
  FOR UPDATE;

  IF v_expected_hash IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_SNAPSHOT_IDENTITY_MISSING';
  END IF;

  v_audit_hash := md5(pg_get_functiondef(
    'private.audit_collection_immediate_release_v1()'::regprocedure
  ));
  v_rollout_revision := private.collection_pipeline_revision_v1();
  v_payload := private.audit_collection_immediate_release_v1();

  v_ready := coalesce(v_payload @> '{"ready": true}'::jsonb, false)
    AND v_audit_hash = v_expected_hash
    AND v_payload ->> 'gate_migration_version' = '20260913043419'
    AND v_payload ->> 'gate_release_version'
      = '20260913_acprod_collection_immediate_owner_gate_v1_1';

  v_payload := jsonb_set(v_payload, '{ready}', to_jsonb(v_ready), true)
    || jsonb_build_object(
      'snapshot_format', 'collection_immediate_release_snapshot_v1',
      'snapshot_status', CASE WHEN v_ready THEN 'fresh' ELSE 'audit_failed' END,
      'snapshot_refreshed_at', v_now,
      'snapshot_expires_at', v_now + interval '3 minutes'
    );

  UPDATE private.collection_immediate_release_snapshot_v1 snapshot
  SET payload = v_payload,
      audit_function_hash = v_audit_hash,
      gate_migration_version = coalesce(
        v_payload ->> 'gate_migration_version',
        ''
      ),
      gate_release_version = coalesce(
        v_payload ->> 'gate_release_version',
        ''
      ),
      rollout_revision = v_rollout_revision,
      refreshed_at = v_now,
      expires_at = v_now + interval '3 minutes'
  WHERE snapshot.singleton IS TRUE;

  RETURN v_payload;
END;
$refresh$;

ALTER FUNCTION private.refresh_collection_immediate_release_snapshot_v1()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.refresh_collection_immediate_release_snapshot_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.refresh_collection_immediate_release_snapshot_v1() IS
  'Recalcula a auditoria completa do gate imediato V3 e publica snapshot privado com TTL de três minutos.';

-- Primeiro refresh ainda dentro da migração. Qualquer drift aborta antes de
-- criar o getter público leve ou registrar o cron.
SELECT private.refresh_collection_immediate_release_snapshot_v1();

-- Hot path O(1): uma linha por PK e um hash barato das flags V3. Ausência,
-- expiração, troca de rollout, corpo divergente ou versão inesperada sempre
-- forçam ready=false, preservando a semântica fail-closed.
CREATE OR REPLACE FUNCTION public.get_public_collection_immediate_release()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $release$
  WITH current_revision AS (
    SELECT private.collection_pipeline_revision_v1() AS value
  ), snapshot AS (
    SELECT stored.*
    FROM private.collection_immediate_release_snapshot_v1 stored
    WHERE stored.singleton IS TRUE
  ), evaluated AS (
    SELECT
      snapshot.*,
      current_revision.value AS current_rollout_revision,
      CASE
        WHEN snapshot.singleton IS NULL THEN 'missing'
        WHEN statement_timestamp() >= snapshot.expires_at THEN 'stale'
        WHEN snapshot.source_gate_hash
          <> '6ff7ea833013958a8e54636969ec7d12' THEN 'source_hash_mismatch'
        WHEN snapshot.audit_function_hash
          <> snapshot.expected_audit_function_hash THEN 'audit_hash_mismatch'
        WHEN snapshot.gate_migration_version <> '20260913043419'
          THEN 'migration_version_mismatch'
        WHEN snapshot.gate_release_version
          <> '20260913_acprod_collection_immediate_owner_gate_v1_1'
          THEN 'release_version_mismatch'
        WHEN snapshot.rollout_revision IS DISTINCT FROM current_revision.value
          THEN 'rollout_changed'
        WHEN NOT coalesce(snapshot.payload @> '{"ready": true}'::jsonb, false)
          THEN 'audit_failed'
        ELSE 'fresh'
      END AS snapshot_state
    FROM (SELECT 1) seed
    CROSS JOIN current_revision
    LEFT JOIN snapshot ON true
  )
  SELECT jsonb_set(
    coalesce(
      evaluated.payload,
      jsonb_build_object(
        'transport', 'immediate_v3',
        'ingress_rpc', 'ingest_collection_batch_immediate_v3',
        'max_events_per_request', 5,
        'projection', 'async_v3_outbox',
        'gate_migration_version', '20260913043419',
        'gate_release_version',
          '20260913_acprod_collection_immediate_owner_gate_v1_1',
        'schema_flags', '{}'::jsonb
      )
    ) || jsonb_build_object(
      'snapshot_format', 'collection_immediate_release_snapshot_v1',
      'snapshot_status', evaluated.snapshot_state,
      'snapshot_refreshed_at', evaluated.refreshed_at,
      'snapshot_expires_at', evaluated.expires_at
    ),
    '{ready}',
    to_jsonb(evaluated.snapshot_state = 'fresh'),
    true
  )
  FROM evaluated;
$release$;

ALTER FUNCTION public.get_public_collection_immediate_release()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_collection_immediate_release()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_collection_immediate_release()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_collection_immediate_release() IS
  'Gate público O(1) do transporte imediato V3; snapshot privado com TTL e revisão fail-closed.';

-- pg_cron usa a conexão interna existente e o proprietário postgres. O nome
-- estável torna cron.schedule idempotente: reaplicação atualiza o mesmo job.
SELECT cron.schedule(
  'collection-immediate-release-snapshot-v1',
  '* * * * *',
  'SELECT private.refresh_collection_immediate_release_snapshot_v1();'
);

-- Postcondições de ownership, ACL, frescor, versão e exposição. A migração
-- falha inteira se o getter não estiver pronto imediatamente após o refresh.
DO $postconditions$
DECLARE
  v_release_public regprocedure := to_regprocedure(
    'public.get_public_collection_immediate_release()'
  );
  v_release_private regprocedure := to_regprocedure(
    'private.audit_collection_immediate_release_v1()'
  );
  v_release_refresh regprocedure := to_regprocedure(
    'private.refresh_collection_immediate_release_snapshot_v1()'
  );
  v_runtime_public regprocedure := to_regprocedure(
    'public.get_public_collection_runtime_health()'
  );
  v_runtime_private regprocedure := to_regprocedure(
    'private.audit_collection_runtime_health_v1()'
  );
  v_runtime_refresh regprocedure := to_regprocedure(
    'private.refresh_collection_runtime_health_snapshot_v1()'
  );
  v_release_payload jsonb;
  v_runtime_payload jsonb;
  v_release_definition text;
  v_runtime_definition text;
BEGIN
  IF v_release_public IS NULL
     OR v_release_private IS NULL
     OR v_release_refresh IS NULL
     OR v_runtime_public IS NULL
     OR v_runtime_private IS NULL
     OR v_runtime_refresh IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_SNAPSHOT_FUNCTION_MISSING';
  END IF;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_release_public))
       IS DISTINCT FROM 'postgres'
     OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_runtime_public))
       IS DISTINCT FROM 'postgres'
     OR NOT coalesce(
       has_function_privilege('anon', v_release_public, 'EXECUTE'),
       false
     )
     OR NOT coalesce(
       has_function_privilege('authenticated', v_release_public, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('service_role', v_release_public, 'EXECUTE'),
       false
     )
     OR NOT coalesce(
       has_function_privilege('anon', v_runtime_public, 'EXECUTE'),
       false
     )
     OR NOT coalesce(
       has_function_privilege('authenticated', v_runtime_public, 'EXECUTE'),
       false
     )
     OR NOT coalesce(
       has_function_privilege('service_role', v_runtime_public, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('anon', v_release_private, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('authenticated', v_release_private, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('service_role', v_release_private, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('anon', v_release_refresh, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('authenticated', v_release_refresh, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('service_role', v_release_refresh, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('anon', v_runtime_private, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('authenticated', v_runtime_private, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('service_role', v_runtime_private, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('anon', v_runtime_refresh, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('authenticated', v_runtime_refresh, 'EXECUTE'),
       false
     )
     OR coalesce(
       has_function_privilege('service_role', v_runtime_refresh, 'EXECUTE'),
       false
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES ('anon'), ('authenticated'), ('service_role')) role_name(value)
       CROSS JOIN (VALUES
         ('private.collection_runtime_health_snapshot_v1'),
         ('private.collection_immediate_release_snapshot_v1')
       ) table_name(value)
       WHERE coalesce(
         has_table_privilege(role_name.value, table_name.value, 'SELECT'),
         false
       )
     ) THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_SNAPSHOT_ACL_INVALID';
  END IF;

  SELECT pg_get_functiondef(v_release_public), pg_get_functiondef(v_runtime_public)
  INTO v_release_definition, v_runtime_definition;
  IF v_release_definition LIKE '%pg_get_functiondef%'
     OR v_release_definition LIKE '%information_schema%'
     OR v_release_definition LIKE '%pg_policies%'
     OR v_runtime_definition LIKE '%pg_get_functiondef%'
     OR v_runtime_definition LIKE '%information_schema%'
     OR v_runtime_definition LIKE '%pg_policies%' THEN
    RAISE EXCEPTION 'COLLECTION_PUBLIC_SNAPSHOT_GETTER_NOT_O1';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class table_row
    WHERE table_row.oid = 'private.collection_runtime_health_snapshot_v1'::regclass
      AND table_row.relrowsecurity IS TRUE
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class table_row
    WHERE table_row.oid = 'private.collection_immediate_release_snapshot_v1'::regclass
      AND table_row.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'COLLECTION_PRIVATE_SNAPSHOT_RLS_DISABLED';
  END IF;

  v_runtime_payload := public.get_public_collection_runtime_health();
  IF NOT coalesce(v_runtime_payload @> '{"ready": true}'::jsonb, false)
     OR v_runtime_payload ->> 'snapshot_status' <> 'fresh'
     OR v_runtime_payload ->> 'health_source' <> 'runtime_catalog_snapshot'
     OR v_runtime_payload ->> 'snapshot_used' <> 'true'
     OR v_runtime_payload ->> 'migration_version' <> 'v9.2.3'
     OR v_runtime_payload ->> 'release_version'
       <> '20260901_acprod_collection_runtime_health_security_v9_2_3' THEN
    RAISE EXCEPTION 'COLLECTION_RUNTIME_SNAPSHOT_POSTCONDITION_FAILED: %',
      v_runtime_payload;
  END IF;

  v_release_payload := public.get_public_collection_immediate_release();
  IF NOT coalesce(v_release_payload @> '{"ready": true}'::jsonb, false)
     OR v_release_payload ->> 'snapshot_status' <> 'fresh'
     OR v_release_payload ->> 'gate_migration_version' <> '20260913043419'
     OR v_release_payload ->> 'gate_release_version'
       <> '20260913_acprod_collection_immediate_owner_gate_v1_1' THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_SNAPSHOT_POSTCONDITION_FAILED: %',
      v_release_payload;
  END IF;
END
$postconditions$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260913_acprod_collection_immediate_snapshot_v1',
  'private-runtime-and-release-audit-public-o1-snapshot-ttl3m-flags-revision-v1',
  'Health estrutural e gate imediato públicos usam snapshots privados fail-closed; auditorias completas executam a cada minuto.'
)
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

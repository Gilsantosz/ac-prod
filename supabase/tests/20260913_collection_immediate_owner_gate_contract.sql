-- Read-only acceptance for the additive owner hardening of the public V3 gate.
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.get_public_collection_immediate_release()'
  );
  v_definition text;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_return_type oid;
  v_argument_count smallint;
  v_acl_is_canonical boolean;
  v_owner_marker text :=
    'pg_get_userbyid(function_row.proowner) = ''postgres''';
  v_required_flag text;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: immediate public release gate is missing';
  END IF;

  SELECT
    pg_get_functiondef(function_row.oid),
    function_row.proowner,
    function_row.proacl,
    function_row.proconfig,
    function_row.prosecdef,
    function_row.provolatile,
    function_row.proparallel,
    function_row.prorettype,
    function_row.pronargs
  INTO
    v_definition,
    v_owner,
    v_acl,
    v_config,
    v_security_definer,
    v_volatility,
    v_parallel,
    v_return_type,
    v_argument_count
  FROM pg_proc function_row
  WHERE function_row.oid = v_signature;

  SELECT
    count(*) = 3
    AND count(*) FILTER (WHERE privilege_type = 'EXECUTE') = 3
    AND count(*) FILTER (WHERE is_grantable) = 0
    AND count(*) FILTER (WHERE grantee = v_owner) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('anon')) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('authenticated')) = 1
  INTO v_acl_is_canonical
  FROM aclexplode(coalesce(v_acl, '{}'::aclitem[]));

  IF md5(v_definition) <> '6ff7ea833013958a8e54636969ec7d12'
     OR pg_get_userbyid(v_owner) IS DISTINCT FROM 'postgres'
     OR v_acl_is_canonical IS DISTINCT FROM true
     OR v_config IS DISTINCT FROM ARRAY[
       'search_path=pg_catalog, public, private, pg_temp'
     ]::text[]
     OR v_security_definer IS DISTINCT FROM true
     OR v_volatility IS DISTINCT FROM 's'::"char"
     OR v_parallel IS DISTINCT FROM 'u'::"char"
     OR v_return_type IS DISTINCT FROM 'jsonb'::regtype
     OR v_argument_count IS DISTINCT FROM 0
     OR NOT has_function_privilege('anon', v_signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: immediate public gate metadata or ACL drifted';
  END IF;

  IF (length(v_definition) - length(replace(v_definition, v_owner_marker, '')))
       / length(v_owner_marker) <> 2
     OR position('90ffa0ee5c0f4b6b82c3a92a7d056bcf' IN v_definition) = 0
     OR position('''gate_migration_version'', ''20260913043419''' IN v_definition) = 0
     OR position(
       '''gate_release_version'', ''20260913_acprod_collection_immediate_owner_gate_v1_1'''
       IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: owner or version gate definition is incomplete';
  END IF;

  FOREACH v_required_flag IN ARRAY ARRAY[
    'collection_immediate_rpc_exists',
    'collection_immediate_definition_approved',
    'collection_immediate_rpc_owner',
    'collection_immediate_rpc_security',
    'collection_immediate_context_private',
    'collection_immediate_batch_limit_5',
    'collection_immediate_decision_committed',
    'collection_immediate_projection_async',
    'collection_immediate_rollout_all'
  ] LOOP
    IF position(v_required_flag IN v_definition) = 0 THEN
      RAISE EXCEPTION 'TEST_FAIL: required release flag missing: %', v_required_flag;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.app_schema_releases release
    WHERE release.version = '20260913_acprod_collection_immediate_owner_gate_v1_1'
      AND release.checksum =
        'get_public_collection_immediate_release:md5:6ff7ea833013958a8e54636969ec7d12'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: immediate owner gate release marker is missing';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'COLLECTION_IMMEDIATE_OWNER_GATE_CONTRACT_OK' AS result;

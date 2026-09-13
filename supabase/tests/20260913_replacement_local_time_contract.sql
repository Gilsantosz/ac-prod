-- Read-only contract for the replacement station's operator-local timestamps.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';

DO $test$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.collect_replacement_stage_v2(text,text,uuid,text,timestamptz,jsonb)'
  );
  v_definition text;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_acl_is_canonical boolean;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: collect_replacement_stage_v2 is missing';
  END IF;

  SELECT
    pg_get_functiondef(function_row.oid),
    function_row.proowner,
    function_row.proacl,
    function_row.proconfig
  INTO v_definition, v_owner, v_acl, v_config
  FROM pg_proc function_row
  WHERE function_row.oid = v_signature;

  SELECT
    count(*) = 3
    AND count(*) FILTER (WHERE privilege_type = 'EXECUTE') = 3
    AND count(*) FILTER (WHERE is_grantable) = 0
    AND count(*) FILTER (WHERE grantee = v_owner) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('authenticated')) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('service_role')) = 1
  INTO v_acl_is_canonical
  FROM aclexplode(coalesce(v_acl, '{}'::aclitem[]));

  IF md5(v_definition) <> '95f464192d89dc3e59906d75583e5cdb' THEN
    RAISE EXCEPTION 'TEST_FAIL: replacement collector definition drifted: %',
      md5(v_definition);
  END IF;

  IF position('v_timezone := coalesce(nullif(v_operator.timezone, ''''), ''America/Sao_Paulo'')' IN v_definition) = 0
     OR position('v_local_now := v_now at time zone v_timezone' IN v_definition) = 0
     OR position('exception when invalid_parameter_value' IN v_definition) = 0
     OR position('v_local_now::date' IN v_definition) = 0
     OR position('to_char(v_local_now, ''HH24:MI'')' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: operator-local timestamp policy is incomplete';
  END IF;

  IF position(E'    current_date,\n    to_char(v_now, ''HH24:MI'')' IN v_definition) > 0
     OR position('current_date, to_char(v_now, ''HH24:MI'')' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: UTC session date/hour remains in replacement writes';
  END IF;

  IF pg_get_userbyid(v_owner) IS DISTINCT FROM 'postgres'
     OR v_acl_is_canonical IS DISTINCT FROM true
     OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, extensions, pg_temp']::text[]
     OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: collector metadata or ACL changed';
  END IF;
END
$test$;

ROLLBACK;
SELECT 'REPLACEMENT_LOCAL_TIME_CONTRACT_OK' AS result;

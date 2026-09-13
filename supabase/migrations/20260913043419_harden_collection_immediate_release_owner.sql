-- AC.Prod2 — harden the already-deployed immediate V3 public release gate.
-- The probe must fail closed unless the approved SECURITY DEFINER ingress RPC
-- is still owned by the canonical postgres role.  Preserve every prior flag,
-- definition hash, ACL and transport identifier.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.get_public_collection_immediate_release()'
  );
  v_oid oid;
  v_definition text;
  v_patched_definition text;
  v_after_definition text;
  v_before_owner oid;
  v_before_acl aclitem[];
  v_before_config text[];
  v_before_security_definer boolean;
  v_before_volatility "char";
  v_before_parallel "char";
  v_before_return_type oid;
  v_before_argument_count smallint;
  v_before_acl_is_canonical boolean;
  v_after_owner oid;
  v_after_acl aclitem[];
  v_after_config text[];
  v_after_security_definer boolean;
  v_after_volatility "char";
  v_after_parallel "char";
  v_after_return_type oid;
  v_after_argument_count smallint;
  v_old_flags text := $old_flags$      'collection_immediate_definition_approved',
        objects.immediate_rpc IS NOT NULL
        AND md5(pg_get_functiondef(objects.immediate_rpc))
          = '90ffa0ee5c0f4b6b82c3a92a7d056bcf',
      'collection_immediate_rpc_security',$old_flags$;
  v_new_flags text := $new_flags$      'collection_immediate_definition_approved',
        objects.immediate_rpc IS NOT NULL
        AND md5(pg_get_functiondef(objects.immediate_rpc))
          = '90ffa0ee5c0f4b6b82c3a92a7d056bcf',
      'collection_immediate_rpc_owner',
        objects.immediate_rpc IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_proc function_row
          WHERE function_row.oid = objects.immediate_rpc
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        ),
      'collection_immediate_rpc_security',$new_flags$;
  v_old_security text := $old_security$          WHERE function_row.oid = objects.immediate_rpc
            AND function_row.prosecdef IS TRUE
        )
        AND coalesce($old_security$;
  v_new_security text := $new_security$          WHERE function_row.oid = objects.immediate_rpc
            AND function_row.prosecdef IS TRUE
            AND pg_get_userbyid(function_row.proowner) = 'postgres'
        )
        AND coalesce($new_security$;
  v_old_version text := $old_version$    'release_version', '20260908_acprod_collection_immediate_decision_v3',
    'transport', 'immediate_v3',$old_version$;
  v_new_version text := $new_version$    'release_version', '20260908_acprod_collection_immediate_decision_v3',
    'gate_migration_version', '20260913042100',
    'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1',
    'transport', 'immediate_v3',$new_version$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_MISSING';
  END IF;

  SELECT
    function_row.oid,
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
    v_oid,
    v_definition,
    v_before_owner,
    v_before_acl,
    v_before_config,
    v_before_security_definer,
    v_before_volatility,
    v_before_parallel,
    v_before_return_type,
    v_before_argument_count
  FROM pg_proc function_row
  WHERE function_row.oid = v_signature;

  SELECT
    count(*) = 3
    AND count(*) FILTER (WHERE privilege_type = 'EXECUTE') = 3
    AND count(*) FILTER (WHERE is_grantable) = 0
    AND count(*) FILTER (WHERE grantee = v_before_owner) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('anon')) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('authenticated')) = 1
  INTO v_before_acl_is_canonical
  FROM aclexplode(coalesce(v_before_acl, '{}'::aclitem[]));

  -- The probe itself is SECURITY DEFINER and public.  Refuse both first apply
  -- and idempotent replay when its ownership, ACL or execution metadata drift.
  IF pg_get_userbyid(v_before_owner) IS DISTINCT FROM 'postgres'
     OR v_before_acl_is_canonical IS DISTINCT FROM true
     OR v_before_config IS DISTINCT FROM ARRAY[
       'search_path=pg_catalog, public, private, pg_temp'
     ]::text[]
     OR v_before_security_definer IS DISTINCT FROM true
     OR v_before_volatility IS DISTINCT FROM 's'::"char"
     OR v_before_parallel IS DISTINCT FROM 'u'::"char"
     OR v_before_return_type IS DISTINCT FROM 'jsonb'::regtype
     OR v_before_argument_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_METADATA_CHANGED';
  END IF;

  IF md5(v_definition) = '42a7a011b423cd0b624c3133326452da' THEN
    RETURN;
  END IF;

  -- Baseline produced by migration 20260913041141 and independently reproduced
  -- with pg_get_functiondef on PostgreSQL 17.  Any other body needs fresh review.
  IF md5(v_definition) <> '2744ece1f4841eae43fc88ea8bf7bf0f' THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_BASELINE_CHANGED: %',
      md5(v_definition);
  END IF;

  IF (length(v_definition) - length(replace(v_definition, v_old_flags, '')))
       / length(v_old_flags) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_old_security, '')))
       / length(v_old_security) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_old_version, '')))
       / length(v_old_version) <> 1 THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_PATCH_POINTS_CHANGED';
  END IF;

  v_patched_definition := replace(v_definition, v_old_flags, v_new_flags);
  v_patched_definition := replace(v_patched_definition, v_old_security, v_new_security);
  v_patched_definition := replace(v_patched_definition, v_old_version, v_new_version);

  IF md5(v_patched_definition) <> '42a7a011b423cd0b624c3133326452da' THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_PATCH_OUTPUT_CHANGED: %',
      md5(v_patched_definition);
  END IF;

  EXECUTE v_patched_definition;

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
    v_after_definition,
    v_after_owner,
    v_after_acl,
    v_after_config,
    v_after_security_definer,
    v_after_volatility,
    v_after_parallel,
    v_after_return_type,
    v_after_argument_count
  FROM pg_proc function_row
  WHERE function_row.oid = v_oid;

  IF md5(v_after_definition) <> '42a7a011b423cd0b624c3133326452da'
     OR v_after_owner IS DISTINCT FROM v_before_owner
     OR v_after_acl IS DISTINCT FROM v_before_acl
     OR v_after_config IS DISTINCT FROM v_before_config
     OR v_after_security_definer IS DISTINCT FROM v_before_security_definer
     OR v_after_volatility IS DISTINCT FROM v_before_volatility
     OR v_after_parallel IS DISTINCT FROM v_before_parallel
     OR v_after_return_type IS DISTINCT FROM v_before_return_type
     OR v_after_argument_count IS DISTINCT FROM v_before_argument_count THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_POSTCONDITION_FAILED';
  END IF;
END
$migration$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260913_acprod_collection_immediate_owner_gate_v1',
  'get_public_collection_immediate_release:md5:42a7a011b423cd0b624c3133326452da',
  'Gate público imediato V3 exige proprietário postgres para o RPC SECURITY DEFINER.'
)
ON CONFLICT (version) DO NOTHING;

DO $release_marker$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_schema_releases release
    WHERE release.version = '20260913_acprod_collection_immediate_owner_gate_v1'
      AND release.checksum =
        'get_public_collection_immediate_release:md5:42a7a011b423cd0b624c3133326452da'
      AND release.notes =
        'Gate público imediato V3 exige proprietário postgres para o RPC SECURITY DEFINER.'
  ) THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_OWNER_GATE_RELEASE_MARKER_CONFLICT';
  END IF;
END
$release_marker$;

NOTIFY pgrst, 'reload schema';

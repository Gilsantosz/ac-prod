-- AC.Prod2 — align the public owner gate with its authoritative migration ledger.
-- The Supabase migration runner recorded the owner hardening as 20260913043419.

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
  v_old_version text := $old_version$    'gate_migration_version', '20260913042100',
    'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1',$old_version$;
  v_new_version text := $new_version$    'gate_migration_version', '20260913043419',
    'gate_release_version', '20260913_acprod_collection_immediate_owner_gate_v1_1',$new_version$;
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

  IF md5(v_definition) = '6ff7ea833013958a8e54636969ec7d12' THEN
    RETURN;
  END IF;

  IF md5(v_definition) <> '42a7a011b423cd0b624c3133326452da' THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_OWNER_BASELINE_CHANGED: %',
      md5(v_definition);
  END IF;

  IF (length(v_definition) - length(replace(v_definition, v_old_version, '')))
       / length(v_old_version) <> 1 THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_LEDGER_PATCH_POINT_CHANGED';
  END IF;

  v_patched_definition := replace(v_definition, v_old_version, v_new_version);

  IF md5(v_patched_definition) <> '6ff7ea833013958a8e54636969ec7d12' THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_LEDGER_OUTPUT_CHANGED: %',
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

  IF md5(v_after_definition) <> '6ff7ea833013958a8e54636969ec7d12'
     OR v_after_owner IS DISTINCT FROM v_before_owner
     OR v_after_acl IS DISTINCT FROM v_before_acl
     OR v_after_config IS DISTINCT FROM v_before_config
     OR v_after_security_definer IS DISTINCT FROM v_before_security_definer
     OR v_after_volatility IS DISTINCT FROM v_before_volatility
     OR v_after_parallel IS DISTINCT FROM v_before_parallel
     OR v_after_return_type IS DISTINCT FROM v_before_return_type
     OR v_after_argument_count IS DISTINCT FROM v_before_argument_count THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_RELEASE_GATE_LEDGER_POSTCONDITION_FAILED';
  END IF;
END
$migration$;

INSERT INTO public.app_schema_releases (version, checksum, notes)
VALUES (
  '20260913_acprod_collection_immediate_owner_gate_v1_1',
  'get_public_collection_immediate_release:md5:6ff7ea833013958a8e54636969ec7d12',
  'Gate imediato V3 alinhado à migração Supabase 20260913043419.'
)
ON CONFLICT (version) DO NOTHING;

DO $release_marker$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_schema_releases release
    WHERE release.version = '20260913_acprod_collection_immediate_owner_gate_v1_1'
      AND release.checksum =
        'get_public_collection_immediate_release:md5:6ff7ea833013958a8e54636969ec7d12'
      AND release.notes =
        'Gate imediato V3 alinhado à migração Supabase 20260913043419.'
  ) THEN
    RAISE EXCEPTION 'COLLECTION_IMMEDIATE_OWNER_GATE_LEDGER_MARKER_CONFLICT';
  END IF;
END
$release_marker$;

NOTIFY pgrst, 'reload schema';

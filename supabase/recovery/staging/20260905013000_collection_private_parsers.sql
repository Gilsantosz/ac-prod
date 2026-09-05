-- Staging-only recovery of three private, SECURITY INVOKER conversion helpers.
-- Literal pg_get_functiondef capture: no v3 semantic changes, no application calls.
-- Apply only to capacity-test smnsihksrhzbkhcbdjfu after API ref/parent/default verification.
-- Source selection SHA-256: f9e8bf58cac7e45785377be0d0e023b7223d4f6415bd7a1bab0d3e4c1d8b74e2
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM private.mes_recovery_journal
      WHERE recovery_key='collection_foundation_20260905'
      AND target_ref='smnsihksrhzbkhcbdjfu'
      AND selection_sha256='d740353826e364449dd765cf9d4589ca0c98623d0f453c13717d60281fee5ecc') <> 1 THEN
    RAISE EXCEPTION 'RECOVERY_LINEAGE_MISMATCH' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM private.collection_pipeline_flags) <> 4
    OR EXISTS (SELECT 1 FROM private.collection_pipeline_flags WHERE enabled IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'RECOVERY_FLAGS_NOT_DISABLED' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM private.mes_recovery_journal WHERE recovery_key='collection_private_parsers_20260905')
    OR pg_catalog.to_regprocedure('private.try_collection_bigint_v3(text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('private.try_collection_timestamptz_v3(text)') IS NOT NULL
    OR pg_catalog.to_regprocedure('private.try_collection_uuid_v3(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'RECOVERY_ALREADY_INITIALIZED' USING ERRCODE='55000';
  END IF;
END $preflight$;

-- source_catalog_sha256 599c8a2ef17da80b1338c4f07cd52b1f214d154f0963ad3847cce5818709c0e2
CREATE OR REPLACE FUNCTION private.try_collection_bigint_v3(p_value text)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN nullif(btrim(p_value), '')::bigint;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END;
$function$
;
REVOKE ALL ON FUNCTION private.try_collection_bigint_v3(text) FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- source_catalog_sha256 143607784c5afe8400d9c65b496e2da1e0e3f0d428c2e9922a4a05e6e7b585b2
CREATE OR REPLACE FUNCTION private.try_collection_timestamptz_v3(p_value text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN nullif(btrim(p_value), '')::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END;
$function$
;
REVOKE ALL ON FUNCTION private.try_collection_timestamptz_v3(text) FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- source_catalog_sha256 37aef332f5dc22565d43cc0ba416c5bbdd82c46a223873cdd1942b1a73354535
CREATE OR REPLACE FUNCTION private.try_collection_uuid_v3(p_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN nullif(btrim(p_value), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$function$
;
REVOKE ALL ON FUNCTION private.try_collection_uuid_v3(text) FROM PUBLIC, anon, authenticated, service_role, authenticator;

INSERT INTO private.mes_recovery_journal (recovery_key,target_ref,selection_sha256)
VALUES ('collection_private_parsers_20260905','smnsihksrhzbkhcbdjfu',
'f9e8bf58cac7e45785377be0d0e023b7223d4f6415bd7a1bab0d3e4c1d8b74e2');

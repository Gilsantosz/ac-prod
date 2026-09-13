-- AC.Prod2 — preserve the operator's local calendar date/time in replacement scans.
--
-- PostgreSQL runs in UTC in Supabase.  The replacement collector previously used
-- current_date/to_char(timestamptz) directly, so events processed between 00:00
-- and 02:59 UTC were attributed to the following day for Sao Paulo operators.
-- Patch the deployed implementation in place to retain its authorization,
-- locking, idempotency and replacement-route behavior verbatim.

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.collect_replacement_stage_v2(text,text,uuid,text,timestamptz,jsonb)'
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
  v_before_arg_types oidvector;
  v_before_acl_is_canonical boolean;
  v_after_owner oid;
  v_after_acl aclitem[];
  v_after_config text[];
  v_after_security_definer boolean;
  v_after_volatility "char";
  v_after_parallel "char";
  v_after_return_type oid;
  v_after_arg_types oidvector;
  v_old_declarations text := $old_declarations$  v_next_cell_id uuid;
  v_offline_reconciliation boolean := coalesce((p_payload ->> 'queued_offline')::boolean, false);
begin$old_declarations$;
  v_new_declarations text := $new_declarations$  v_next_cell_id uuid;
  v_timezone text;
  v_local_now timestamp;
  v_offline_reconciliation boolean := coalesce((p_payload ->> 'queued_offline')::boolean, false);
begin$new_declarations$;
  v_old_operator_context text := $old_operator_context$  if v_operator.id is null or v_operator.active is not true or coalesce(v_operator.login_enabled, true) is not true then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'OPERATOR_INACTIVE', 'message', 'Operador inativo ou sem acesso a coleta.');
  end if;

  select * into v_cell from public.cells where id = v_session.cell_id and active = true;$old_operator_context$;
  v_new_operator_context text := $new_operator_context$  if v_operator.id is null or v_operator.active is not true or coalesce(v_operator.login_enabled, true) is not true then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'OPERATOR_INACTIVE', 'message', 'Operador inativo ou sem acesso a coleta.');
  end if;

  -- Same configurable timezone policy used by resolve_operator_shift_window.
  v_timezone := coalesce(nullif(v_operator.timezone, ''), 'America/Sao_Paulo');
  begin
    v_local_now := v_now at time zone v_timezone;
  exception when invalid_parameter_value then
    v_timezone := 'America/Sao_Paulo';
    v_local_now := v_now at time zone v_timezone;
  end;

  select * into v_cell from public.cells where id = v_session.cell_id and active = true;$new_operator_context$;
  v_old_reading_time text := $old_reading_time$    current_date,
    to_char(v_now, 'HH24:MI'),
    'approved',$old_reading_time$;
  v_new_reading_time text := $new_reading_time$    v_local_now::date,
    to_char(v_local_now, 'HH24:MI'),
    'approved',$new_reading_time$;
  v_old_event_time text := $old_event_time$    current_date, to_char(v_now, 'HH24:MI'), 'synced', 'approved',$old_event_time$;
  v_new_event_time text := $new_event_time$    v_local_now::date, to_char(v_local_now, 'HH24:MI'), 'synced', 'approved',$new_event_time$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_FUNCTION_MISSING';
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
    function_row.proargtypes
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
    v_before_arg_types
  FROM pg_proc function_row
  WHERE function_row.oid = v_signature;

  SELECT
    count(*) = 3
    AND count(*) FILTER (WHERE privilege_type = 'EXECUTE') = 3
    AND count(*) FILTER (WHERE is_grantable) = 0
    AND count(*) FILTER (WHERE grantee = v_before_owner) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('authenticated')) = 1
    AND count(*) FILTER (WHERE grantee = to_regrole('service_role')) = 1
  INTO v_before_acl_is_canonical
  FROM aclexplode(coalesce(v_before_acl, '{}'::aclitem[]));

  -- Reapplying the migration is a no-op only when the complete patch is present.
  IF position(v_new_declarations IN v_definition) > 0
     AND position(v_new_operator_context IN v_definition) > 0
     AND position(v_new_reading_time IN v_definition) > 0
     AND position(v_new_event_time IN v_definition) > 0
     AND position(v_old_reading_time IN v_definition) = 0
     AND position(v_old_event_time IN v_definition) = 0 THEN
    IF md5(v_definition) <> '95f464192d89dc3e59906d75583e5cdb' THEN
      RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_IDEMPOTENT_DEFINITION_CHANGED: %',
        md5(v_definition);
    END IF;
    IF pg_get_userbyid(v_before_owner) IS DISTINCT FROM 'postgres'
       OR v_before_acl_is_canonical IS DISTINCT FROM true
       OR v_before_config IS DISTINCT FROM ARRAY[
         'search_path=pg_catalog, public, extensions, pg_temp'
       ]::text[]
       OR v_before_security_definer IS DISTINCT FROM true
       OR v_before_volatility IS DISTINCT FROM 'v'::"char"
       OR v_before_parallel IS DISTINCT FROM 'u'::"char"
       OR v_before_return_type IS DISTINCT FROM 'jsonb'::regtype
       OR oidvectortypes(v_before_arg_types) IS DISTINCT FROM
         'text, text, uuid, text, timestamp with time zone, jsonb' THEN
      RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_IDEMPOTENT_METADATA_CHANGED';
    END IF;
    RETURN;
  END IF;

  -- Production baseline verified read-only on 2026-09-13.  Refuse to rewrite a
  -- concurrently changed function until its full definition is reviewed again.
  IF pg_get_userbyid(v_before_owner) IS DISTINCT FROM 'postgres'
     OR v_before_acl_is_canonical IS DISTINCT FROM true
     OR v_before_config IS DISTINCT FROM ARRAY[
       'search_path=pg_catalog, public, extensions, pg_temp'
     ]::text[]
     OR v_before_security_definer IS DISTINCT FROM true
     OR v_before_volatility IS DISTINCT FROM 'v'::"char"
     OR v_before_parallel IS DISTINCT FROM 'u'::"char"
     OR v_before_return_type IS DISTINCT FROM 'jsonb'::regtype
     OR oidvectortypes(v_before_arg_types) IS DISTINCT FROM
       'text, text, uuid, text, timestamp with time zone, jsonb' THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_BASELINE_METADATA_CHANGED';
  END IF;
  IF md5(v_definition) <> '301bf930a759fa8f12a163d5d4479852' THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_BASELINE_CHANGED: %', md5(v_definition);
  END IF;

  IF (length(v_definition) - length(replace(v_definition, v_old_declarations, '')))
       / length(v_old_declarations) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_old_operator_context, '')))
       / length(v_old_operator_context) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_old_reading_time, '')))
       / length(v_old_reading_time) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_old_event_time, '')))
       / length(v_old_event_time) <> 1 THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_PATCH_POINTS_CHANGED';
  END IF;

  v_patched_definition := replace(v_definition, v_old_declarations, v_new_declarations);
  v_patched_definition := replace(v_patched_definition, v_old_operator_context, v_new_operator_context);
  v_patched_definition := replace(v_patched_definition, v_old_reading_time, v_new_reading_time);
  v_patched_definition := replace(v_patched_definition, v_old_event_time, v_new_event_time);

  IF md5(v_patched_definition) <> '95f464192d89dc3e59906d75583e5cdb' THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_PATCH_OUTPUT_CHANGED: %',
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
    function_row.proargtypes
  INTO
    v_after_definition,
    v_after_owner,
    v_after_acl,
    v_after_config,
    v_after_security_definer,
    v_after_volatility,
    v_after_parallel,
    v_after_return_type,
    v_after_arg_types
  FROM pg_proc function_row
  WHERE function_row.oid = v_oid;

  IF v_after_owner IS DISTINCT FROM v_before_owner
     OR v_after_acl IS DISTINCT FROM v_before_acl
     OR v_after_config IS DISTINCT FROM v_before_config
     OR v_after_security_definer IS DISTINCT FROM v_before_security_definer
     OR v_after_volatility IS DISTINCT FROM v_before_volatility
     OR v_after_parallel IS DISTINCT FROM v_before_parallel
     OR v_after_return_type IS DISTINCT FROM v_before_return_type
     OR v_after_arg_types IS DISTINCT FROM v_before_arg_types THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_FUNCTION_METADATA_CHANGED';
  END IF;

  IF position(v_new_declarations IN v_after_definition) = 0
     OR position(v_new_operator_context IN v_after_definition) = 0
     OR position(v_new_reading_time IN v_after_definition) = 0
     OR position(v_new_event_time IN v_after_definition) = 0
     OR position(v_old_reading_time IN v_after_definition) > 0
     OR position(v_old_event_time IN v_after_definition) > 0 THEN
    RAISE EXCEPTION 'REPLACEMENT_LOCAL_TIME_POSTCONDITION_FAILED';
  END IF;
END
$migration$;

NOTIFY pgrst, 'reload schema';

-- Match the name comparison already used by set_operator_session_context.
-- Do NOT rename cells or machines, alter sessions, or weaken ID/permission checks.
DO $migration$
DECLARE
  v_function regprocedure := 'public.register_untraceable_stage_quantity(jsonb)'::regprocedure;
  v_definition text := pg_get_functiondef(v_function);
  v_old text := 'AND m.allows_normal_production IS TRUE AND m.cell_name = v_cell.name';
  v_new text := E'AND m.allows_normal_production IS TRUE\n          -- volume_confirmed_cell_v1: identical to the login context comparison.\n          AND lower(btrim(m.cell_name)) = lower(btrim(v_cell.name))';
  v_acl aclitem[];
  v_config text[];
  v_definer boolean;
  v_owner oid;
BEGIN
  IF position(v_new in v_definition) > 0 THEN RETURN; END IF;
  IF position(v_old in v_definition) = 0
    OR length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'VOLUME_CONTEXT_PATCH_MISMATCH: review current writer before applying';
  END IF;
  IF position('lower(btrim(machine.cell_name)) = lower(btrim(v_cell_name))'
    in pg_get_functiondef('public.set_operator_session_context(text,uuid,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VOLUME_CONTEXT_LOGIN_CONTRACT_CHANGED: review current login comparison';
  END IF;
  SELECT proacl, proconfig, prosecdef, proowner INTO v_acl, v_config, v_definer, v_owner
  FROM pg_proc WHERE oid = v_function;
  EXECUTE replace(v_definition, v_old, v_new);
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_function
    AND (proacl IS DISTINCT FROM v_acl OR proconfig IS DISTINCT FROM v_config
      OR prosecdef IS DISTINCT FROM v_definer OR proowner IS DISTINCT FROM v_owner)) THEN
    RAISE EXCEPTION 'VOLUME_CONTEXT_PATCH_SECURITY_CHANGED';
  END IF;
END;
$migration$;
NOTIFY pgrst, 'reload schema';

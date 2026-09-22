-- Baixa por volume: SELECT INTO assigns NULL when no matching goal exists.
-- Preserve existing targets, unit filters, permissions and NOT NULL constraints.
DO $migration$
DECLARE
  v_function regprocedure := 'public.register_untraceable_stage_quantity_impl(jsonb)'::regprocedure;
  v_definition text := pg_get_functiondef(v_function);
  v_anchor text := E'  order by goal.date desc, goal.updated_at desc\n  limit 1;\n\n  v_metric_name := case v_stage_code';
  v_replacement text := E'  order by goal.date desc, goal.updated_at desc\n  limit 1;\n\n  -- volume_goal_default_v1: no matching date/shift/cell/unit must not block production.\n  -- SELECT INTO without a row overwrites the initialized value with NULL.\n  -- Zero is the existing no-goal representation; never reuse a sheets/meters goal as pieces.\n  v_effective_goal := coalesce(v_effective_goal, 0);\n\n  v_metric_name := case v_stage_code';
  v_acl aclitem[];
  v_config text[];
  v_definer boolean;
BEGIN
  IF position(v_replacement in v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_anchor in v_definition) = 0
    OR (length(v_definition) - length(replace(v_definition, v_anchor, ''))) <> length(v_anchor) THEN
    RAISE EXCEPTION 'VOLUME_GOAL_PATCH_CONTEXT_MISMATCH: review the current implementation before applying this migration';
  END IF;
  SELECT proacl, proconfig, prosecdef INTO v_acl, v_config, v_definer
  FROM pg_proc WHERE oid = v_function;
  EXECUTE replace(v_definition, v_anchor, v_replacement);
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = v_function
      AND (proacl IS DISTINCT FROM v_acl OR proconfig IS DISTINCT FROM v_config
        OR prosecdef IS DISTINCT FROM v_definer)
  ) THEN
    RAISE EXCEPTION 'VOLUME_GOAL_PATCH_SECURITY_CHANGED';
  END IF;
END;
$migration$;
NOTIFY pgrst, 'reload schema';

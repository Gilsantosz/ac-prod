-- Treat an absent JWT role claim as untrusted in every service-role bypass.
-- This complements the main remediation migration for direct SQL/test contexts.

do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.register_quality_rejection(jsonb)',
    'public.start_production_downtime(jsonb)',
    'public.finish_production_downtime(uuid,jsonb)',
    'public.register_production_downtime(jsonb)',
    'public.correct_production_downtime(uuid,jsonb)',
    'public.register_untraceable_stage_quantity(jsonb)'
  ]::regprocedure[]
  loop
    v_definition := pg_get_functiondef(v_signature);
    v_definition := replace(
      v_definition,
      'auth.role() <> ''service_role''',
      'coalesce(auth.role(), '''') <> ''service_role'''
    );
    if position('auth.role() <> ''service_role''' in v_definition) > 0 then
      raise exception 'Could not harden missing role handling for %', v_signature;
    end if;
    execute v_definition;
  end loop;
end
$$;

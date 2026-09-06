-- Keep Data API privileges aligned with the RLS policies used by the PCP portal.
-- RLS remains the authorization boundary; these grants only allow PostgREST to
-- reach the policies instead of failing early with SQLSTATE 42501.

do $$
declare
  target_table text;
  rls_enabled boolean;
begin
  foreach target_table in array array[
    'backup_files',
    'backup_policies',
    'pcp_import_chunks',
    'pcp_import_logs',
    'pcp_import_manifests',
    'pcp_import_rows',
    'pcp_integration_settings',
    'pcp_mapping_profiles',
    'production_lot_items',
    'production_lots',
    'production_order_items',
    'production_orders',
    'production_pieces',
    'production_routes',
    'production_stage_readings',
    'promob_import_batches',
    'promob_import_differences',
    'promob_integrations',
    'routing_steps'
  ]
  loop
    select c.relrowsecurity
      into rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = target_table
       and c.relkind in ('r', 'p');

    if rls_enabled is distinct from true then
      raise exception 'Refusing PCP grant: public.% is missing or has RLS disabled', target_table;
    end if;
  end loop;
end;
$$;

grant usage on schema public to authenticated;

grant select, insert, update, delete on table
  public.backup_files,
  public.backup_policies,
  public.pcp_import_chunks,
  public.pcp_import_logs,
  public.pcp_import_manifests,
  public.pcp_import_rows,
  public.pcp_integration_settings,
  public.pcp_mapping_profiles,
  public.production_lot_items,
  public.production_lots,
  public.production_order_items,
  public.production_orders,
  public.production_pieces,
  public.production_routes,
  public.production_stage_readings,
  public.promob_import_batches,
  public.promob_import_differences,
  public.promob_integrations,
  public.routing_steps
to authenticated;

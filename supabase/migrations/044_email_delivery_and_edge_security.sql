-- Fecha lacunas residuais do fluxo de relatórios e das Edge Functions.

alter table public.report_schedules
  add column if not exists report_date date;

comment on column public.report_schedules.report_date is
  'Data explícita usada por fechamentos manuais; agendamentos recorrentes usam period_mode.';

alter view public.report_delivery_history set (security_invoker = true);

drop policy if exists policy_select_deliveries on public.report_deliveries;
drop policy if exists policy_admin_all_deliveries on public.report_deliveries;
drop policy if exists report_deliveries_authorized_read on public.report_deliveries;
create policy report_deliveries_authorized_read
on public.report_deliveries
for select
to authenticated
using (
  public.get_my_role() = any (array['admin'::text, 'manager'::text])
  or public.has_permission('view_report_delivery_logs')
);

-- Entregas e logs são escritos apenas pelas Edge Functions com service role.
drop policy if exists report_email_logs_insert on public.report_email_logs;

drop policy if exists internal_edge_secrets_service_role on public.internal_edge_secrets;
create policy internal_edge_secrets_service_role
on public.internal_edge_secrets
for select
to service_role
using (true);

alter function public.get_my_role() set search_path = pg_catalog, public;
alter function public.has_permission(text) set search_path = pg_catalog, public;
alter function public.has_ai_permission(text) set search_path = pg_catalog, public;
alter function public.compute_report_next_run(text, time without time zone, text, timestamp with time zone)
  set search_path = pg_catalog, public;
alter function public.claim_due_report_schedules(text, interval)
  set search_path = pg_catalog, public;
alter function public.verify_report_cron_secret(text)
  set search_path = pg_catalog, public;
alter function public.admin_delete_operator(uuid, text)
  set search_path = pg_catalog, public, auth;
alter function public.delete_user_from_auth(uuid)
  set search_path = pg_catalog, public, auth;
alter function public.admin_update_user_password(uuid, text)
  set search_path = pg_catalog, public, auth;

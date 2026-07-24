-- Preserva o escopo completo dos relatórios avulsos e permite que usuários
-- autorizados preparem apenas os próprios envios manuais.

alter table public.report_schedules
  add column if not exists report_start_date date,
  add column if not exists report_end_date date,
  add column if not exists filter_snapshot jsonb not null default '{}'::jsonb;

comment on column public.report_schedules.report_start_date is
  'Início inclusivo do período de um relatório manual.';
comment on column public.report_schedules.report_end_date is
  'Fim inclusivo do período de um relatório manual.';
comment on column public.report_schedules.filter_snapshot is
  'Filtros normalizados e imutáveis usados para renderizar o relatório.';

alter table public.report_schedules
  drop constraint if exists report_schedules_report_period_check;
alter table public.report_schedules
  add constraint report_schedules_report_period_check
  check (
    report_start_date is null
    or report_end_date is null
    or report_start_date <= report_end_date
  );

drop policy if exists report_schedules_own_manual_select on public.report_schedules;
create policy report_schedules_own_manual_select
on public.report_schedules
for select
to authenticated
using (
  created_by = auth.uid()
  and enabled = false
  and source_page = any (array['ai_manual_rich_report'::text, 'daily_summary_manual'::text])
  and (
    public.get_my_role() = any (array['admin'::text, 'manager'::text, 'supervisor'::text])
    or public.has_permission('send_reports')
  )
);

drop policy if exists report_schedules_own_manual_insert on public.report_schedules;
create policy report_schedules_own_manual_insert
on public.report_schedules
for insert
to authenticated
with check (
  created_by = auth.uid()
  and enabled = false
  and source_page = any (array['ai_manual_rich_report'::text, 'daily_summary_manual'::text])
  and coalesce(array_length(extra_emails, 1), 0) = 0
  and (
    public.get_my_role() = any (array['admin'::text, 'manager'::text, 'supervisor'::text])
    or public.has_permission('send_reports')
  )
);

drop policy if exists report_schedules_own_manual_delete on public.report_schedules;
create policy report_schedules_own_manual_delete
on public.report_schedules
for delete
to authenticated
using (
  created_by = auth.uid()
  and enabled = false
  and source_page = any (array['ai_manual_rich_report'::text, 'daily_summary_manual'::text])
  and (
    public.get_my_role() = any (array['admin'::text, 'manager'::text, 'supervisor'::text])
    or public.has_permission('send_reports')
  )
);

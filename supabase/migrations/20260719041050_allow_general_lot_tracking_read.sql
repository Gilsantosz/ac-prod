-- Permite visualizar o cabeçalho do lote geral somente a usuários ativos que
-- já tenham permissão de rastreabilidade ou PCP. Escrita permanece restrita.

drop policy if exists promob_batches_select on public.promob_import_batches;

create policy promob_batches_select
on public.promob_import_batches
for select
to authenticated
using (
  public.has_permission('view_traceability')
  or public.has_permission('view_pcp')
  or public.get_my_role() in ('admin', 'manager')
);

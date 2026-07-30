-- Corrige a exposição do catálogo de motivos de parada no Data API.
--
-- Modelo de acesso:
--   * usuários internos ativos podem consultar o catálogo;
--   * somente perfis com manage_downtime_reasons podem alterá-lo;
--   * anon e PUBLIC não possuem acesso direto;
--   * privilégios administrativos desnecessários (TRUNCATE, TRIGGER e
--     REFERENCES) são removidos do papel authenticated.

alter table public.downtime_reason_catalog enable row level security;

drop policy if exists downtime_reason_catalog_read
  on public.downtime_reason_catalog;
drop policy if exists downtime_reason_catalog_manage
  on public.downtime_reason_catalog;
drop policy if exists downtime_reason_catalog_insert
  on public.downtime_reason_catalog;
drop policy if exists downtime_reason_catalog_update
  on public.downtime_reason_catalog;
drop policy if exists downtime_reason_catalog_delete
  on public.downtime_reason_catalog;

create policy downtime_reason_catalog_read
  on public.downtime_reason_catalog
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and coalesce(profile.active, true)
    )
  );

create policy downtime_reason_catalog_insert
  on public.downtime_reason_catalog
  for insert
  to authenticated
  with check (
    (select public.has_permission('manage_downtime_reasons'))
  );

create policy downtime_reason_catalog_update
  on public.downtime_reason_catalog
  for update
  to authenticated
  using (
    (select public.has_permission('manage_downtime_reasons'))
  )
  with check (
    (select public.has_permission('manage_downtime_reasons'))
  );

create policy downtime_reason_catalog_delete
  on public.downtime_reason_catalog
  for delete
  to authenticated
  using (
    (select public.has_permission('manage_downtime_reasons'))
  );

revoke all privileges
  on table public.downtime_reason_catalog
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.downtime_reason_catalog
  to authenticated;

grant all privileges
  on table public.downtime_reason_catalog
  to service_role;

comment on table public.downtime_reason_catalog is
  'Catálogo interno de motivos de parada protegido por RLS; leitura para perfis ativos e manutenção por permissão.';

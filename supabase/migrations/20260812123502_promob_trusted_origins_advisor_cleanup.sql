create index if not exists idx_promob_trusted_origins_created_by
  on public.promob_trusted_origins (created_by);

drop policy if exists promob_trusted_origins_service_role
  on public.promob_trusted_origins;
create policy promob_trusted_origins_service_role
on public.promob_trusted_origins
for all
to service_role
using (true)
with check (true);

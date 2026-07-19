-- Relatórios produtivos só podem sair para perfis previamente cadastrados.

create or replace function public.enforce_registered_report_recipients()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.extra_emails := '{}'::text[];
  return new;
end;
$$;

drop trigger if exists trg_enforce_registered_report_recipients on public.report_schedules;
create trigger trg_enforce_registered_report_recipients
before insert or update of extra_emails on public.report_schedules
for each row execute function public.enforce_registered_report_recipients();

create or replace function public.block_external_email_group_member()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.profile_id is null or new.external_email is not null then
    raise exception 'Selecione um usuário cadastrado para o grupo de relatórios.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_external_email_group_member on public.email_recipient_group_members;
create trigger trg_block_external_email_group_member
before insert or update on public.email_recipient_group_members
for each row execute function public.block_external_email_group_member();

revoke execute on function public.enforce_registered_report_recipients() from public, anon, authenticated;
revoke execute on function public.block_external_email_group_member() from public, anon, authenticated;

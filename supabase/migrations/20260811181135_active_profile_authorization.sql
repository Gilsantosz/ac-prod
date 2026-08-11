-- AC.Prod — perfis inativos deixam de herdar autorização por tokens ainda válidos.

begin;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select profile.role
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.active is true
  limit 1;
$$;

create or replace function public.can_manage_occurrences()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active is true
      and (
        profile.role in ('admin', 'manager', 'supervisor')
        or coalesce((profile.permissions ->> 'manage_occurrences')::boolean, false)
      )
  );
$$;

create or replace function public.can_manage_operators()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active is true
      and (
        profile.role in ('admin', 'manager')
        or coalesce((profile.permissions ->> 'manage_operators')::boolean, false)
        or coalesce((profile.permissions ->> 'manage_users')::boolean, false)
      )
  );
$$;

create or replace function public.can_manage_production_goals()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active is true
      and (
        lower(coalesce(profile.role, '')) in ('admin', 'manager', 'gestor', 'supervisor')
        or coalesce((profile.permissions ->> 'manage_goals')::boolean, false)
        or coalesce((profile.permissions ->> 'manage_cells')::boolean, false)
      )
  );
$$;

create or replace function public.can_manage_quality()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active is true
      and (
        profile.role in ('admin', 'manager', 'supervisor', 'quality_manager')
        or coalesce((profile.permissions ->> 'manage_quality')::boolean, false)
      )
  );
$$;

create or replace function public.can_register_production()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active is true
      and (
        profile.role in ('admin', 'manager', 'supervisor', 'operator')
        or coalesce((profile.permissions ->> 'register_production')::boolean, false)
        or coalesce((profile.permissions ->> 'manage_quality')::boolean, false)
      )
  );
$$;

-- A alteração de senha administrativa ocorre pela Edge Function admin-users,
-- que aplica hierarquia de papéis. A RPC legada não fica exposta à API.
revoke all on function public.admin_update_user_password(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_user_password(uuid, text)
  to service_role;

-- Exclusão de conta exige administrador ativo, impede autoexclusão e preserva
-- ao menos um administrador ativo no sistema.
create or replace function public.delete_user_from_auth(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_target_role text;
  v_target_active boolean;
begin
  if auth.uid() is null or public.get_my_role() <> 'admin' then
    raise exception 'Apenas administradores ativos podem excluir usuários do sistema.'
      using errcode = '42501';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Não é permitido excluir a própria conta administrativa.'
      using errcode = '42501';
  end if;

  select role, active
    into v_target_role, v_target_active
  from public.profiles
  where id = target_user_id;

  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;

  if v_target_role = 'admin'
     and v_target_active is true
     and (
       select count(*)
       from public.profiles
       where role = 'admin' and active is true
     ) <= 1 then
    raise exception 'O sistema deve manter ao menos um administrador ativo.'
      using errcode = '42501';
  end if;

  delete from public.report_schedule_recipients where profile_id = target_user_id;
  delete from public.email_recipient_group_members where profile_id = target_user_id;
  update public.alert_logs set created_by = null where created_by = target_user_id;
  update public.alert_logs set resolved_by = null where resolved_by = target_user_id;
  update public.report_schedule_runs set requested_by = null where requested_by = target_user_id;
  update public.report_deliveries set profile_id = null where profile_id = target_user_id;
  delete from auth.users where id = target_user_id;
end;
$$;

revoke all on function public.delete_user_from_auth(uuid) from public, anon;
grant execute on function public.delete_user_from_auth(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

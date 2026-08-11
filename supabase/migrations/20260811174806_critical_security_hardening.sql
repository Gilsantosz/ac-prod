-- AC.Prod — hardening crítico de autenticação, RLS e RPCs
-- Mantém o fluxo operacional, mas remove endpoints legados e exige autorização
-- no banco para operações que antes dependiam da interface.

begin;

-- Novas funções não devem nascer executáveis pelo público por padrão.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- O cliente atual usa somente o login operacional v2, autenticado e com rate limit.
revoke all on function public.operator_login(text, text) from public, anon, authenticated;

-- A coleta sempre ocorre dentro de uma sessão de usuário do sistema. O token
-- operacional continua sendo validado pela RPC, mas a chamada anônima é removida.
revoke all on function public.process_production_reading(jsonb) from public, anon;
grant execute on function public.process_production_reading(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Operadores e sessões: nenhum acesso de tabela para anon e nenhuma leitura
-- global de credenciais/hashes para todo usuário autenticado.
-- ---------------------------------------------------------------------------

drop policy if exists operators_authenticated_read on public.operators;
drop policy if exists policy_operator_own_sessions on public.operator_sessions;
drop policy if exists policy_admin_manage_sessions on public.operator_sessions;

revoke all on table public.operators from anon, authenticated;
grant select, insert, update, delete on table public.operators to authenticated;

revoke all on table public.operator_sessions from anon, authenticated;
grant select on table public.operator_sessions to authenticated;

create policy operator_sessions_own_or_admin_read
on public.operator_sessions
for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  or public.has_permission('manage_operators')
);

-- Retorna apenas dados necessários ao indicador de operadores online. O hash
-- do token e os identificadores de autenticação nunca saem desta função.
create or replace function public.get_active_replacement_operators()
returns table (
  id uuid,
  operator_id uuid,
  operator_name text,
  cell_id uuid,
  cell_name text,
  machine_id uuid,
  machine_name text,
  shift text,
  started_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('view_replacements')
       or public.has_permission('manage_replacements')
       or public.has_permission('manage_operators')
     ) then
    raise exception 'REPLACEMENT_VIEW_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    session_row.id,
    session_row.operator_id,
    operator_row.name,
    session_row.cell_id,
    session_row.cell_name_snapshot,
    session_row.machine_id,
    session_row.machine_name_snapshot,
    session_row.shift_snapshot,
    session_row.started_at,
    session_row.last_seen_at,
    session_row.expires_at
  from public.operator_sessions session_row
  join public.operators operator_row on operator_row.id = session_row.operator_id
  where session_row.ended_at is null
    and session_row.revoked_at is null
    and session_row.expires_at > now()
    and (
      auth.role() = 'service_role'
      or public.get_my_role() = 'admin'
      or session_row.cell_name_snapshot is null
      or public.profile_can_access_cell(session_row.cell_name_snapshot)
    )
  order by session_row.last_seen_at desc
  limit 50;
end;
$$;

revoke all on function public.get_active_replacement_operators() from public, anon;
grant execute on function public.get_active_replacement_operators() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Políticas permissivas legadas que anulavam as versões com escopo.
-- ---------------------------------------------------------------------------

drop policy if exists occurrences_read on public.occurrences;

drop policy if exists replacement_orders_select on public.replacement_orders;
drop policy if exists replacement_orders_insert on public.replacement_orders;
drop policy if exists replacement_orders_update on public.replacement_orders;
drop policy if exists replacement_orders_delete on public.replacement_orders;

create policy replacement_orders_scoped_select
on public.replacement_orders
for select
to authenticated
using (
  (
    public.has_permission('view_replacements')
    or public.has_permission('manage_replacements')
    or public.has_permission('approve_replacements')
    or public.has_permission('view_quality')
    or public.has_permission('manage_quality')
  )
  and (
    origin_cell_name is null
    or public.profile_can_access_cell(origin_cell_name)
  )
);

create policy replacement_orders_scoped_insert
on public.replacement_orders
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    public.has_permission('manage_replacements')
    or public.has_permission('manage_quality')
  )
  and (
    origin_cell_name is null
    or public.profile_can_access_cell(origin_cell_name)
  )
);

create policy replacement_orders_scoped_update
on public.replacement_orders
for update
to authenticated
using (
  (
    public.has_permission('manage_replacements')
    or public.has_permission('approve_replacements')
    or public.has_permission('manage_quality')
  )
  and (
    origin_cell_name is null
    or public.profile_can_access_cell(origin_cell_name)
  )
)
with check (
  (
    public.has_permission('manage_replacements')
    or public.has_permission('approve_replacements')
    or public.has_permission('manage_quality')
  )
  and (
    origin_cell_name is null
    or public.profile_can_access_cell(origin_cell_name)
  )
);

create policy replacement_orders_scoped_delete
on public.replacement_orders
for delete
to authenticated
using (
  (
    public.get_my_role() in ('admin', 'manager')
    or public.has_permission('manage_quality')
  )
  and (
    origin_cell_name is null
    or public.profile_can_access_cell(origin_cell_name)
  )
);

-- ---------------------------------------------------------------------------
-- RPCs com SECURITY DEFINER: o corpo operacional existente vira implementação
-- privada e um wrapper autorizado passa a ser a única porta pública.
-- ---------------------------------------------------------------------------

alter function public.get_replacement_order_context(uuid)
  rename to get_replacement_order_context_impl;
revoke all on function public.get_replacement_order_context_impl(uuid)
  from public, anon, authenticated;

create function public.get_replacement_order_context(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin_cell text;
begin
  select origin_cell_name into v_origin_cell
  from public.replacement_orders
  where id = p_order_id;

  if not found then
    raise exception 'Ordem de reposição não encontrada.';
  end if;

  if auth.role() <> 'service_role'
     and not (
       public.has_permission('view_replacements')
       or public.has_permission('manage_replacements')
       or public.has_permission('approve_replacements')
       or public.has_permission('view_quality')
       or public.has_permission('manage_quality')
     ) then
    raise exception 'REPLACEMENT_VIEW_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  if auth.role() <> 'service_role'
     and v_origin_cell is not null
     and not public.profile_can_access_cell(v_origin_cell) then
    raise exception 'REPLACEMENT_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;

  return public.get_replacement_order_context_impl(p_order_id);
end;
$$;

revoke all on function public.get_replacement_order_context(uuid) from public, anon;
grant execute on function public.get_replacement_order_context(uuid) to authenticated, service_role;

alter function public.release_piece_replacement(uuid, jsonb)
  rename to release_piece_replacement_impl;
revoke all on function public.release_piece_replacement_impl(uuid, jsonb)
  from public, anon, authenticated;

create function public.release_piece_replacement(
  p_order_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin_cell text;
begin
  select origin_cell_name into v_origin_cell
  from public.replacement_orders
  where id = p_order_id;

  if not found then
    raise exception 'Ordem de reposição não encontrada.';
  end if;

  if auth.role() <> 'service_role'
     and not (
       public.has_permission('manage_replacements')
       or public.has_permission('approve_replacements')
       or public.has_permission('manage_quality')
     ) then
    raise exception 'REPLACEMENT_MANAGE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  if auth.role() <> 'service_role'
     and v_origin_cell is not null
     and not public.profile_can_access_cell(v_origin_cell) then
    raise exception 'REPLACEMENT_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;

  return public.release_piece_replacement_impl(p_order_id, p_payload);
end;
$$;

revoke all on function public.release_piece_replacement(uuid, jsonb) from public, anon;
grant execute on function public.release_piece_replacement(uuid, jsonb) to authenticated, service_role;

alter function public.register_reading_occurrence(jsonb)
  rename to register_reading_occurrence_impl;
revoke all on function public.register_reading_occurrence_impl(jsonb)
  from public, anon, authenticated;

create function public.register_reading_occurrence(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cell text := coalesce(nullif(p_payload->>'cell_name', ''), nullif(p_payload->>'cellName', ''));
  v_reading_id uuid;
begin
  if v_cell is null and nullif(p_payload->>'stage_reading_id', '') is not null then
    v_reading_id := (p_payload->>'stage_reading_id')::uuid;
    select cell_name into v_cell
    from public.production_stage_readings
    where id = v_reading_id;
  end if;

  if auth.role() <> 'service_role'
     and not (
       public.has_permission('manage_occurrences')
       or public.has_permission('register_production')
     ) then
    raise exception 'OCCURRENCE_MANAGE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  if auth.role() <> 'service_role'
     and (v_cell is null or not public.profile_can_access_cell(v_cell)) then
    raise exception 'OCCURRENCE_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;

  return public.register_reading_occurrence_impl(p_payload);
end;
$$;

revoke all on function public.register_reading_occurrence(jsonb) from public, anon;
grant execute on function public.register_reading_occurrence(jsonb) to authenticated, service_role;

alter function public.update_production_lot_status_safely(uuid, text)
  rename to update_production_lot_status_safely_impl;
revoke all on function public.update_production_lot_status_safely_impl(uuid, text)
  from public, anon, authenticated;

create function public.update_production_lot_status_safely(
  p_lot_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_required_permission text;
  v_required_cell text;
begin
  if not exists (select 1 from public.production_lots where id = p_lot_id) then
    return jsonb_build_object('success', false, 'error', 'Lote não localizado.');
  end if;

  v_required_permission := case
    when p_new_status = 'shipped' then 'manage_shipping'
    when p_new_status in ('packed', 'waiting_shipping', 'waiting_packaging', 'ready_to_pack') then 'manage_packaging'
    when p_new_status = 'cancelled' then 'manage_pcp'
    else 'register_production'
  end;

  if auth.role() <> 'service_role'
     and not public.has_permission(v_required_permission) then
    raise exception 'LOT_STATUS_PERMISSION_REQUIRED:%', v_required_permission using errcode = '42501';
  end if;

  if p_new_status = 'shipped' then
    select name into v_required_cell
    from public.cells
    where active is true and lower(btrim(name)) like 'expedi%'
    order by name
    limit 1;
  elsif p_new_status in ('packed', 'waiting_shipping', 'waiting_packaging', 'ready_to_pack') then
    select name into v_required_cell
    from public.cells
    where active is true and lower(btrim(name)) like 'embalag%'
    order by name
    limit 1;
  end if;

  if auth.role() <> 'service_role'
     and v_required_cell is not null
     and not public.profile_can_access_cell(v_required_cell) then
    raise exception 'LOT_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;

  return public.update_production_lot_status_safely_impl(p_lot_id, p_new_status);
end;
$$;

revoke all on function public.update_production_lot_status_safely(uuid, text) from public, anon;
grant execute on function public.update_production_lot_status_safely(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dados administrativos: leitura somente para capacidades relacionadas.
-- ---------------------------------------------------------------------------

drop policy if exists automation_rules_read on public.automation_rules;
create policy automation_rules_authorized_read on public.automation_rules
for select to authenticated
using (
  public.has_permission('view_automations')
  or public.has_permission('manage_automations')
);

drop policy if exists alert_action_history_read on public.alert_action_history;
create policy alert_action_history_authorized_read on public.alert_action_history
for select to authenticated
using (
  public.has_permission('view_automations')
  or public.has_permission('manage_automations')
);

drop policy if exists notification_configs_read on public.notification_configs;
create policy notification_configs_authorized_read on public.notification_configs
for select to authenticated
using (
  public.has_permission('view_automations')
  or public.has_permission('manage_automations')
);

drop policy if exists policy_select_groups on public.email_recipient_groups;
create policy email_recipient_groups_authorized_read on public.email_recipient_groups
for select to authenticated
using (
  public.has_permission('send_reports')
  or public.has_permission('schedule_reports')
  or public.has_permission('manage_report_recipients')
);

drop policy if exists policy_select_group_members on public.email_recipient_group_members;
create policy email_recipient_group_members_authorized_read on public.email_recipient_group_members
for select to authenticated
using (
  public.has_permission('send_reports')
  or public.has_permission('schedule_reports')
  or public.has_permission('manage_report_recipients')
);

drop policy if exists policy_select_own_schedule_recipients on public.report_schedule_recipients;
create policy report_schedule_recipients_authorized_read on public.report_schedule_recipients
for select to authenticated
using (
  public.has_permission('schedule_reports')
  or public.has_permission('view_report_delivery_logs')
);

drop policy if exists policy_select_runs on public.report_schedule_runs;
create policy report_schedule_runs_authorized_read on public.report_schedule_runs
for select to authenticated
using (
  public.has_permission('schedule_reports')
  or public.has_permission('view_report_delivery_logs')
);

drop policy if exists pcp_import_rows_select on public.pcp_import_rows;
create policy pcp_import_rows_authorized_read on public.pcp_import_rows
for select to authenticated
using (
  public.has_permission('view_pcp')
  or public.has_permission('manage_pcp')
);

drop policy if exists pcp_mapping_profiles_select on public.pcp_mapping_profiles;
create policy pcp_mapping_profiles_authorized_read on public.pcp_mapping_profiles
for select to authenticated
using (
  public.has_permission('view_pcp')
  or public.has_permission('manage_pcp')
);

commit;

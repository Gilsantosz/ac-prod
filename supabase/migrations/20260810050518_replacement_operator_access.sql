-- AC.Prod / Leo Flow
-- Permissao explicita de reposicao no cadastro do colaborador e RPCs
-- dedicadas ao posto de baixa produtiva.

set check_function_bodies = on;

alter table public.operators
  add column if not exists replacement_enabled boolean not null default false;

comment on column public.operators.replacement_enabled is
  'Autoriza o colaborador a iniciar sessao e registrar baixas no posto de reposicao.';

create index if not exists idx_operators_replacement_enabled
  on public.operators (id)
  where active is true and replacement_enabled is true;

-- Mantem autorizacoes explicitas antigas, caso existam, sem liberar os demais
-- colaboradores por padrao.
update public.operators operator_row
set replacement_enabled = true
where operator_row.replacement_enabled is false
  and exists (
    select 1
    from public.workstation_operator_authorizations authz
    where authz.operator_id = operator_row.id
      and authz.is_active is true
      and authz.training_validated is true
      and authz.valid_from <= clock_timestamp()
      and (authz.valid_until is null or authz.valid_until > clock_timestamp())
  );

create or replace function public.admin_upsert_operator_v2(
  p_operator_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_operator_id uuid;
  v_replacement_enabled boolean;
begin
  if auth.uid() is null or not public.can_manage_operators() then
    return jsonb_build_object('success', false, 'error', 'Sem permissao para gerenciar colaboradores.');
  end if;

  v_result := public.admin_upsert_operator(p_operator_id, coalesce(p_data, '{}'::jsonb));
  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    return v_result;
  end if;

  v_operator_id := nullif(v_result #>> '{operator,id}', '')::uuid;
  if v_operator_id is null then
    return jsonb_build_object('success', false, 'error', 'O cadastro nao retornou um colaborador valido.');
  end if;

  if coalesce(p_data, '{}'::jsonb) ? 'replacement_enabled' then
    v_replacement_enabled := coalesce((p_data ->> 'replacement_enabled')::boolean, false);
    update public.operators
    set replacement_enabled = v_replacement_enabled
    where id = v_operator_id;
  else
    select operator_row.replacement_enabled
    into v_replacement_enabled
    from public.operators operator_row
    where operator_row.id = v_operator_id;
  end if;

  return jsonb_set(
    v_result,
    '{operator,replacement_enabled}',
    to_jsonb(coalesce(v_replacement_enabled, false)),
    true
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'error', 'A liberacao para reposicao possui formato invalido.');
end;
$$;

create schema if not exists private;

create or replace function private.validate_replacement_operator_session_v2(
  p_session_token text,
  p_device_id text,
  p_require_context boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_session public.operator_sessions%rowtype;
  v_operator public.operators%rowtype;
  v_cell public.cells%rowtype;
  v_machine public.production_machines%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'message', 'Autenticacao do sistema expirada.');
  end if;

  select session_row.*
  into v_session
  from public.operator_sessions session_row
  where session_row.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and session_row.auth_user_id = auth.uid()
    and session_row.device_id = btrim(coalesce(p_device_id, ''))
  order by session_row.started_at desc
  limit 1;

  if v_session.id is null then
    return jsonb_build_object('success', false, 'reason_code', 'SESSION_INVALID', 'message', 'Sessao operacional nao localizada para este dispositivo.');
  end if;

  select operator_row.*
  into v_operator
  from public.operators operator_row
  where operator_row.id = v_session.operator_id;

  if v_operator.id is null
     or v_operator.active is not true
     or coalesce(v_operator.login_enabled, true) is not true
     or v_operator.replacement_enabled is not true then
    return jsonb_build_object(
      'success', false,
      'reason_code', 'REPLACEMENT_ACCESS_DENIED',
      'message', 'Colaborador sem liberacao para realizar baixas de reposicao.'
    );
  end if;

  if p_require_context is not true then
    return jsonb_build_object('success', true, 'operator_id', v_operator.id);
  end if;

  if v_session.cell_id is null then
    return jsonb_build_object('success', false, 'reason_code', 'CONTEXT_REQUIRED', 'message', 'Selecione a celula e o posto de reposicao.');
  end if;

  select cell.* into v_cell
  from public.cells cell
  where cell.id = v_session.cell_id and cell.active is true;

  if v_cell.id is null or not exists (
    select 1
    from public.operator_cell_assignments assignment
    where assignment.operator_id = v_operator.id
      and assignment.cell_id = v_session.cell_id
      and assignment.active is true
      and assignment.valid_from <= v_now
      and (assignment.valid_until is null or assignment.valid_until > v_now)
  ) then
    return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_UNAUTHORIZED', 'message', 'Colaborador nao autorizado para esta celula.');
  end if;

  if v_session.machine_id is not null then
    select machine.* into v_machine
    from public.production_machines machine
    where machine.id = v_session.machine_id;

    if v_machine.id is null
       or v_machine.active is not true
       or v_machine.allows_replacement is not true
       or lower(btrim(v_machine.cell_name)) <> lower(btrim(v_cell.name)) then
      return jsonb_build_object('success', false, 'reason_code', 'MACHINE_UNAUTHORIZED', 'message', 'Posto inativo ou nao habilitado para reposicao nesta celula.');
    end if;

    if exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_id = v_operator.id
        and assignment.active is true
        and assignment.valid_from <= v_now
        and (assignment.valid_until is null or assignment.valid_until > v_now)
    ) and not exists (
      select 1
      from public.operator_machine_assignments assignment
      where assignment.operator_id = v_operator.id
        and assignment.machine_id = v_session.machine_id
        and assignment.active is true
        and assignment.valid_from <= v_now
        and (assignment.valid_until is null or assignment.valid_until > v_now)
    ) then
      return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_UNAUTHORIZED', 'message', 'Colaborador nao autorizado para este posto.');
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'operator_id', v_operator.id,
    'cell_id', v_session.cell_id,
    'machine_id', v_session.machine_id
  );
end;
$$;

create or replace function public.replacement_operator_login_v2(
  p_login_name text,
  p_registration text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_operator_id uuid;
  v_session_id uuid;
  v_enabled boolean;
begin
  v_result := public.operator_login_v2(p_login_name, p_registration, p_device_id);
  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    return v_result;
  end if;

  v_operator_id := nullif(v_result #>> '{operator,id}', '')::uuid;
  v_session_id := nullif(v_result ->> 'session_id', '')::uuid;

  select operator_row.replacement_enabled
  into v_enabled
  from public.operators operator_row
  where operator_row.id = v_operator_id
    and operator_row.active is true
    and coalesce(operator_row.login_enabled, true) is true;

  if coalesce(v_enabled, false) is not true then
    update public.operator_sessions
    set ended_at = clock_timestamp(), end_reason = 'replacement_access_denied'
    where id = v_session_id;

    insert into public.system_audit_logs (
      user_id, user_name, action, entity, entity_id, device_id, session_id, success, metadata
    ) values (
      auth.uid(), v_result #>> '{operator,name}', 'replacement_operator_login_denied',
      'operators', v_operator_id::text, btrim(coalesce(p_device_id, '')),
      v_session_id::text, false,
      jsonb_build_object('reason_code', 'REPLACEMENT_ACCESS_DENIED')
    );

    return jsonb_build_object(
      'success', false,
      'reason_code', 'REPLACEMENT_ACCESS_DENIED',
      'error', 'Colaborador sem liberacao para realizar baixas de reposicao. Solicite a liberacao no cadastro de colaboradores.'
    );
  end if;

  return jsonb_set(
    jsonb_set(v_result, '{scope}', '"replacement"'::jsonb, true),
    '{operator,replacement_enabled}', 'true'::jsonb, true
  );
end;
$$;

create or replace function public.get_replacement_station_queue_v3(
  p_session_token text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_access jsonb;
begin
  v_access := private.validate_replacement_operator_session_v2(p_session_token, p_device_id, true);
  if coalesce((v_access ->> 'success')::boolean, false) is not true then
    return v_access;
  end if;
  return public.get_replacement_station_queue_v2(p_session_token, p_device_id);
end;
$$;

create or replace function public.collect_replacement_stage_v3(
  p_session_token text,
  p_barcode text,
  p_client_event_id uuid,
  p_device_id text,
  p_created_at_client timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_access jsonb;
begin
  v_access := private.validate_replacement_operator_session_v2(p_session_token, p_device_id, true);
  if coalesce((v_access ->> 'success')::boolean, false) is not true then
    return v_access || jsonb_build_object('result_status', 'blocked');
  end if;

  return public.collect_replacement_stage_v2(
    p_session_token,
    p_barcode,
    p_client_event_id,
    p_device_id,
    p_created_at_client,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_upsert_operator_v2(uuid, jsonb) from public, anon;
revoke all on function private.validate_replacement_operator_session_v2(text, text, boolean) from public, anon, authenticated;
revoke all on function public.replacement_operator_login_v2(text, text, text) from public, anon;
revoke all on function public.get_replacement_station_queue_v3(text, text) from public, anon;
revoke all on function public.collect_replacement_stage_v3(text, text, uuid, text, timestamptz, jsonb) from public, anon;

grant execute on function public.admin_upsert_operator_v2(uuid, jsonb) to authenticated;
grant execute on function public.replacement_operator_login_v2(text, text, text) to authenticated;
grant execute on function public.get_replacement_station_queue_v3(text, text) to authenticated;
grant execute on function public.collect_replacement_stage_v3(text, text, uuid, text, timestamptz, jsonb) to authenticated;

comment on function public.replacement_operator_login_v2(text, text, text) is
  'Login operacional exclusivo do posto de reposicao; exige liberacao explicita no cadastro do colaborador.';
comment on function public.get_replacement_station_queue_v3(text, text) is
  'Fila do posto de reposicao protegida por colaborador, dispositivo, celula e maquina.';
comment on function public.collect_replacement_stage_v3(text, text, uuid, text, timestamptz, jsonb) is
  'Baixa produtiva de reposicao com autorizacao explicita do colaborador antes da transacao v2.';

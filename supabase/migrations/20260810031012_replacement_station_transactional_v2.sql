-- AC.Prod / Leo Flow
-- Posto de reposicao isolado, sessao operacional vinculada ao usuario Auth,
-- baixa estritamente sequencial e fila Realtime privada por celula.

set check_function_bodies = on;

alter table public.operator_sessions
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_operator_sessions_auth_device_active
  on public.operator_sessions (auth_user_id, device_id, started_at desc)
  where ended_at is null and revoked_at is null;

create index if not exists idx_replacement_orders_active_piece
  on public.replacement_orders (replacement_piece_id, status, created_at desc)
  where replacement_piece_id is not null
    and status in ('approved', 'released', 'in_production');

create index if not exists idx_replacement_orders_original_status
  on public.replacement_orders (original_piece_id, status);

create index if not exists idx_operator_cell_assignments_active_window
  on public.operator_cell_assignments (operator_id, cell_id, valid_from, valid_until)
  where active is true;

create index if not exists idx_operator_machine_assignments_active_window
  on public.operator_machine_assignments (operator_id, machine_id, valid_from, valid_until)
  where active is true;

create or replace function public.operator_login_v2(
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
  v_auth_user_id uuid := auth.uid();
  v_login text := lower(btrim(coalesce(p_login_name, '')));
  v_registration text := btrim(coalesce(p_registration, ''));
  v_device_id text := btrim(coalesce(p_device_id, ''));
  v_operator public.operators%rowtype;
  v_failed_count integer;
  v_token text;
  v_token_hash text;
  v_session_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '8 hours';
  v_cells jsonb;
  v_machines jsonb;
begin
  if v_auth_user_id is null then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'error', 'Autenticacao do sistema expirada. Entre novamente.');
  end if;

  if v_login = '' or v_registration = '' or v_device_id = '' then
    return jsonb_build_object('success', false, 'reason_code', 'INVALID_CREDENTIALS', 'error', 'Login, matricula e dispositivo sao obrigatorios.');
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_auth_user_id and p.active is distinct from false
  ) then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_USER_INACTIVE', 'error', 'Usuario do sistema inativo ou sem perfil operacional.');
  end if;

  select count(*) into v_failed_count
  from public.operator_access_attempts attempt
  where attempt.login_name_input = v_login
    and attempt.success = false
    and attempt.created_at > clock_timestamp() - interval '10 minutes';

  if v_failed_count >= 5 then
    insert into public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    values (v_login, false, 'rate_limit_locked', v_device_id);
    return jsonb_build_object('success', false, 'reason_code', 'LOGIN_RATE_LIMITED', 'error', 'Tentativas excedidas. Aguarde 10 minutos ou solicite o desbloqueio.');
  end if;

  select operator_row.* into v_operator
  from public.operators operator_row
  where operator_row.active = true
    and coalesce(operator_row.login_enabled, true) = true
    and operator_row.deactivated_at is null
    and (
      lower(btrim(operator_row.login_name)) = v_login
      or lower(btrim(operator_row.name)) = v_login
    )
  order by operator_row.created_at
  limit 1;

  if v_operator.id is null
     or v_operator.credential_hash is null
     or extensions.crypt(v_registration, v_operator.credential_hash) is distinct from v_operator.credential_hash then
    if v_operator.id is not null then
      update public.operators
      set failed_login_count = failed_login_count + 1,
          locked_until = case when failed_login_count + 1 >= 5 then clock_timestamp() + interval '10 minutes' end
      where id = v_operator.id;
    end if;
    insert into public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    values (v_login, false, 'invalid_credentials', v_device_id);
    return jsonb_build_object('success', false, 'reason_code', 'INVALID_CREDENTIALS', 'error', 'Operador nao encontrado ou credenciais invalidas.');
  end if;

  if v_operator.locked_until is not null and v_operator.locked_until > clock_timestamp() then
    insert into public.operator_access_attempts (login_name_input, success, failure_reason, device_id)
    values (v_login, false, 'locked_until_active', v_device_id);
    return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_LOCKED', 'error', 'Conta bloqueada temporariamente.');
  end if;

  select jsonb_agg(
           jsonb_build_object('id', cell.id, 'name', cell.name, 'is_primary', assignment.is_primary)
           order by assignment.is_primary desc, cell.name
         )
  into v_cells
  from public.operator_cell_assignments assignment
  join public.cells cell on cell.id = assignment.cell_id and cell.active = true
  where assignment.operator_id = v_operator.id
    and assignment.active = true
    and assignment.valid_from <= clock_timestamp()
    and (assignment.valid_until is null or assignment.valid_until > clock_timestamp());

  if v_cells is null or jsonb_array_length(v_cells) = 0 then
    return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_WITHOUT_CELL', 'error', 'Operador sem celula de trabalho autorizada.');
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'id', machine.id,
             'name', machine.name,
             'cell_id', cell.id,
             'cell_name', cell.name,
             'is_primary', coalesce(machine_assignment.is_primary, false),
             'allows_replacement', machine.allows_replacement
           )
           order by coalesce(machine_assignment.is_primary, false) desc, cell.name, machine.name
         )
  into v_machines
  from public.production_machines machine
  join public.cells cell on lower(btrim(cell.name)) = lower(btrim(machine.cell_name))
  join public.operator_cell_assignments cell_assignment
    on cell_assignment.operator_id = v_operator.id
   and cell_assignment.cell_id = cell.id
   and cell_assignment.active = true
   and cell_assignment.valid_from <= clock_timestamp()
   and (cell_assignment.valid_until is null or cell_assignment.valid_until > clock_timestamp())
  left join public.operator_machine_assignments machine_assignment
    on machine_assignment.operator_id = v_operator.id
   and machine_assignment.machine_id = machine.id
   and machine_assignment.active = true
   and machine_assignment.valid_from <= clock_timestamp()
   and (machine_assignment.valid_until is null or machine_assignment.valid_until > clock_timestamp())
  where machine.active = true
    and (
      machine_assignment.id is not null
      or not exists (
        select 1 from public.operator_machine_assignments explicit_assignment
        where explicit_assignment.operator_id = v_operator.id
          and explicit_assignment.active = true
          and explicit_assignment.valid_from <= clock_timestamp()
          and (explicit_assignment.valid_until is null or explicit_assignment.valid_until > clock_timestamp())
      )
    );

  update public.operator_sessions
  set ended_at = clock_timestamp(), end_reason = 'operator_switch'
  where auth_user_id = v_auth_user_id
    and device_id = v_device_id
    and ended_at is null
    and revoked_at is null;

  update public.operators
  set failed_login_count = 0, locked_until = null, last_login_at = clock_timestamp()
  where id = v_operator.id;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.operator_sessions (
    operator_id, auth_user_id, token_hash, device_id, expires_at,
    sync_grace_until, shift_snapshot
  ) values (
    v_operator.id, v_auth_user_id, v_token_hash, v_device_id, v_expires_at,
    v_expires_at + interval '24 hours', v_operator.shift
  ) returning id into v_session_id;

  insert into public.operator_access_attempts (login_name_input, success, device_id)
  values (v_login, true, v_device_id);

  insert into public.system_audit_logs (
    user_id, user_name, action, entity, entity_id, device_id, session_id, success, metadata
  ) values (
    v_auth_user_id, v_operator.name, 'operator_session_started', 'operator_sessions',
    v_session_id::text, v_device_id, v_session_id::text, true,
    jsonb_build_object('operator_id', v_operator.id, 'shift', v_operator.shift)
  );

  return jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'session_token', v_token,
    'expires_at', v_expires_at,
    'operator', jsonb_build_object(
      'id', v_operator.id,
      'name', v_operator.name,
      'login_name', v_operator.login_name,
      'registration_masked', public.mask_registration(v_operator.registration),
      'shift', v_operator.shift,
      'primary_cell_id', v_operator.primary_cell_id,
      'primary_machine_id', v_operator.primary_machine_id,
      'cells', coalesce(v_cells, '[]'::jsonb),
      'machines', coalesce(v_machines, '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.set_operator_session_context(
  p_session_token text,
  p_cell_id uuid,
  p_machine_id uuid,
  p_station_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_token_hash text := encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex');
  v_session public.operator_sessions%rowtype;
  v_cell_name text;
  v_machine_name text;
  v_has_explicit_machine_restriction boolean;
begin
  if v_auth_user_id is null then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'error', 'Autenticacao do sistema expirada.');
  end if;

  select * into v_session
  from public.operator_sessions session_row
  where session_row.token_hash = v_token_hash
    and session_row.auth_user_id = v_auth_user_id
    and session_row.ended_at is null
    and session_row.revoked_at is null
    and session_row.expires_at > clock_timestamp()
  for update;

  if v_session.id is null then
    return jsonb_build_object('success', false, 'reason_code', 'SESSION_INVALID', 'error', 'Sessao invalida, expirada ou revogada.');
  end if;

  select cell.name into v_cell_name
  from public.cells cell
  join public.operator_cell_assignments assignment
    on assignment.cell_id = cell.id
   and assignment.operator_id = v_session.operator_id
   and assignment.active = true
   and assignment.valid_from <= clock_timestamp()
   and (assignment.valid_until is null or assignment.valid_until > clock_timestamp())
  where cell.id = p_cell_id and cell.active = true;

  if v_cell_name is null then
    return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_UNAUTHORIZED', 'error', 'Celula nao vinculada a este operador.');
  end if;

  if p_machine_id is not null then
    select machine.name into v_machine_name
    from public.production_machines machine
    where machine.id = p_machine_id
      and machine.active = true
      and machine.allows_replacement = true
      and lower(btrim(machine.cell_name)) = lower(btrim(v_cell_name));

    if v_machine_name is null then
      return jsonb_build_object('success', false, 'reason_code', 'WRONG_MACHINE', 'error', 'Maquina inativa, nao habilitada ou fora da celula selecionada.');
    end if;

    select exists (
      select 1 from public.operator_machine_assignments assignment
      where assignment.operator_id = v_session.operator_id
        and assignment.active = true
        and assignment.valid_from <= clock_timestamp()
        and (assignment.valid_until is null or assignment.valid_until > clock_timestamp())
    ) into v_has_explicit_machine_restriction;

    if v_has_explicit_machine_restriction and not exists (
      select 1 from public.operator_machine_assignments assignment
      where assignment.operator_id = v_session.operator_id
        and assignment.machine_id = p_machine_id
        and assignment.active = true
        and assignment.valid_from <= clock_timestamp()
        and (assignment.valid_until is null or assignment.valid_until > clock_timestamp())
    ) then
      return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_UNAUTHORIZED', 'error', 'Maquina nao vinculada a este operador.');
    end if;
  end if;

  update public.operator_sessions
  set cell_id = p_cell_id,
      machine_id = p_machine_id,
      cell_name_snapshot = v_cell_name,
      machine_name_snapshot = v_machine_name,
      station_name_snapshot = coalesce(nullif(btrim(p_station_name), ''), 'Posto de Reposicao'),
      last_seen_at = clock_timestamp()
  where id = v_session.id;

  insert into public.system_audit_logs (
    user_id, user_name, action, entity, entity_id, device_id, session_id, success, metadata
  )
  select v_auth_user_id, operator_row.name, 'operator_session_context_set', 'operator_sessions',
         v_session.id::text, v_session.device_id, v_session.id::text, true,
         jsonb_build_object(
           'operator_id', v_session.operator_id,
           'cell_id', p_cell_id,
           'cell_name', v_cell_name,
           'machine_id', p_machine_id,
           'machine_name', v_machine_name,
           'station_name', coalesce(nullif(btrim(p_station_name), ''), 'Posto de Reposicao'),
           'shift', v_session.shift_snapshot
         )
  from public.operators operator_row where operator_row.id = v_session.operator_id;

  return jsonb_build_object(
    'success', true,
    'cell_name', v_cell_name,
    'machine_name', v_machine_name
  );
end;
$$;

create or replace function public.heartbeat_operator_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_token_hash text := encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex');
  v_session_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'error', 'Autenticacao expirada.');
  end if;

  select id into v_session_id
  from public.operator_sessions
  where token_hash = v_token_hash
    and auth_user_id = auth.uid()
    and ended_at is null
    and revoked_at is null
    and expires_at > clock_timestamp();

  if v_session_id is null then
    return jsonb_build_object('success', false, 'reason_code', 'SESSION_EXPIRED', 'error', 'Sessao expirada ou encerrada.');
  end if;

  update public.operator_sessions
  set last_seen_at = clock_timestamp(),
      expires_at = clock_timestamp() + interval '8 hours',
      sync_grace_until = clock_timestamp() + interval '32 hours'
  where id = v_session_id;

  return jsonb_build_object('success', true, 'expires_at', clock_timestamp() + interval '8 hours');
end;
$$;

create or replace function public.logout_operator_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_token_hash text := encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex');
  v_session_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'error', 'Autenticacao expirada.');
  end if;

  update public.operator_sessions
  set ended_at = clock_timestamp(), end_reason = 'user_logout'
  where token_hash = v_token_hash
    and auth_user_id = auth.uid()
    and ended_at is null
  returning id into v_session_id;

  return jsonb_build_object('success', true, 'session_id', v_session_id);
end;
$$;

create or replace function public.recalculate_replacement_lot_v2(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lot public.production_lots%rowtype;
  v_direct integer := 0;
  v_via_replacement integer := 0;
  v_final integer := 0;
  v_pending integer := 0;
  v_open_replacements integer := 0;
  v_open_nonconformities integer := 0;
  v_blocked integer := 0;
  v_incomplete_routes integer := 0;
  v_can_close boolean := false;
  v_message text;
begin
  select * into v_lot from public.production_lots where id = p_lot_id for update;
  if v_lot.id is null then
    return jsonb_build_object('success', false, 'reason_code', 'LOT_NOT_FOUND');
  end if;

  select count(distinct piece.id) into v_direct
  from public.production_pieces piece
  where piece.lot_id = p_lot_id
    and coalesce(piece.is_replacement, false) = false
    and piece.status in ('completed', 'packed', 'ready_for_shipping', 'shipped');

  select count(distinct replacement.original_piece_id) into v_via_replacement
  from public.replacement_orders replacement
  join public.production_pieces replacement_piece on replacement_piece.id = replacement.replacement_piece_id
  where replacement.lot_id = p_lot_id
    and replacement.status = 'completed'
    and replacement_piece.status in ('completed', 'packed', 'ready_for_shipping', 'shipped');

  select count(*) into v_open_replacements
  from public.replacement_orders replacement
  where replacement.lot_id = p_lot_id
    and replacement.status not in ('completed', 'cancelled', 'Finalizada', 'Cancelada');

  select count(*) into v_open_nonconformities
  from public.quality_nonconformities nonconformity
  where nonconformity.lot_id = p_lot_id
    and nonconformity.status not in ('resolved', 'closed', 'cancelled');

  select count(*) into v_blocked
  from public.production_pieces piece
  where piece.lot_id = p_lot_id
    and (piece.is_blocked is true or piece.status = 'blocked');

  select count(*) into v_incomplete_routes
  from public.production_pieces piece
  where piece.lot_id = p_lot_id
    and (
      (coalesce(piece.is_replacement, false) = false and piece.status in ('completed', 'packed', 'ready_for_shipping', 'shipped'))
      or (coalesce(piece.is_replacement, false) = true and piece.status in ('completed', 'packed', 'ready_for_shipping', 'shipped'))
    )
    and exists (
      select 1
      from unnest(coalesce(piece.route_steps, array[]::text[])) route_step
      where public.normalize_replacement_step_code(route_step)
            <> all(
              select public.normalize_replacement_step_code(done_step)
              from unnest(coalesce(piece.completed_steps, array[]::text[])) done_step
            )
    );

  v_final := v_direct + v_via_replacement;
  v_pending := greatest(coalesce(v_lot.planned_quantity, 0) - v_final, 0);
  v_can_close := v_final = coalesce(v_lot.planned_quantity, 0)
                 and v_open_replacements = 0
                 and v_open_nonconformities = 0
                 and v_blocked = 0
                 and v_incomplete_routes = 0;
  v_message := format(
    'Lote finalizado: %s aprovadas diretamente + %s aprovadas via reposicao = %s/%s pecas.',
    v_direct, v_via_replacement, v_final, coalesce(v_lot.planned_quantity, 0)
  );

  update public.production_lots
  set approved_quantity = v_final,
      rejected_quantity = greatest(coalesce(planned_quantity, 0) - v_direct - v_via_replacement, 0),
      pending_quantity = v_pending,
      produced_quantity = least(v_final, coalesce(planned_quantity, 0)),
      status = case when v_can_close then 'completed' else status end,
      current_status = case when v_can_close then 'completed' else current_status end,
      closed_at = case when v_can_close then coalesce(closed_at, clock_timestamp()) else closed_at end,
      updated_at = clock_timestamp()
  where id = p_lot_id;

  return jsonb_build_object(
    'success', true,
    'direct_approved', v_direct,
    'replacement_approved', v_via_replacement,
    'final_approved', v_final,
    'planned', coalesce(v_lot.planned_quantity, 0),
    'pending', v_pending,
    'open_replacements', v_open_replacements,
    'open_nonconformities', v_open_nonconformities,
    'blocked_pieces', v_blocked,
    'incomplete_routes', v_incomplete_routes,
    'lot_completed', v_can_close,
    'message', case when v_can_close then v_message else null end
  );
end;
$$;

create or replace function public.get_replacement_station_queue_v2(
  p_session_token text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_session public.operator_sessions%rowtype;
  v_operator public.operators%rowtype;
  v_cell_code text;
  v_shift_start timestamptz;
  v_available jsonb := '[]'::jsonb;
  v_on_way jsonb := '[]'::jsonb;
  v_completed jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'reason_code', 'AUTH_REQUIRED', 'message', 'Autenticacao do sistema expirada.');
  end if;

  select * into v_session
  from public.operator_sessions session_row
  where session_row.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and session_row.auth_user_id = auth.uid()
    and session_row.device_id = btrim(coalesce(p_device_id, ''))
    and session_row.ended_at is null
    and session_row.revoked_at is null
    and session_row.expires_at > clock_timestamp();

  if v_session.id is null then
    return jsonb_build_object('success', false, 'reason_code', 'SESSION_EXPIRED', 'message', 'Sessao operacional invalida, expirada ou revogada.');
  end if;
  if v_session.cell_id is null then
    return jsonb_build_object('success', false, 'reason_code', 'CONTEXT_REQUIRED', 'message', 'Selecione a celula e o posto de reposicao.');
  end if;

  select * into v_operator from public.operators where id = v_session.operator_id and active = true;
  if v_operator.id is null then
    return jsonb_build_object('success', false, 'reason_code', 'OPERATOR_INACTIVE', 'message', 'Operador inativo.');
  end if;

  v_cell_code := public.normalize_replacement_step_code(v_session.cell_name_snapshot);
  v_shift_start := case
    when coalesce(v_session.shift_snapshot, '') like '%2%' then date_trunc('day', clock_timestamp()) + interval '14 hours'
    when coalesce(v_session.shift_snapshot, '') like '%3%' then
      case when localtime < time '06:00'
        then date_trunc('day', clock_timestamp()) - interval '2 hours'
        else date_trunc('day', clock_timestamp()) + interval '22 hours' end
    else date_trunc('day', clock_timestamp()) + interval '6 hours'
  end;

  with base as (
    select
      replacement.id as replacement_order_id,
      replacement.replacement_code,
      coalesce(replacement.replacement_barcode, replacement_piece.traceability_code, replacement_piece.piece_uid) as barcode,
      replacement.status,
      replacement.reason,
      replacement.priority,
      replacement.created_at,
      replacement.general_lot_code,
      replacement.lot_code,
      replacement.order_number,
      replacement.customer_name,
      replacement.environment_name,
      replacement_piece.id as replacement_piece_id,
      replacement_piece.piece_code as replacement_piece_code,
      replacement_piece.piece_name as replacement_piece_name,
      replacement_piece.description,
      replacement_piece.material,
      replacement_piece.color,
      replacement_piece.thickness,
      replacement_piece.width,
      replacement_piece.height,
      replacement_piece.length,
      original_piece.id as original_piece_id,
      original_piece.piece_code as original_piece_code,
      original_piece.piece_name as original_piece_name,
      coalesce(replacement_piece.route_steps, original_piece.route_steps, array[]::text[]) as route_steps,
      coalesce(replacement_piece.completed_steps, array[]::text[]) as completed_steps
    from public.replacement_orders replacement
    join public.production_pieces replacement_piece on replacement_piece.id = replacement.replacement_piece_id
    join public.production_pieces original_piece on original_piece.id = replacement.original_piece_id
    where replacement.status in ('released', 'in_production')
      and replacement_piece.is_replacement is true
      and replacement_piece.status not in ('completed', 'cancelled')
  ), routed as (
    select base.*,
      route_codes.codes,
      completed_codes.codes as completed_codes,
      pending.pending_index,
      cell_position.cell_index
    from base
    cross join lateral (
      select coalesce(array_agg(public.normalize_replacement_step_code(step) order by ord), array[]::text[]) as codes
      from unnest(base.route_steps) with ordinality route(step, ord)
    ) route_codes
    cross join lateral (
      select coalesce(array_agg(public.normalize_replacement_step_code(step)), array[]::text[]) as codes
      from unnest(base.completed_steps) done(step)
    ) completed_codes
    cross join lateral (
      select min(ord)::integer as pending_index
      from unnest(route_codes.codes) with ordinality route(code, ord)
      where not (route.code = any(completed_codes.codes))
    ) pending
    cross join lateral (
      select min(ord)::integer as cell_index
      from unnest(route_codes.codes) with ordinality route(code, ord)
      where route.code = v_cell_code
    ) cell_position
  ), cards as (
    select routed.*,
      jsonb_build_object(
        'replacement_order_id', replacement_order_id,
        'replacement_piece_id', replacement_piece_id,
        'replacement_code', replacement_code,
        'barcode', barcode,
        'original_piece', jsonb_build_object('id', original_piece_id, 'code', original_piece_code, 'name', original_piece_name),
        'replacement_piece', jsonb_build_object('id', replacement_piece_id, 'code', replacement_piece_code, 'name', replacement_piece_name),
        'general_lot_code', general_lot_code,
        'client_lot_code', lot_code,
        'order_number', order_number,
        'customer_name', customer_name,
        'environment_name', environment_name,
        'description', description,
        'material', material,
        'color', color,
        'thickness', thickness,
        'dimensions', jsonb_build_object('width', width, 'height', height, 'length', length),
        'rejection_reason', reason,
        'priority', priority,
        'route', route_steps,
        'completed_steps', completed_steps,
        'current_step', case when pending_index is not null then route_steps[pending_index] end,
        'next_step', case when pending_index is not null and pending_index < cardinality(route_steps) then route_steps[pending_index + 1] end,
        'open_seconds', greatest(extract(epoch from clock_timestamp() - created_at)::bigint, 0),
        'status', status
      ) as item
    from routed
  )
  select
    coalesce(jsonb_agg(item order by
      case priority when 'critical' then 1 when 'high' then 2 else 3 end,
      created_at) filter (where pending_index = cell_index), '[]'::jsonb),
    coalesce(jsonb_agg(item order by
      case priority when 'critical' then 1 when 'high' then 2 else 3 end,
      created_at) filter (where cell_index > pending_index), '[]'::jsonb)
  into v_available, v_on_way
  from cards;

  select coalesce(jsonb_agg(completed.item order by completed.completed_at desc), '[]'::jsonb)
  into v_completed
  from (
    select distinct on (reading.id)
      reading.created_at as completed_at,
      jsonb_build_object(
        'reading_id', reading.id,
        'completed_at', reading.created_at,
        'completed_stage', reading.step_name,
        'operator_name', reading.operator_name_snapshot,
        'machine_name', reading.machine_name,
        'replacement_order_id', replacement.id,
        'replacement_code', replacement.replacement_code,
        'barcode', coalesce(replacement.replacement_barcode, replacement_piece.traceability_code, replacement_piece.piece_uid),
        'original_piece', jsonb_build_object('id', original_piece.id, 'code', original_piece.piece_code, 'name', original_piece.piece_name),
        'replacement_piece', jsonb_build_object('id', replacement_piece.id, 'code', replacement_piece.piece_code, 'name', replacement_piece.piece_name),
        'general_lot_code', replacement.general_lot_code,
        'client_lot_code', replacement.lot_code,
        'order_number', replacement.order_number,
        'customer_name', replacement.customer_name,
        'environment_name', replacement.environment_name,
        'description', replacement_piece.description,
        'material', replacement_piece.material,
        'color', replacement_piece.color,
        'thickness', replacement_piece.thickness,
        'dimensions', jsonb_build_object('width', replacement_piece.width, 'height', replacement_piece.height, 'length', replacement_piece.length),
        'rejection_reason', replacement.reason,
        'priority', replacement.priority,
        'route', replacement_piece.route_steps,
        'completed_steps', replacement_piece.completed_steps,
        'status', replacement.status
      ) as item
    from public.production_stage_readings reading
    join public.production_pieces replacement_piece on replacement_piece.id = reading.piece_id and replacement_piece.is_replacement is true
    join public.replacement_orders replacement on replacement.replacement_piece_id = replacement_piece.id
    join public.production_pieces original_piece on original_piece.id = replacement.original_piece_id
    where reading.event_type = 'replacement_approval'
      and public.normalize_replacement_step_code(reading.step_name) = v_cell_code
      and reading.created_at >= v_shift_start
      and (v_session.machine_id is null or reading.machine_id = v_session.machine_id)
  ) completed;

  update public.operator_sessions set last_seen_at = clock_timestamp() where id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'session', jsonb_build_object(
      'operator_id', v_operator.id,
      'operator_name', v_operator.name,
      'cell_id', v_session.cell_id,
      'cell_name', v_session.cell_name_snapshot,
      'machine_id', v_session.machine_id,
      'machine_name', v_session.machine_name_snapshot,
      'station_name', v_session.station_name_snapshot,
      'shift', v_session.shift_snapshot
    ),
    'available', v_available,
    'on_way', v_on_way,
    'completed', v_completed,
    'summary', jsonb_build_object(
      'available', jsonb_array_length(v_available),
      'on_way', jsonb_array_length(v_on_way),
      'completed', jsonb_array_length(v_completed)
    )
  );
end;
$$;

create or replace function public.collect_replacement_stage_v2(
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
  v_auth_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_code text := btrim(coalesce(p_barcode, ''));
  v_device_id text := btrim(coalesce(p_device_id, ''));
  v_session public.operator_sessions%rowtype;
  v_operator public.operators%rowtype;
  v_cell public.cells%rowtype;
  v_machine public.production_machines%rowtype;
  v_order public.replacement_orders%rowtype;
  v_replacement_piece public.production_pieces%rowtype;
  v_original_piece public.production_pieces%rowtype;
  v_route text[];
  v_completed text[];
  v_expected_code text;
  v_expected_label text;
  v_current_code text;
  v_next_code text;
  v_next_label text;
  v_current_position integer;
  v_expected_position integer;
  v_is_last boolean := false;
  v_reading_id uuid;
  v_existing_result jsonb;
  v_result jsonb;
  v_lot_result jsonb;
  v_next_cell_id uuid;
  v_offline_reconciliation boolean := coalesce((p_payload ->> 'queued_offline')::boolean, false);
begin
  if v_auth_user_id is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'AUTH_REQUIRED', 'message', 'Autenticacao do sistema expirada.');
  end if;
  if v_code = '' then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'EMPTY_BARCODE', 'message', 'Codigo de barras nao informado.');
  end if;
  if p_client_event_id is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'CLIENT_EVENT_REQUIRED', 'message', 'Identificador idempotente da leitura nao informado.');
  end if;
  if v_device_id = '' then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'DEVICE_REQUIRED', 'message', 'Dispositivo do posto nao identificado.');
  end if;

  select event.result_payload into v_existing_result
  from public.production_collection_events event
  where event.client_event_id = p_client_event_id::text;
  if v_existing_result is not null then
    return v_existing_result || jsonb_build_object('idempotent', true);
  end if;

  select * into v_session
  from public.operator_sessions session_row
  where session_row.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
    and session_row.auth_user_id = v_auth_user_id
  for update;

  if v_session.id is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'SESSION_INVALID', 'message', 'Sessao operacional nao localizada para este usuario.');
  end if;
  if v_session.revoked_at is not null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'SESSION_REVOKED', 'message', 'Sessao operacional revogada. Realize novo login.');
  end if;
  if v_session.ended_at is not null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'SESSION_ENDED', 'message', 'Sessao operacional encerrada. Realize novo login.');
  end if;
  if v_session.device_id is distinct from v_device_id then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'DEVICE_MISMATCH', 'message', 'A sessao pertence a outro dispositivo.');
  end if;
  if v_session.expires_at <= v_now and not (
    v_offline_reconciliation
    and p_created_at_client is not null
    and p_created_at_client <= v_session.expires_at
    and v_now <= coalesce(v_session.sync_grace_until, v_session.expires_at + interval '24 hours')
  ) then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'SESSION_EXPIRED', 'message', 'Sessao operacional expirada. Realize novo login.');
  end if;
  if v_session.cell_id is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'CONTEXT_REQUIRED', 'message', 'Selecione a celula e o posto antes de bipar.');
  end if;

  select * into v_operator from public.operators where id = v_session.operator_id;
  if v_operator.id is null or v_operator.active is not true or coalesce(v_operator.login_enabled, true) is not true then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'OPERATOR_INACTIVE', 'message', 'Operador inativo ou sem acesso a coleta.');
  end if;

  select * into v_cell from public.cells where id = v_session.cell_id and active = true;
  if v_cell.id is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'WRONG_CELL', 'message', 'Celula da sessao inativa ou inexistente.');
  end if;

  if not exists (
    select 1 from public.operator_cell_assignments assignment
    where assignment.operator_id = v_operator.id
      and assignment.cell_id = v_cell.id
      and assignment.active = true
      and assignment.valid_from <= v_now
      and (assignment.valid_until is null or assignment.valid_until > v_now)
  ) then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'OPERATOR_UNAUTHORIZED', 'message', 'Operador nao autorizado para esta celula.');
  end if;

  if v_session.machine_id is not null then
    select * into v_machine from public.production_machines where id = v_session.machine_id;
    if v_machine.id is null
       or v_machine.active is not true
       or v_machine.allows_replacement is not true then
      return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'MACHINE_INACTIVE', 'message', 'Maquina inativa ou nao habilitada para reposicao.');
    end if;
    if lower(btrim(v_machine.cell_name)) <> lower(btrim(v_cell.name)) then
      return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'WRONG_MACHINE', 'message', 'Maquina nao pertence a celula da sessao.');
    end if;
    if exists (
      select 1 from public.operator_machine_assignments assignment
      where assignment.operator_id = v_operator.id
        and assignment.active = true
        and assignment.valid_from <= v_now
        and (assignment.valid_until is null or assignment.valid_until > v_now)
    ) and not exists (
      select 1 from public.operator_machine_assignments assignment
      where assignment.operator_id = v_operator.id
        and assignment.machine_id = v_machine.id
        and assignment.active = true
        and assignment.valid_from <= v_now
        and (assignment.valid_until is null or assignment.valid_until > v_now)
    ) then
      return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'OPERATOR_UNAUTHORIZED', 'message', 'Operador nao autorizado para esta maquina.');
    end if;
  end if;

  if exists (
    select 1 from public.workstation_operator_authorizations authz
    where authz.is_active = true
      and authz.training_validated = true
      and authz.valid_from <= v_now
      and (authz.valid_until is null or authz.valid_until > v_now)
      and (authz.cell_id = v_cell.id or authz.machine_id = v_session.machine_id)
  ) and not exists (
    select 1 from public.workstation_operator_authorizations authz
    where authz.operator_id = v_operator.id
      and authz.is_active = true
      and authz.training_validated = true
      and authz.valid_from <= v_now
      and (authz.valid_until is null or authz.valid_until > v_now)
      and (authz.cell_id = v_cell.id or authz.machine_id = v_session.machine_id)
      and (authz.shift is null or authz.shift = v_session.shift_snapshot)
  ) then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'OPERATOR_UNAUTHORIZED', 'message', 'Operador sem autorizacao vigente para o posto.');
  end if;

  select replacement.* into v_order
  from public.replacement_orders replacement
  join public.production_pieces piece on piece.id = replacement.replacement_piece_id
  where replacement.replacement_piece_id is not null
    and (
      replacement.replacement_barcode = v_code
      or replacement.replacement_code = v_code
      or piece.piece_uid = v_code
      or piece.traceability_code = v_code
      or piece.piece_code = v_code
      or piece.id::text = v_code
    )
  order by case when replacement.status in ('released', 'in_production') then 0 else 1 end,
           replacement.created_at desc
  limit 1;

  if v_order.id is null then
    if exists (
      select 1
      from public.replacement_orders replacement
      join public.production_pieces original_piece on original_piece.id = replacement.original_piece_id
      where original_piece.piece_uid = v_code
         or original_piece.traceability_code = v_code
         or original_piece.piece_code = v_code
         or original_piece.id::text = v_code
    ) then
      return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'ORIGINAL_PIECE_NOT_ALLOWED', 'message', 'Bipe a etiqueta da peca substituta. A peca original permanece reprovada.');
    end if;
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'CODE_NOT_FOUND', 'message', 'Codigo inexistente ou sem ordem de reposicao vinculada.');
  end if;

  select * into v_order from public.replacement_orders where id = v_order.id for update;
  perform 1
  from public.production_pieces piece
  where piece.id in (v_order.original_piece_id, v_order.replacement_piece_id)
  order by piece.id
  for update;
  select * into v_replacement_piece from public.production_pieces where id = v_order.replacement_piece_id;
  select * into v_original_piece from public.production_pieces where id = v_order.original_piece_id;

  if v_order.status in ('cancelled', 'Cancelada') then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'ORDER_CANCELLED', 'message', 'Ordem de reposicao cancelada.');
  end if;
  if v_order.status in ('completed', 'Finalizada') then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'STAGE_ALREADY_COMPLETED', 'message', 'Reposicao ja concluida.');
  end if;
  if v_order.status not in ('released', 'in_production') then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'ORDER_NOT_RELEASED', 'message', 'Ordem ainda nao foi liberada pela gestao.');
  end if;
  if v_replacement_piece.id is null or v_replacement_piece.is_replacement is not true
     or v_replacement_piece.original_piece_id is distinct from v_original_piece.id then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'INVALID_REPLACEMENT_PIECE', 'message', 'Peca substituta invalida ou sem vinculo com a original.');
  end if;
  if v_replacement_piece.is_blocked is true or v_replacement_piece.status = 'blocked' then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'PIECE_BLOCKED', 'message', coalesce(v_replacement_piece.block_reason, 'Peca bloqueada para producao.'));
  end if;
  if v_replacement_piece.lot_id is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'LOT_NOT_FOUND', 'message', 'Peca substituta sem lote produtivo.');
  end if;

  v_route := coalesce(v_replacement_piece.route_steps, v_original_piece.route_steps, array[]::text[]);
  v_completed := coalesce(v_replacement_piece.completed_steps, array[]::text[]);
  v_current_code := public.normalize_replacement_step_code(v_cell.name);

  select route.code, route.ord::integer, public.canonical_stage_label(route.step)
  into v_expected_code, v_expected_position, v_expected_label
  from (
    select step, public.normalize_replacement_step_code(step) as code, ord
    from unnest(v_route) with ordinality route_step(step, ord)
  ) route
  where not exists (
    select 1 from unnest(v_completed) completed_step
    where public.normalize_replacement_step_code(completed_step) = route.code
  )
  order by route.ord
  limit 1;

  if v_expected_code is null then
    return jsonb_build_object('success', false, 'result_status', 'blocked', 'reason_code', 'STAGE_ALREADY_COMPLETED', 'message', 'Todas as etapas obrigatorias desta reposicao ja foram concluidas.');
  end if;

  select min(route.ord)::integer into v_current_position
  from (
    select public.normalize_replacement_step_code(step) as code, ord
    from unnest(v_route) with ordinality route_step(step, ord)
  ) route
  where route.code = v_current_code;

  if v_current_position is null then
    return jsonb_build_object(
      'success', false, 'result_status', 'blocked', 'reason_code', 'STAGE_NOT_IN_ROUTE',
      'expected_stage', v_expected_label, 'expected_cell', v_expected_label,
      'message', format('A celula %s nao pertence a rota desta peca.', v_cell.name)
    );
  end if;
  if v_current_code <> v_expected_code then
    return jsonb_build_object(
      'success', false,
      'result_status', 'blocked',
      'reason_code', case when v_current_position > v_expected_position then 'PREVIOUS_STAGE_PENDING' else 'WRONG_CELL' end,
      'expected_stage', v_expected_label,
      'expected_cell', v_expected_label,
      'message', format('Etapa anterior pendente. A proxima baixa obrigatoria e %s.', v_expected_label)
    );
  end if;

  if exists (select 1 from public.production_stage_readings where client_event_id = p_client_event_id::text) then
    select event.result_payload into v_existing_result
    from public.production_collection_events event
    where event.client_event_id = p_client_event_id::text;
    return coalesce(v_existing_result, jsonb_build_object(
      'success', true, 'result_status', 'approved', 'reason_code', 'IDEMPOTENT_EVENT',
      'replacement_order_id', v_order.id, 'completed_stage', v_expected_label,
      'message', 'Evento ja confirmado anteriormente.'
    )) || jsonb_build_object('idempotent', true);
  end if;

  select route.code, public.canonical_stage_label(route.step)
  into v_next_code, v_next_label
  from (
    select step, public.normalize_replacement_step_code(step) as code, ord
    from unnest(v_route) with ordinality route_step(step, ord)
  ) route
  where route.ord > v_expected_position
    and not exists (
      select 1 from unnest(v_completed) completed_step
      where public.normalize_replacement_step_code(completed_step) = route.code
    )
  order by route.ord
  limit 1;
  v_is_last := v_next_code is null;

  insert into public.production_stage_readings (
    lot_id, piece_id, item_id, tag_value, reader_type, step_name, cell_name,
    station_name, machine_id, machine_name, operator, operator_id,
    operator_name_snapshot, user_id, shift, date, hour, status, event_type,
    client_event_id, notes, created_at, quantity, production_order_id,
    lot_code, order_number, customer_name, environment_name, operation_name,
    piece_code, traceability_type, general_lot_code
  ) values (
    v_replacement_piece.lot_id,
    v_replacement_piece.id,
    v_replacement_piece.legacy_production_lot_item_id,
    v_code,
    'keyboard_barcode',
    v_expected_code,
    v_cell.name,
    coalesce(v_session.station_name_snapshot, 'Posto de Reposicao'),
    v_machine.id,
    v_machine.name,
    v_operator.name,
    v_operator.id,
    v_operator.name,
    v_auth_user_id,
    coalesce(v_session.shift_snapshot, v_operator.shift, '1'),
    current_date,
    to_char(v_now, 'HH24:MI'),
    'approved',
    'replacement_approval',
    p_client_event_id::text,
    format('Baixa real da reposicao %s em %s.', coalesce(v_order.replacement_code, v_order.id::text), v_expected_label),
    v_now,
    1,
    v_replacement_piece.production_order_id,
    coalesce(v_replacement_piece.lot_code, v_order.lot_code),
    coalesce(v_replacement_piece.order_number, v_order.order_number),
    coalesce(v_replacement_piece.customer_name, v_order.customer_name),
    coalesce(v_replacement_piece.environment_name, v_order.environment_name),
    v_expected_code,
    case when v_is_last then 'approved_via_replacement' else 'replacement_stage' end,
    coalesce(v_replacement_piece.general_lot_code, v_order.general_lot_code)
  ) returning id into v_reading_id;

  update public.production_pieces
  set completed_steps = array_append(v_completed, v_expected_code),
      current_stage = coalesce(v_next_code, 'completed'),
      status = case when v_is_last then 'completed' else 'in_production' end,
      replacement_status = case when v_is_last then 'replaced' else 'in_production' end,
      updated_at = v_now
  where id = v_replacement_piece.id;

  update public.production_pieces
  set status = case when v_is_last then 'replaced' else 'rejected' end,
      replacement_status = case when v_is_last then 'replaced' else 'in_production' end,
      updated_at = v_now
  where id = v_original_piece.id;

  update public.replacement_orders
  set status = case when v_is_last then 'completed' else 'in_production' end,
      completed_at = case when v_is_last then coalesce(completed_at, v_now) else completed_at end,
      updated_at = v_now
  where id = v_order.id;

  if v_is_last then
    update public.quality_nonconformities
    set status = 'resolved',
        closed_at = coalesce(closed_at, v_now),
        closed_by = coalesce(closed_by, v_auth_user_id),
        updated_at = v_now
    where related_replacement_id = v_order.id
       or piece_id = v_original_piece.id;
  end if;

  v_lot_result := public.recalculate_replacement_lot_v2(v_replacement_piece.lot_id);
  if v_is_last and coalesce((v_lot_result ->> 'lot_completed')::boolean, false) then
    update public.production_stage_readings
    set notes = concat_ws(' ', notes, v_lot_result ->> 'message')
    where id = v_reading_id;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'result_status', 'approved',
    'reason_code', 'STAGE_COLLECTED_SUCCESSFULLY',
    'client_event_id', p_client_event_id,
    'reading_id', v_reading_id,
    'replacement_order_id', v_order.id,
    'replacement_piece_id', v_replacement_piece.id,
    'replacement_code', v_order.replacement_code,
    'completed_stage', v_expected_label,
    'next_stage', v_next_label,
    'is_last_stage', v_is_last,
    'replacement_completed', v_is_last,
    'lot', v_lot_result,
    'message', case
      when v_is_last then format('%s concluida. Reposicao finalizada com rastreabilidade.', v_expected_label)
      else format('%s concluida. Peca liberada para %s.', v_expected_label, v_next_label)
    end
  );

  insert into public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type, operator_id,
    operator_name, cell_name, cell_id, shift, date, hour, status, result_status,
    reading_id, lot_id, production_order_id, payload, result_payload,
    created_at_client, processed_at, operator_session_id, device_id, piece_id,
    machine_id, machine_name, station_name, operation_name, lot_code,
    order_number, customer_name, environment_name, piece_code, general_lot_code
  ) values (
    p_client_event_id::text, v_code, upper(v_code), 'keyboard_barcode', v_operator.id,
    v_operator.name, v_cell.name, v_cell.id, coalesce(v_session.shift_snapshot, v_operator.shift),
    current_date, to_char(v_now, 'HH24:MI'), 'synced', 'approved',
    v_reading_id, v_replacement_piece.lot_id, v_replacement_piece.production_order_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('event_kind', 'replacement_stage'),
    v_result, coalesce(p_created_at_client, v_now), v_now, v_session.id, v_device_id,
    v_replacement_piece.id, v_machine.id, v_machine.name,
    coalesce(v_session.station_name_snapshot, 'Posto de Reposicao'), v_expected_code,
    coalesce(v_replacement_piece.lot_code, v_order.lot_code),
    coalesce(v_replacement_piece.order_number, v_order.order_number),
    coalesce(v_replacement_piece.customer_name, v_order.customer_name),
    coalesce(v_replacement_piece.environment_name, v_order.environment_name),
    v_replacement_piece.piece_code,
    coalesce(v_replacement_piece.general_lot_code, v_order.general_lot_code)
  );

  insert into public.system_audit_logs (
    user_id, user_name, action, entity, entity_id, page, route, device_id,
    session_id, success, metadata
  ) values (
    v_auth_user_id, v_operator.name,
    case when v_is_last then 'replacement_completed_via_station' else 'replacement_stage_collected_v2' end,
    'replacement_orders', v_order.id::text, 'Posto de Reposicao', '/reposicao/posto',
    v_device_id, v_session.id::text, true,
    jsonb_build_object(
      'operator_id', v_operator.id,
      'cell_id', v_cell.id,
      'cell_name', v_cell.name,
      'machine_id', v_machine.id,
      'machine_name', v_machine.name,
      'shift', v_session.shift_snapshot,
      'barcode', v_code,
      'client_event_id', p_client_event_id,
      'completed_stage', v_expected_label,
      'next_stage', v_next_label,
      'lot_result', v_lot_result
    )
  );

  perform realtime.send(
    jsonb_build_object(
      'replacement_order_id', v_order.id,
      'replacement_code', v_order.replacement_code,
      'lot_code', coalesce(v_order.lot_code, v_replacement_piece.lot_code),
      'completed_stage', v_expected_label,
      'next_stage', v_next_label,
      'message', v_result ->> 'message'
    ),
    'replacement_queue_updated',
    format('replacement:cell:%s', v_cell.id),
    true
  );

  if v_next_code is not null then
    select cell.id into v_next_cell_id
    from public.cells cell
    where cell.active = true
      and public.normalize_replacement_step_code(cell.name) = v_next_code
    order by cell.name
    limit 1;
    if v_next_cell_id is not null and v_next_cell_id <> v_cell.id then
      perform realtime.send(
        jsonb_build_object(
          'replacement_order_id', v_order.id,
          'replacement_code', v_order.replacement_code,
          'lot_code', coalesce(v_order.lot_code, v_replacement_piece.lot_code),
          'completed_stage', v_expected_label,
          'next_stage', v_next_label,
          'message', format('Nova reposicao disponivel na sua celula: %s - Lote %s.', coalesce(v_order.replacement_code, 'REP'), coalesce(v_order.lot_code, v_replacement_piece.lot_code, '-'))
        ),
        'replacement_available',
        format('replacement:cell:%s', v_next_cell_id),
        true
      );
    end if;
  end if;

  return v_result;
exception
  when unique_violation then
    select event.result_payload into v_existing_result
    from public.production_collection_events event
    where event.client_event_id = p_client_event_id::text;
    if v_existing_result is not null then
      return v_existing_result || jsonb_build_object('idempotent', true);
    end if;
    return jsonb_build_object(
      'success', false,
      'result_status', 'blocked',
      'reason_code', 'STAGE_ALREADY_COMPLETED',
      'expected_stage', v_expected_label,
      'message', 'A etapa foi concluida simultaneamente em outro posto. Atualize a fila.'
    );
end;
$$;

-- Remove a API antiga e seus overloads ambiguos. O frontend passa a usar somente v2.
drop function if exists public.collect_replacement_stage(text, uuid, uuid, text, text, uuid, uuid, uuid);
drop function if exists public.collect_replacement_stage(text, uuid, uuid, uuid, uuid, uuid, text, text, jsonb);
drop function if exists public.collect_replacement_stage(text, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb);

revoke all on function public.operator_login_v2(text, text, text) from public, anon;
revoke all on function public.set_operator_session_context(text, uuid, uuid, text) from public, anon;
revoke all on function public.heartbeat_operator_session(text) from public, anon;
revoke all on function public.logout_operator_session(text) from public, anon;
revoke all on function public.get_replacement_station_queue_v2(text, text) from public, anon;
revoke all on function public.collect_replacement_stage_v2(text, text, uuid, text, timestamptz, jsonb) from public, anon;
revoke all on function public.recalculate_replacement_lot_v2(uuid) from public, anon, authenticated;

grant execute on function public.operator_login_v2(text, text, text) to authenticated;
grant execute on function public.set_operator_session_context(text, uuid, uuid, text) to authenticated;
grant execute on function public.heartbeat_operator_session(text) to authenticated;
grant execute on function public.logout_operator_session(text) to authenticated;
grant execute on function public.get_replacement_station_queue_v2(text, text) to authenticated;
grant execute on function public.collect_replacement_stage_v2(text, text, uuid, text, timestamptz, jsonb) to authenticated;

-- Realtime Authorization e a unica alteracao permitida no schema interno.
-- Nenhuma tabela, funcao ou trigger e criada no schema realtime.
drop policy if exists replacement_cell_broadcast_read on realtime.messages;
create policy replacement_cell_broadcast_read
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) like 'replacement:cell:%'
  and exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.active is distinct from false
      and (
        profile.role in ('admin', 'manager', 'supervisor')
        or exists (
          select 1
          from public.operators operator_row
          join public.operator_cell_assignments assignment
            on assignment.operator_id = operator_row.id
           and assignment.active = true
           and assignment.valid_from <= clock_timestamp()
           and (assignment.valid_until is null or assignment.valid_until > clock_timestamp())
          where operator_row.profile_id = profile.id
            and assignment.cell_id::text = split_part((select realtime.topic()), ':', 3)
        )
      )
  )
);

comment on function public.collect_replacement_stage_v2(text, text, uuid, text, timestamptz, jsonb)
  is 'Baixa transacional estritamente sequencial de reposicao, vinculada a sessao operacional e dispositivo.';

comment on function public.get_replacement_station_queue_v2(text, text)
  is 'Fila operacional de reposicao derivada da primeira etapa pendente da rota real da peca.';

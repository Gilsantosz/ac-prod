-- AC.Prod — remediation of the 11 findings from the 2026-08-12 Codex Security scan.
-- Privileged implementations remain private. Public RPC names are retained as
-- authorization wrappers so existing clients keep the same contract.

begin;

-- ---------------------------------------------------------------------------
-- 1. New Auth users never inherit authorization from user-controlled metadata.
-- The admin-users Edge Function performs the explicit privileged upsert after
-- Auth creation, so a fixed inactive/operator bootstrap remains compatible.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, name, email, role, permissions, active)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    'operator',
    '{}'::jsonb,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Quality rejection: authorize before the first mutation, resolve the piece
-- and its latest recorded cell server-side, and pass only the canonical cell to
-- the original atomic implementation.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.register_quality_rejection_impl(jsonb)') is null then
    alter function public.register_quality_rejection(jsonb)
      rename to register_quality_rejection_impl;
  end if;
end
$$;

revoke all on function public.register_quality_rejection_impl(jsonb)
  from public, anon, authenticated;
grant execute on function public.register_quality_rejection_impl(jsonb)
  to service_role;

create or replace function public.register_quality_rejection(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_piece_id uuid;
  v_piece_stage text;
  v_lot_id uuid;
  v_requested_cell text := nullif(btrim(p_payload->>'cell_name'), '');
  v_authoritative_cell text;
  v_cell_id uuid;
  v_sanitized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_manage_quality() then
    raise exception 'QUALITY_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  if coalesce(p_payload->>'piece_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_piece_id := (p_payload->>'piece_id')::uuid;
  end if;

  select piece.id, piece.current_stage, piece.lot_id
    into v_piece_id, v_piece_stage, v_lot_id
  from public.production_pieces piece
  where (v_piece_id is not null and piece.id = v_piece_id)
     or (
       v_piece_id is null
       and nullif(btrim(p_payload->>'traceability_code'), '') is not null
       and (
         piece.piece_uid = p_payload->>'traceability_code'
         or piece.traceability_code = p_payload->>'traceability_code'
         or piece.piece_code = p_payload->>'traceability_code'
         or piece.id::text = p_payload->>'traceability_code'
       )
     )
  order by case when v_piece_id is not null and piece.id = v_piece_id then 0 else 1 end
  limit 1;

  if v_piece_id is null then
    raise exception 'QUALITY_PIECE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select cell.id, cell.name
    into v_cell_id, v_authoritative_cell
  from public.production_stage_readings reading
  join public.cells cell
    on coalesce(cell.active, true)
   and public.normalize_production_name(cell.name) =
       public.normalize_production_name(reading.cell_name)
  where reading.piece_id = v_piece_id
    and nullif(btrim(reading.cell_name), '') is not null
  order by reading.created_at desc, reading.id desc
  limit 1;

  if v_authoritative_cell is null and v_lot_id is not null then
    select nullif(btrim(lot.current_cell), '')
      into v_authoritative_cell
    from public.production_lots lot
    where lot.id = v_lot_id;
  end if;

  if v_authoritative_cell is null and nullif(btrim(v_piece_stage), '') is not null then
    select cell.name, cell.id
      into v_authoritative_cell, v_cell_id
    from public.routing_steps step
    join public.cells cell on cell.id = step.cell_id
    where coalesce(step.active, true)
      and coalesce(cell.active, true)
      and (
        step.code = v_piece_stage
        or public.normalize_production_name(step.name) = public.normalize_production_name(v_piece_stage)
      )
    order by step.sequence nulls last, step.id
    limit 1;
  end if;

  if v_authoritative_cell is not null then
    select cell.id, cell.name
      into v_cell_id, v_authoritative_cell
    from public.cells cell
    where coalesce(cell.active, true)
      and public.normalize_production_name(cell.name) =
          public.normalize_production_name(v_authoritative_cell)
    order by cell.created_at, cell.id
    limit 1;
  end if;

  if v_authoritative_cell is null then
    raise exception 'QUALITY_CELL_UNRESOLVED' using errcode = '42501';
  end if;

  if v_requested_cell is not null
     and public.normalize_production_name(v_requested_cell) <>
         public.normalize_production_name(v_authoritative_cell) then
    raise exception 'QUALITY_CELL_MISMATCH' using errcode = '42501';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not public.profile_can_access_cell(v_authoritative_cell) then
    raise exception 'QUALITY_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;

  v_sanitized_payload := jsonb_set(
    v_sanitized_payload,
    '{cell_name}',
    to_jsonb(v_authoritative_cell),
    true
  );
  if v_cell_id is not null then
    v_sanitized_payload := jsonb_set(
      v_sanitized_payload,
      '{cell_id}',
      to_jsonb(v_cell_id::text),
      true
    );
  else
    v_sanitized_payload := v_sanitized_payload - 'cell_id';
  end if;

  return public.register_quality_rejection_impl(v_sanitized_payload);
end;
$$;

revoke all on function public.register_quality_rejection(jsonb) from public, anon;
grant execute on function public.register_quality_rejection(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Downtime RPCs: resolve an active canonical cell from cell/machine input,
-- reject conflicting identifiers, then enforce permission and cell scope.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_downtime_target_cell(p_payload jsonb)
returns table (cell_id uuid, cell_name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_requested_cell_id uuid;
  v_machine_id uuid;
  v_requested_name text := nullif(btrim(p_payload->>'cell_name'), '');
  v_cell_by_id_id uuid;
  v_cell_by_id_name text;
  v_cell_by_name_id uuid;
  v_cell_by_name_name text;
  v_machine_cell text;
begin
  begin
    v_requested_cell_id := nullif(p_payload->>'cell_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'DOWNTIME_CELL_INVALID' using errcode = '22023';
  end;

  begin
    v_machine_id := nullif(p_payload->>'machine_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'DOWNTIME_MACHINE_INVALID' using errcode = '22023';
  end;

  if v_requested_cell_id is not null then
    select cell.id, cell.name into v_cell_by_id_id, v_cell_by_id_name
    from public.cells cell
    where cell.id = v_requested_cell_id and coalesce(cell.active, true);
    if v_cell_by_id_id is null then
      raise exception 'DOWNTIME_CELL_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if v_requested_name is not null then
    select cell.id, cell.name into v_cell_by_name_id, v_cell_by_name_name
    from public.cells cell
    where coalesce(cell.active, true)
      and public.normalize_production_name(cell.name) =
          public.normalize_production_name(v_requested_name)
    order by cell.created_at, cell.id
    limit 1;
    if v_cell_by_name_id is null then
      raise exception 'DOWNTIME_CELL_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if v_machine_id is not null then
    select nullif(btrim(machine.cell_name), '') into v_machine_cell
    from public.production_machines machine
    where machine.id = v_machine_id and coalesce(machine.active, true);
    if v_machine_cell is null then
      raise exception 'DOWNTIME_MACHINE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  if v_cell_by_id_id is not null and v_cell_by_name_id is not null
     and v_cell_by_id_id <> v_cell_by_name_id then
    raise exception 'DOWNTIME_CELL_MISMATCH' using errcode = '42501';
  end if;

  cell_id := coalesce(v_cell_by_id_id, v_cell_by_name_id);
  cell_name := coalesce(v_cell_by_id_name, v_cell_by_name_name, v_machine_cell);

  if v_machine_cell is not null and cell_name is not null
     and public.normalize_production_name(v_machine_cell) <>
         public.normalize_production_name(cell_name) then
    raise exception 'DOWNTIME_MACHINE_CELL_MISMATCH' using errcode = '42501';
  end if;

  if cell_id is null and v_machine_cell is not null then
    select cell.id, cell.name into cell_id, cell_name
    from public.cells cell
    where coalesce(cell.active, true)
      and public.normalize_production_name(cell.name) =
          public.normalize_production_name(v_machine_cell)
    order by cell.created_at, cell.id
    limit 1;
  end if;

  if cell_id is null or cell_name is null then
    raise exception 'DOWNTIME_CELL_REQUIRED' using errcode = '22023';
  end if;

  return next;
end;
$$;

revoke all on function public.resolve_downtime_target_cell(jsonb)
  from public, anon, authenticated;
grant execute on function public.resolve_downtime_target_cell(jsonb) to service_role;

do $$
begin
  if to_regprocedure('public.start_production_downtime_impl(jsonb)') is null then
    alter function public.start_production_downtime(jsonb)
      rename to start_production_downtime_impl;
  end if;
  if to_regprocedure('public.finish_production_downtime_impl(uuid,jsonb)') is null then
    alter function public.finish_production_downtime(uuid, jsonb)
      rename to finish_production_downtime_impl;
  end if;
  if to_regprocedure('public.register_production_downtime_impl(jsonb)') is null then
    alter function public.register_production_downtime(jsonb)
      rename to register_production_downtime_impl;
  end if;
  if to_regprocedure('public.correct_production_downtime_impl(uuid,jsonb)') is null then
    alter function public.correct_production_downtime(uuid, jsonb)
      rename to correct_production_downtime_impl;
  end if;
end
$$;

revoke all on function public.start_production_downtime_impl(jsonb)
  from public, anon, authenticated;
revoke all on function public.finish_production_downtime_impl(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.register_production_downtime_impl(jsonb)
  from public, anon, authenticated;
revoke all on function public.correct_production_downtime_impl(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_production_downtime_impl(jsonb) to service_role;
grant execute on function public.finish_production_downtime_impl(uuid, jsonb) to service_role;
grant execute on function public.register_production_downtime_impl(jsonb) to service_role;
grant execute on function public.correct_production_downtime_impl(uuid, jsonb) to service_role;

create or replace function public.start_production_downtime(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cell record;
  v_sanitized jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_manage_occurrences() then
    raise exception 'OCCURRENCE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  select * into v_cell from public.resolve_downtime_target_cell(v_sanitized);
  if coalesce(auth.role(), '') <> 'service_role' and not public.profile_can_access_cell(v_cell.cell_name) then
    raise exception 'OCCURRENCE_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;
  v_sanitized := jsonb_set(v_sanitized, '{cell_name}', to_jsonb(v_cell.cell_name), true);
  v_sanitized := jsonb_set(v_sanitized, '{cell_id}', to_jsonb(v_cell.cell_id::text), true);
  return public.start_production_downtime_impl(v_sanitized);
end;
$$;

create or replace function public.register_production_downtime(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cell record;
  v_sanitized jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_manage_occurrences() then
    raise exception 'OCCURRENCE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  select * into v_cell from public.resolve_downtime_target_cell(v_sanitized);
  if coalesce(auth.role(), '') <> 'service_role' and not public.profile_can_access_cell(v_cell.cell_name) then
    raise exception 'OCCURRENCE_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;
  v_sanitized := jsonb_set(v_sanitized, '{cell_name}', to_jsonb(v_cell.cell_name), true);
  v_sanitized := jsonb_set(v_sanitized, '{cell_id}', to_jsonb(v_cell.cell_id::text), true);
  return public.register_production_downtime_impl(v_sanitized);
end;
$$;

create or replace function public.finish_production_downtime(
  p_occurrence_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cell_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_manage_occurrences() then
    raise exception 'OCCURRENCE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  select coalesce(cell.name, occurrence.cell)
    into v_cell_name
  from public.occurrences occurrence
  left join public.cells cell on cell.id = occurrence.cell_id
  where occurrence.id = p_occurrence_id
    and occurrence.occurrence_type = 'downtime';
  if v_cell_name is null then
    raise exception 'DOWNTIME_OCCURRENCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not public.profile_can_access_cell(v_cell_name) then
    raise exception 'OCCURRENCE_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;
  return public.finish_production_downtime_impl(p_occurrence_id, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.correct_production_downtime(
  p_occurrence_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cell_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_manage_occurrences() then
    raise exception 'OCCURRENCE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  select coalesce(cell.name, occurrence.cell)
    into v_cell_name
  from public.occurrences occurrence
  left join public.cells cell on cell.id = occurrence.cell_id
  where occurrence.id = p_occurrence_id
    and occurrence.occurrence_type = 'downtime';
  if v_cell_name is null then
    raise exception 'DOWNTIME_OCCURRENCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not public.profile_can_access_cell(v_cell_name) then
    raise exception 'OCCURRENCE_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;
  return public.correct_production_downtime_impl(p_occurrence_id, coalesce(p_payload, '{}'::jsonb));
end;
$$;

revoke all on function public.start_production_downtime(jsonb) from public, anon;
revoke all on function public.finish_production_downtime(uuid, jsonb) from public, anon;
revoke all on function public.register_production_downtime(jsonb) from public, anon;
revoke all on function public.correct_production_downtime(uuid, jsonb) from public, anon;
grant execute on function public.start_production_downtime(jsonb) to authenticated, service_role;
grant execute on function public.finish_production_downtime(uuid, jsonb) to authenticated, service_role;
grant execute on function public.register_production_downtime(jsonb) to authenticated, service_role;
grant execute on function public.correct_production_downtime(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Manual untraceable volume: resolve the exact cell the implementation will
-- write, enforce scope, and replace the caller value with that canonical name.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.register_untraceable_stage_quantity_impl(jsonb)') is null then
    alter function public.register_untraceable_stage_quantity(jsonb)
      rename to register_untraceable_stage_quantity_impl;
  end if;
end
$$;

revoke all on function public.register_untraceable_stage_quantity_impl(jsonb)
  from public, anon, authenticated;
grant execute on function public.register_untraceable_stage_quantity_impl(jsonb)
  to service_role;

create or replace function public.register_untraceable_stage_quantity(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_requested_cell text := nullif(btrim(p_payload->>'cell_name'), '');
  v_stage_code text;
  v_cell_id uuid;
  v_cell_name text;
  v_role text := public.get_my_role();
  v_sanitized jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null
    or not (
      v_role in ('admin', 'manager', 'supervisor')
      or public.has_permission('register_manual_production')
    )
  ) then
    raise exception 'MANUAL_PRODUCTION_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  if v_requested_cell is null then
    raise exception 'MANUAL_PRODUCTION_CELL_REQUIRED' using errcode = '22023';
  end if;

  v_stage_code := public.resolve_production_stage_for_cell(null, v_requested_cell);
  select cell.id, cell.name
    into v_cell_id, v_cell_name
  from public.cells cell
  where coalesce(cell.active, true)
    and public.resolve_production_stage_for_cell(cell.id, cell.name) = v_stage_code
  order by
    case when public.normalize_production_name(cell.name) =
                   public.normalize_production_name(v_requested_cell) then 0 else 1 end,
    cell.created_at,
    cell.id
  limit 1;

  if v_cell_id is null then
    raise exception 'MANUAL_PRODUCTION_CELL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' and not public.profile_can_access_cell(v_cell_name) then
    raise exception 'MANUAL_PRODUCTION_OUTSIDE_CELL_SCOPE' using errcode = '42501';
  end if;

  v_sanitized := jsonb_set(v_sanitized, '{cell_name}', to_jsonb(v_cell_name), true);
  return public.register_untraceable_stage_quantity_impl(v_sanitized);
end;
$$;

revoke all on function public.register_untraceable_stage_quantity(jsonb) from public, anon;
grant execute on function public.register_untraceable_stage_quantity(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Bind operational tokens to the Supabase user that created the session.
-- Any still-active unbound legacy token is revoked rather than guessed/migrated.
-- ---------------------------------------------------------------------------

update public.operator_sessions
set revoked_at = coalesce(revoked_at, now()),
    ended_at = coalesce(ended_at, now()),
    last_seen_at = now()
where auth_user_id is null
  and ended_at is null
  and revoked_at is null;

create or replace function public.process_production_reading(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, realtime
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_session_token text := nullif(btrim(p_payload->>'operatorSessionToken'), '');
  v_client_event_id text := nullif(btrim(p_payload->>'client_event_id'), '');
  v_session_valid boolean := false;
  v_result jsonb;
begin
  if v_auth_user_id is null or v_session_token is null then
    raise exception 'OPERATOR_SESSION_REQUIRED'
      using errcode = '42501', hint = 'Faça o login operacional antes de coletar.';
  end if;

  select exists (
    select 1
    from public.operator_sessions session
    join public.operators operator on operator.id = session.operator_id
    where session.token_hash = encode(extensions.digest(v_session_token, 'sha256'), 'hex')
      and session.auth_user_id = v_auth_user_id
      and session.ended_at is null
      and session.revoked_at is null
      and session.expires_at > now()
      and operator.active is true
      and operator.login_enabled is true
  ) into v_session_valid;

  if not v_session_valid then
    raise exception 'OPERATOR_SESSION_INVALID'
      using errcode = '42501', hint = 'Entre novamente com o operador autorizado.';
  end if;

  v_result := public.process_production_reading_impl(p_payload);
  v_client_event_id := coalesce(
    v_client_event_id,
    nullif(v_result #>> '{reading,client_event_id}', '')
  );
  return public.finalize_collection_realtime(v_client_event_id, v_result);
end;
$$;

revoke all on function public.process_production_reading(jsonb) from public, anon;
grant execute on function public.process_production_reading(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Destructive reset remains available to an active administrator only.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.reset_production_data_impl()') is null then
    alter function public.reset_production_data()
      rename to reset_production_data_impl;
  end if;
end
$$;

revoke all on function public.reset_production_data_impl()
  from public, anon, authenticated;
grant execute on function public.reset_production_data_impl() to service_role;

create or replace function public.reset_production_data()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'ACTIVE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return public.reset_production_data_impl();
end;
$$;

revoke all on function public.reset_production_data() from public, anon;
grant execute on function public.reset_production_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Promob outbound destinations use a service-managed exact-origin allowlist.
-- No origin is trusted implicitly; the Edge Function validates HTTPS/network
-- safety and checks this table before decrypting the bearer token.
-- ---------------------------------------------------------------------------

create table if not exists public.promob_trusted_origins (
  origin text primary key,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint promob_trusted_origins_https_origin check (
    origin ~ '^https://[A-Za-z0-9.-]+(:443)?$'
  )
);

alter table public.promob_trusted_origins enable row level security;
create index if not exists idx_promob_trusted_origins_created_by
  on public.promob_trusted_origins (created_by);
revoke all on table public.promob_trusted_origins from public, anon, authenticated;
grant select, insert, update, delete on table public.promob_trusted_origins to service_role;

create policy promob_trusted_origins_service_role
on public.promob_trusted_origins
for all
to service_role
using (true)
with check (true);

comment on table public.promob_trusted_origins is
  'Exact HTTPS origins approved by a service administrator for secret-bearing Promob requests.';

commit;

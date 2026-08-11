-- AC.Prod — redução da superfície de RPCs SECURITY DEFINER
--
-- As funções operacionais continuam com SECURITY DEFINER para preservar o
-- contrato atual, mas agora validam permissão e escopo antes de executar a
-- implementação privilegiada. Funções internas deixam de ser chamáveis pela
-- API autenticada.

begin;

-- ---------------------------------------------------------------------------
-- Validação compartilhada para leituras da coleta.
-- ---------------------------------------------------------------------------

create or replace function private.assert_collection_read_scope(
  p_cell_id uuid default null,
  p_cell_name text default null
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_profile_role text;
  v_profile_cell text;
  v_managed_cells text[];
  v_cell_from_id text;
  v_cell_from_name text;
  v_requested_cell text;
begin
  if auth.role() = 'service_role' then
    return;
  end if;

  if auth.uid() is null
     or not (
       public.has_permission('view_collection')
       or public.has_permission('register_production')
       or public.has_permission('view_traceability')
       or public.has_permission('view_dashboards')
     ) then
    raise exception 'COLLECTION_VIEW_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  select role, cell, coalesce(managed_cells, '{}'::text[])
    into v_profile_role, v_profile_cell, v_managed_cells
  from public.profiles
  where id = auth.uid()
    and active is true;

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = '42501';
  end if;

  if p_cell_id is not null then
    select name into v_cell_from_id
    from public.cells
    where id = p_cell_id;

    if not found then
      raise exception 'COLLECTION_CELL_NOT_FOUND' using errcode = '22023';
    end if;
  end if;

  if nullif(btrim(p_cell_name), '') is not null then
    select name into v_cell_from_name
    from public.cells
    where lower(btrim(name)) = lower(btrim(p_cell_name))
    order by active desc, name
    limit 1;

    if not found then
      raise exception 'COLLECTION_CELL_NOT_FOUND' using errcode = '22023';
    end if;
  end if;

  if v_cell_from_id is not null
     and v_cell_from_name is not null
     and lower(btrim(v_cell_from_id)) <> lower(btrim(v_cell_from_name)) then
    raise exception 'COLLECTION_CELL_FILTER_MISMATCH' using errcode = '22023';
  end if;

  v_requested_cell := coalesce(v_cell_from_id, v_cell_from_name);

  if v_requested_cell is not null then
    if not public.profile_can_access_cell(v_requested_cell) then
      raise exception 'COLLECTION_OUTSIDE_CELL_SCOPE' using errcode = '42501';
    end if;
    return;
  end if;

  -- Admins e perfis gerenciais sem escopo explícito podem consultar a visão
  -- global. Operadores e qualquer perfil já limitado a células devem filtrar.
  if v_profile_role = 'admin' then
    return;
  end if;

  if v_profile_role = 'operator'
     or array_length(v_managed_cells, 1) is not null
     or nullif(btrim(v_profile_cell), '') is not null then
    raise exception 'COLLECTION_CELL_SCOPE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_collection_read_scope(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Histórico: a implementação existente fica privada e a fachada aplica RBAC,
-- escopo de célula e um limite máximo por página.
-- ---------------------------------------------------------------------------

alter function public.get_collection_history(
  uuid, uuid, uuid, text, text, uuid, integer, integer, timestamptz, timestamptz, text
) rename to get_collection_history_impl;

revoke all on function public.get_collection_history_impl(
  uuid, uuid, uuid, text, text, uuid, integer, integer, timestamptz, timestamptz, text
) from public, anon, authenticated;

create function public.get_collection_history(
  p_cell_id uuid default null,
  p_workstation_id uuid default null,
  p_operator_id uuid default null,
  p_shift text default null,
  p_status text default null,
  p_lot_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_cell_name text default null
)
returns table (
  id uuid,
  event_id uuid,
  client_event_id text,
  created_at timestamptz,
  server_created_at timestamptz,
  processed_at timestamptz,
  date date,
  hour text,
  traceability_code text,
  raw_value text,
  piece_id uuid,
  piece_name text,
  pcp_import_batch_id uuid,
  pcp_batch_name text,
  lot_id uuid,
  lot_code text,
  order_number text,
  client_name text,
  current_stage_name text,
  operation_name text,
  operator_id uuid,
  operator_name text,
  registration text,
  cell_name text,
  machine_id uuid,
  machine_name text,
  station_name text,
  shift text,
  reader_type text,
  event_status text,
  result_status text,
  sync_status text,
  message text,
  route_steps text[],
  completed_steps text[],
  result_payload jsonb
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.assert_collection_read_scope(p_cell_id, p_cell_name);

  return query
  select *
  from public.get_collection_history_impl(
    p_cell_id,
    p_workstation_id,
    p_operator_id,
    p_shift,
    p_status,
    p_lot_id,
    least(greatest(coalesce(p_limit, 50), 1), 500),
    greatest(coalesce(p_offset, 0), 0),
    p_date_from,
    p_date_to,
    p_cell_name
  );
end;
$$;

revoke all on function public.get_collection_history(
  uuid, uuid, uuid, text, text, uuid, integer, integer, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.get_collection_history(
  uuid, uuid, uuid, text, text, uuid, integer, integer, timestamptz, timestamptz, text
) to authenticated, service_role;

alter function public.get_collection_history_count(
  uuid, uuid, uuid, text, text, uuid, timestamptz, timestamptz, text
) rename to get_collection_history_count_impl;

revoke all on function public.get_collection_history_count_impl(
  uuid, uuid, uuid, text, text, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated;

create function public.get_collection_history_count(
  p_cell_id uuid default null,
  p_workstation_id uuid default null,
  p_operator_id uuid default null,
  p_shift text default null,
  p_status text default null,
  p_lot_id uuid default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_cell_name text default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.assert_collection_read_scope(p_cell_id, p_cell_name);

  return public.get_collection_history_count_impl(
    p_cell_id,
    p_workstation_id,
    p_operator_id,
    p_shift,
    p_status,
    p_lot_id,
    p_date_from,
    p_date_to,
    p_cell_name
  );
end;
$$;

revoke all on function public.get_collection_history_count(
  uuid, uuid, uuid, text, text, uuid, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.get_collection_history_count(
  uuid, uuid, uuid, text, text, uuid, timestamptz, timestamptz, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Snapshot/KPIs: somente a fachada validada fica disponível na API.
-- ---------------------------------------------------------------------------

alter function public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz
) rename to get_collection_cell_snapshot_impl;

alter function public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) rename to get_collection_cell_snapshot_impl;

revoke all on function public.get_collection_cell_snapshot_impl(
  text, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_collection_cell_snapshot_impl(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) to service_role;

create function public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid default null,
  p_shift text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.assert_collection_read_scope(null, p_cell_name);
  return public.get_collection_cell_snapshot_impl(
    p_cell_name,
    p_workstation_id,
    p_shift,
    p_date_from,
    p_date_to
  );
end;
$$;

create function public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid,
  p_shift text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_pcp_import_batch_id uuid,
  p_lot_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.assert_collection_read_scope(null, p_cell_name);
  return public.get_collection_cell_snapshot_impl(
    p_cell_name,
    p_workstation_id,
    p_shift,
    p_date_from,
    p_date_to,
    p_pcp_import_batch_id,
    p_lot_id
  );
end;
$$;

revoke all on function public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz
) from public, anon;
revoke all on function public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) from public, anon;
grant execute on function public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz
) to authenticated, service_role;
grant execute on function public.get_collection_cell_snapshot(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Demais RPCs usadas no frontend: RBAC dentro do banco.
-- ---------------------------------------------------------------------------

alter function public.calcular_integridade_do_lote(uuid)
  rename to calcular_integridade_do_lote_impl;
revoke all on function public.calcular_integridade_do_lote_impl(uuid)
  from public, anon, authenticated;

create function public.calcular_integridade_do_lote(p_lot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('manage_lot_integrity')
       or public.has_permission('view_integrity_logs')
       or public.has_permission('view_traceability')
       or public.has_permission('view_pcp')
     ) then
    raise exception 'LOT_INTEGRITY_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return public.calcular_integridade_do_lote_impl(p_lot_id);
end;
$$;

revoke all on function public.calcular_integridade_do_lote(uuid) from public, anon;
grant execute on function public.calcular_integridade_do_lote(uuid)
  to authenticated, service_role;

alter function public.get_collection_context_summary(uuid, uuid)
  rename to get_collection_context_summary_impl;
revoke all on function public.get_collection_context_summary_impl(uuid, uuid)
  from public, anon, authenticated;

create function public.get_collection_context_summary(
  p_lot_id uuid default null,
  p_order_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('view_collection')
       or public.has_permission('register_production')
       or public.has_permission('view_traceability')
     ) then
    raise exception 'COLLECTION_CONTEXT_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return public.get_collection_context_summary_impl(p_lot_id, p_order_id);
end;
$$;

revoke all on function public.get_collection_context_summary(uuid, uuid)
  from public, anon;
grant execute on function public.get_collection_context_summary(uuid, uuid)
  to authenticated, service_role;

alter function public.get_cover_progress(uuid)
  rename to get_cover_progress_impl;
revoke all on function public.get_cover_progress_impl(uuid)
  from public, anon, authenticated;

create function public.get_cover_progress(p_cover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('view_packaging')
       or public.has_permission('manage_packaging')
       or public.has_permission('view_shipping')
       or public.has_permission('manage_shipping')
     ) then
    raise exception 'CUSTOMER_COVER_VIEW_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return public.get_cover_progress_impl(p_cover_id);
end;
$$;

revoke all on function public.get_cover_progress(uuid) from public, anon;
grant execute on function public.get_cover_progress(uuid)
  to authenticated, service_role;

alter function public.create_customer_covers_for_batch(uuid)
  rename to create_customer_covers_for_batch_impl;
revoke all on function public.create_customer_covers_for_batch_impl(uuid)
  from public, anon, authenticated;

create function public.create_customer_covers_for_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role'
     and not (
       public.has_permission('manage_pcp')
       or public.has_permission('manage_packaging')
     ) then
    raise exception 'CUSTOMER_COVER_MANAGE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  perform public.create_customer_covers_for_batch_impl(p_batch_id);
end;
$$;

revoke all on function public.create_customer_covers_for_batch(uuid)
  from public, anon;
grant execute on function public.create_customer_covers_for_batch(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers e gatilhos internos não são endpoints públicos.
-- ---------------------------------------------------------------------------

revoke all on function public.calculate_lot_status(uuid)
  from public, anon, authenticated;
revoke all on function public.get_active_general_lots_progress(integer)
  from public, anon, authenticated;
revoke all on function public.get_client_lot_progress(uuid)
  from public, anon, authenticated;
revoke all on function public.get_general_lot_progress(uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_piece_by_identifier(text)
  from public, anon, authenticated;
revoke all on function public.validate_separation_ready(uuid)
  from public, anon, authenticated;
revoke all on function public.enrich_rejected_reading_context()
  from public, anon, authenticated;
revoke all on function public.enrich_replacement_order_context()
  from public, anon, authenticated;
revoke all on function public.reverse_production_entry_after_rejection()
  from public, anon, authenticated;

grant execute on function public.calculate_lot_status(uuid) to service_role;
grant execute on function public.get_active_general_lots_progress(integer) to service_role;
grant execute on function public.get_client_lot_progress(uuid) to service_role;
grant execute on function public.get_general_lot_progress(uuid) to service_role;
grant execute on function public.resolve_piece_by_identifier(text) to service_role;
grant execute on function public.validate_separation_ready(uuid) to service_role;

notify pgrst, 'reload schema';

commit;

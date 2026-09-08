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

do $$
declare
  v_definition text := pg_get_functiondef(
    'public.register_quality_rejection(jsonb)'::regprocedure
  );
  v_hardened text;
begin
  if position($already$
  select cell.id, cell.name
    into v_cell_id, v_authoritative_cell
  from public.production_stage_readings reading
  join public.cells cell
$already$ in v_definition) > 0 then
    return;
  end if;

  v_hardened := replace(
    v_definition,
    $old$
  select nullif(btrim(reading.cell_name), '')
    into v_authoritative_cell
  from public.production_stage_readings reading
  where reading.piece_id = v_piece_id
    and nullif(btrim(reading.cell_name), '') is not null
$old$,
    $new$
  select cell.id, cell.name
    into v_cell_id, v_authoritative_cell
  from public.production_stage_readings reading
  join public.cells cell
    on coalesce(cell.active, true)
   and public.normalize_production_name(cell.name) =
       public.normalize_production_name(reading.cell_name)
  where reading.piece_id = v_piece_id
    and nullif(btrim(reading.cell_name), '') is not null
$new$
  );
  if v_hardened = v_definition then
    raise exception 'Could not update authoritative quality-cell resolution';
  end if;
  execute v_hardened;
end
$$;

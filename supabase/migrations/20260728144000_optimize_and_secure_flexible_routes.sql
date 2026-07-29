-- Otimiza a leitura de rotas grandes e restringe a integridade a usuários
-- autenticados depois da evolução das etapas opcionais.

create or replace function public.canonical_production_stage_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case
    when public.normalize_production_name(p_value) in ('corte', 'cut', 'cutting') then 'cut'
    when public.normalize_production_name(p_value) in ('borda', 'bordo', 'edge', 'edging') then 'edge'
    when public.normalize_production_name(p_value) in ('fura', 'furacao', 'furadeira', 'drill', 'drilling') then 'drill'
    when public.normalize_production_name(p_value) in ('usinagem', 'usinagemcnc', 'cnc') then 'cnc'
    when public.normalize_production_name(p_value) in ('marcenaria', 'joinery') then 'joinery'
    when public.normalize_production_name(p_value) in ('separacao', 'separation') then 'separation'
    when public.normalize_production_name(p_value) in ('embalagem', 'packaging') then 'packaging'
    when public.normalize_production_name(p_value) in ('expedicao', 'shipping') then 'shipping'
    else null
  end;
$function$;

create or replace function public.resolve_production_stage_for_cell(
  p_cell_id uuid default null,
  p_cell_name text default null
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_normalized text := public.normalize_production_name(p_cell_name);
  v_step_code text;
begin
  if p_cell_id is not null then
    select step.code
      into v_step_code
    from public.routing_steps step
    where step.cell_id = p_cell_id
      and coalesce(step.active, true)
    order by step.sequence nulls last
    limit 1;

    if v_step_code is not null then
      return v_step_code;
    end if;
  end if;

  select step.code
    into v_step_code
  from public.routing_steps step
  where coalesce(step.active, true)
    and (
      public.normalize_production_name(step.code) = v_normalized
      or public.normalize_production_name(step.name) = v_normalized
    )
  order by step.sequence nulls last
  limit 1;

  return coalesce(v_step_code, public.canonical_production_stage_name(p_cell_name));
end;
$function$;

do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.get_lot_route_stage_progress(uuid)'::regprocedure)
    into v_definition;

  v_patched := replace(
    v_definition,
    'public.resolve_production_stage_for_cell(NULL::uuid, route_step)',
    'public.canonical_production_stage_name(route_step)'
  );
  v_patched := replace(
    v_patched,
    'public.resolve_production_stage_for_cell(NULL::uuid, completed_step)',
    'public.canonical_production_stage_name(completed_step)'
  );
  -- Compatibilidade com a representação textual usada em versões anteriores
  -- do PostgreSQL ao serializar argumentos NULL.
  v_patched := replace(
    v_patched,
    'public.resolve_production_stage_for_cell(NULL, route_step)',
    'public.canonical_production_stage_name(route_step)'
  );
  v_patched := replace(
    v_patched,
    'public.resolve_production_stage_for_cell(NULL, completed_step)',
    'public.canonical_production_stage_name(completed_step)'
  );
  v_patched := replace(
    v_patched,
    'public.resolve_production_stage_for_cell(null, route_step)',
    'public.canonical_production_stage_name(route_step)'
  );
  v_patched := replace(
    v_patched,
    'public.resolve_production_stage_for_cell(null, completed_step)',
    'public.canonical_production_stage_name(completed_step)'
  );

  if v_patched = v_definition then
    raise exception 'Não foi possível otimizar get_lot_route_stage_progress.';
  end if;

  execute v_patched;
end;
$migration$;

revoke execute on function public.calcular_integridade_do_lote(uuid) from public, anon;
grant execute on function public.calcular_integridade_do_lote(uuid) to authenticated;

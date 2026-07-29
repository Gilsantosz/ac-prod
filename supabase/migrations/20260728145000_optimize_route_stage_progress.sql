-- Evita resolver a mesma etapa repetidamente para cada célula do grid.
-- Cada rota/completed_steps é canonizada uma única vez por peça.

create or replace function public.canonical_production_stage_name(p_value text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  v_normalized text := public.normalize_production_name(p_value);
begin
  return case
    when v_normalized in ('corte', 'cut', 'cutting') then 'cut'
    when v_normalized in ('borda', 'bordo', 'edge', 'edging') then 'edge'
    when v_normalized in ('fura', 'furacao', 'furadeira', 'drill', 'drilling') then 'drill'
    when v_normalized in ('usinagem', 'usinagemcnc', 'cnc') then 'cnc'
    when v_normalized in ('marcenaria', 'joinery') then 'joinery'
    when v_normalized in ('separacao', 'separation') then 'separation'
    when v_normalized in ('embalagem', 'packaging') then 'packaging'
    when v_normalized in ('expedicao', 'shipping') then 'shipping'
    else null
  end;
end;
$function$;

create or replace function public.canonicalize_production_route(p_steps text[])
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select coalesce(
    array_agg(distinct public.canonical_production_stage_name(source.step))
      filter (where public.canonical_production_stage_name(source.step) is not null),
    '{}'::text[]
  )
  from unnest(coalesce(p_steps, '{}'::text[])) source(step);
$function$;

create or replace function public.get_lot_route_stage_progress(p_batch_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with
stage_catalog(stage_code, stage_label, stage_order) as (
  values
    ('cut'::text, 'Corte'::text, 1),
    ('edge'::text, 'Borda'::text, 2),
    ('drill'::text, 'Furação'::text, 3),
    ('cnc'::text, 'Usinagem CNC'::text, 4),
    ('joinery'::text, 'Marcenaria'::text, 5),
    ('separation'::text, 'Separação'::text, 6),
    ('packaging'::text, 'Embalagem'::text, 7)
),
pieces as materialized (
  select
    piece.*,
    public.canonicalize_production_route(piece.route_steps) as canonical_route_steps,
    public.canonicalize_production_route(piece.completed_steps) as canonical_completed_steps
  from public.production_pieces piece
  where piece.pcp_import_batch_id = p_batch_id
    and lower(coalesce(piece.status, '')) not in ('cancelled', 'canceled', 'replaced')
),
piece_stage as (
  select
    piece.pcp_import_batch_id,
    piece.lot_id,
    piece.id as piece_id,
    stage.stage_code,
    stage.stage_label,
    stage.stage_order,
    case stage.stage_code
      when 'cut' then coalesce(piece.requires_cut, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'edge' then coalesce(piece.requires_edge, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'drill' then stage.stage_code = any(piece.canonical_route_steps)
      when 'cnc' then coalesce(piece.requires_cnc, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'joinery' then coalesce(piece.requires_joinery, false)
        or coalesce(piece.manual_joinery, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'separation' then coalesce(piece.requires_separation, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      when 'packaging' then coalesce(piece.requires_packaging, false)
        or stage.stage_code = any(piece.canonical_route_steps)
      else false
    end as is_required,
    stage.stage_code = any(piece.canonical_completed_steps) as is_completed
  from pieces piece
  cross join stage_catalog stage
),
lot_stage as (
  select
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_pieces
  from piece_stage ps
  group by ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage as (
  select
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_pieces
  from piece_stage ps
  group by ps.stage_code, ps.stage_label, ps.stage_order
),
manual_stage as (
  select
    record.stage_code,
    coalesce(sum(record.quantity), 0)::integer as manual_quantity,
    count(*)::integer as manual_entry_count
  from public.manual_production_records record
  where record.pcp_import_batch_id = p_batch_id
    and record.traceability_type = 'aggregate_untraceable'
    and coalesce(record.status, 'approved') = 'approved'
  group by record.stage_code
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_stages', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', batch.stage_code,
        'stage_label', batch.stage_label,
        'stage_order', batch.stage_order,
        'required_pieces', batch.required_pieces,
        'completed_pieces', batch.completed_pieces,
        'remaining_pieces', greatest(batch.required_pieces - batch.completed_pieces, 0),
        'progress_percent', case when batch.required_pieces > 0
          then round((100.0 * batch.completed_pieces / batch.required_pieces)::numeric, 2)
          else 100.0::numeric
        end,
        'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
        'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
        'manual_quantity', coalesce(manual.manual_quantity, 0),
        'manual_entry_count', coalesce(manual.manual_entry_count, 0)
      )
      order by batch.stage_order
    )
    from batch_stage batch
    left join public.production_stage_policies policy on policy.stage_code = batch.stage_code
    left join manual_stage manual on manual.stage_code = batch.stage_code
  ), '[]'::jsonb),
  'lot_stages', coalesce((
    select jsonb_object_agg(lot.lot_id::text, lot.stages)
    from (
      select
        stage.lot_id,
        jsonb_agg(
          jsonb_build_object(
            'stage_code', stage.stage_code,
            'stage_label', stage.stage_label,
            'stage_order', stage.stage_order,
            'required_pieces', stage.required_pieces,
            'completed_pieces', stage.completed_pieces,
            'remaining_pieces', greatest(stage.required_pieces - stage.completed_pieces, 0),
            'progress_percent', case when stage.required_pieces > 0
              then round((100.0 * stage.completed_pieces / stage.required_pieces)::numeric, 2)
              else 100.0::numeric
            end,
            'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
            'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
            'manual_quantity', 0
          )
          order by stage.stage_order
        ) as stages
      from lot_stage stage
      left join public.production_stage_policies policy on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
);
$function$;

revoke all on function public.get_lot_route_stage_progress(uuid) from public, anon;
grant execute on function public.get_lot_route_stage_progress(uuid) to authenticated;

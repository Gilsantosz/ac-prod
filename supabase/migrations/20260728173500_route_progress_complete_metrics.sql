-- Corrige os indicadores de acompanhamento para considerar toda a rota
-- rastreável da peça, incluindo Furação, sem contar Separação/Embalagem
-- quando a coleta física dessas etapas estiver configurada como opcional.

create or replace function public.get_lot_route_completion_metrics(p_batch_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with
pieces as materialized (
  select
    piece.id,
    piece.lot_id,
    piece.pcp_import_batch_id,
    public.canonicalize_production_route(
      coalesce(piece.route_steps, '{}'::text[])
      || case when coalesce(piece.requires_cut, false) then array['cut']::text[] else '{}'::text[] end
      || case when coalesce(piece.requires_edge, false) then array['edge']::text[] else '{}'::text[] end
      || case when coalesce(piece.requires_cnc, false) then array['cnc']::text[] else '{}'::text[] end
      || case when coalesce(piece.requires_joinery, false) or coalesce(piece.manual_joinery, false)
        then array['joinery']::text[] else '{}'::text[] end
      || case when coalesce(piece.requires_separation, false) then array['separation']::text[] else '{}'::text[] end
      || case when coalesce(piece.requires_packaging, false) then array['packaging']::text[] else '{}'::text[] end
    ) as required_steps,
    public.canonicalize_production_route(piece.completed_steps) as completed_steps
  from public.production_pieces piece
  where piece.pcp_import_batch_id = p_batch_id
    and lower(coalesce(piece.status, '')) not in ('cancelled', 'canceled', 'replaced')
),
piece_metrics as (
  select
    piece.id,
    piece.lot_id,
    piece.pcp_import_batch_id,
    count(*) filter (
      where route.stage_code is not null
        and coalesce(policy.traceable_collection_required, true)
    )::integer as required_operations,
    count(*) filter (
      where route.stage_code is not null
        and coalesce(policy.traceable_collection_required, true)
        and route.stage_code = any(piece.completed_steps)
    )::integer as completed_operations
  from pieces piece
  left join lateral unnest(piece.required_steps) route(stage_code) on true
  left join public.production_stage_policies policy
    on policy.stage_code = route.stage_code
  group by piece.id, piece.lot_id, piece.pcp_import_batch_id
),
lot_metrics as (
  select
    metric.lot_id,
    count(*)::integer as total_pieces,
    count(*) filter (
      where metric.required_operations > 0
        and metric.required_operations = metric.completed_operations
    )::integer as ready_for_separation_pieces,
    coalesce(sum(metric.required_operations), 0)::integer as total_operations,
    coalesce(sum(metric.completed_operations), 0)::integer as completed_operations
  from piece_metrics metric
  group by metric.lot_id
),
batch_metrics as (
  select
    count(*)::integer as total_pieces,
    count(*) filter (
      where metric.required_operations > 0
        and metric.required_operations = metric.completed_operations
    )::integer as ready_for_separation_pieces,
    coalesce(sum(metric.required_operations), 0)::integer as total_operations,
    coalesce(sum(metric.completed_operations), 0)::integer as completed_operations
  from piece_metrics metric
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_summary', (
    select jsonb_build_object(
      'total_pieces', batch.total_pieces,
      'ready_for_separation_pieces', batch.ready_for_separation_pieces,
      'total_operations', batch.total_operations,
      'completed_operations', batch.completed_operations,
      'progress_percent', case
        when batch.total_operations > 0
          then round((100.0 * batch.completed_operations / batch.total_operations)::numeric, 2)
        else 0.0::numeric
      end,
      'ready_for_separation', batch.total_pieces > 0
        and batch.ready_for_separation_pieces = batch.total_pieces
    )
    from batch_metrics batch
  ),
  'lot_summaries', coalesce((
    select jsonb_object_agg(
      lot.lot_id::text,
      jsonb_build_object(
        'total_pieces', lot.total_pieces,
        'ready_for_separation_pieces', lot.ready_for_separation_pieces,
        'total_operations', lot.total_operations,
        'completed_operations', lot.completed_operations,
        'progress_percent', case
          when lot.total_operations > 0
            then round((100.0 * lot.completed_operations / lot.total_operations)::numeric, 2)
          else 0.0::numeric
        end,
        'ready_for_separation', lot.total_pieces > 0
          and lot.ready_for_separation_pieces = lot.total_pieces
      )
    )
    from lot_metrics lot
  ), '{}'::jsonb)
);
$function$;

revoke all on function public.get_lot_route_completion_metrics(uuid) from public;
revoke all on function public.get_lot_route_completion_metrics(uuid) from anon;
grant execute on function public.get_lot_route_completion_metrics(uuid) to authenticated;

comment on function public.get_lot_route_completion_metrics(uuid) is
  'Calcula progresso e prontidão por peça usando a rota rastreável completa, incluindo Furação e respeitando etapas com coleta opcional.';

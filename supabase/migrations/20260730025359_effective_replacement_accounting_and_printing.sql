-- Mantém o histórico físico imutável, mas troca a peça usada na contabilidade:
--   * reposição aberta: nenhuma peça efetiva (a aprovação anterior é suspensa);
--   * reposição concluída: a substituta passa a representar a unidade original;
--   * reposições sucessivas: percorre a cadeia concluída sem duplicar a meta.

create or replace view public.production_piece_accounting
with (security_invoker = true)
as
with recursive replacement_chain as (
  select
    piece.id as root_piece_id,
    piece.id as leaf_piece_id,
    array[piece.id]::uuid[] as visited_piece_ids,
    0::integer as replacement_depth
  from public.production_pieces piece
  where coalesce(piece.is_replacement, false) is false

  union all

  select
    chain.root_piece_id,
    completed_order.replacement_piece_id as leaf_piece_id,
    chain.visited_piece_ids || completed_order.replacement_piece_id,
    chain.replacement_depth + 1
  from replacement_chain chain
  join lateral (
    select replacement.replacement_piece_id
    from public.replacement_orders replacement
    where replacement.original_piece_id = chain.leaf_piece_id
      and replacement.status = 'completed'
      and replacement.replacement_piece_id is not null
    order by
      coalesce(replacement.completed_at, replacement.updated_at, replacement.created_at) desc,
      replacement.id desc
    limit 1
  ) completed_order on true
  where chain.replacement_depth < 16
    and not (completed_order.replacement_piece_id = any(chain.visited_piece_ids))
),
latest_leaf as (
  select distinct on (chain.root_piece_id)
    chain.root_piece_id,
    chain.leaf_piece_id,
    chain.replacement_depth
  from replacement_chain chain
  order by chain.root_piece_id, chain.replacement_depth desc
),
resolved as (
  select
    leaf.root_piece_id,
    leaf.leaf_piece_id,
    leaf.replacement_depth,
    open_order.id as open_replacement_id,
    open_order.status as open_replacement_status
  from latest_leaf leaf
  left join lateral (
    select replacement.id, replacement.status
    from public.replacement_orders replacement
    where replacement.original_piece_id = leaf.leaf_piece_id
      and replacement.status in (
        'requested',
        'under_review',
        'approved',
        'released',
        'in_production'
      )
    order by replacement.created_at desc, replacement.id desc
    limit 1
  ) open_order on true
)
select
  resolved.root_piece_id,
  resolved.leaf_piece_id,
  case
    when resolved.open_replacement_id is null then resolved.leaf_piece_id
    else null::uuid
  end as effective_piece_id,
  resolved.open_replacement_id,
  resolved.open_replacement_status,
  resolved.open_replacement_id is not null as replacement_pending,
  resolved.replacement_depth
from resolved;

comment on view public.production_piece_accounting is
  'Uma linha por unidade produtiva original. Suspende aprovações durante reposição aberta e aponta para a substituta apenas após a conclusão.';

revoke all on public.production_piece_accounting from public, anon;
grant select on public.production_piece_accounting to authenticated, service_role;

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
    root.id,
    root.lot_id,
    root.pcp_import_batch_id,
    root.requires_cut,
    root.requires_edge,
    root.requires_cnc,
    root.requires_joinery,
    root.requires_separation,
    root.requires_packaging,
    root.manual_joinery,
    accounting.replacement_pending,
    public.canonicalize_production_route(root.route_steps) as canonical_route_steps,
    case
      when accounting.replacement_pending then '{}'::text[]
      else public.canonicalize_production_route(effective.completed_steps)
    end as canonical_completed_steps
  from public.production_piece_accounting accounting
  join public.production_pieces root
    on root.id = accounting.root_piece_id
  left join public.production_pieces effective
    on effective.id = accounting.effective_piece_id
  where root.pcp_import_batch_id = p_batch_id
    and coalesce(root.is_active, true) is true
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
piece_stage as (
  select
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
    not piece.replacement_pending
      and stage.stage_code = any(piece.canonical_completed_steps) as is_completed,
    piece.replacement_pending
  from pieces piece
  cross join stage_catalog stage
),
lot_stage as (
  select
    progress.lot_id,
    progress.stage_code,
    progress.stage_label,
    progress.stage_order,
    count(*) filter (where progress.is_required)::integer as required_pieces,
    count(*) filter (
      where progress.is_required and progress.is_completed
    )::integer as traceable_completed_pieces,
    count(*) filter (
      where progress.is_required and progress.replacement_pending
    )::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.lot_id, progress.stage_code, progress.stage_label, progress.stage_order
),
batch_stage as (
  select
    progress.stage_code,
    progress.stage_label,
    progress.stage_order,
    count(*) filter (where progress.is_required)::integer as required_pieces,
    count(*) filter (
      where progress.is_required and progress.is_completed
    )::integer as traceable_completed_pieces,
    count(*) filter (
      where progress.is_required and progress.replacement_pending
    )::integer as replacement_pending_pieces
  from piece_stage progress
  group by progress.stage_code, progress.stage_label, progress.stage_order
),
manual_stage as (
  select
    record.stage_code,
    coalesce(sum(record.quantity), 0)::integer as recorded_manual_quantity,
    count(*)::integer as manual_entry_count
  from public.manual_production_records record
  where record.pcp_import_batch_id = p_batch_id
    and record.traceability_type = 'aggregate_untraceable'
    and coalesce(record.status, 'approved') = 'approved'
  group by record.stage_code
),
lot_remaining as (
  select
    stage.*,
    lot.created_at as lot_created_at,
    greatest(
      stage.required_pieces
        - stage.replacement_pending_pieces
        - stage.traceable_completed_pieces,
      0
    )::integer as traceable_remaining,
    coalesce(manual.recorded_manual_quantity, 0)::integer as batch_manual_quantity
  from lot_stage stage
  left join public.production_lots lot on lot.id = stage.lot_id
  left join manual_stage manual on manual.stage_code = stage.stage_code
),
lot_allocated as (
  select
    remaining.*,
    greatest(
      least(
        remaining.traceable_remaining,
        remaining.batch_manual_quantity - coalesce(
          sum(remaining.traceable_remaining) over (
            partition by remaining.stage_code
            order by remaining.lot_created_at nulls last, remaining.lot_id
            rows between unbounded preceding and 1 preceding
          ),
          0
        )
      ),
      0
    )::integer as manual_quantity
  from lot_remaining remaining
),
lot_effective as (
  select
    allocated.*,
    least(
      greatest(allocated.required_pieces - allocated.replacement_pending_pieces, 0),
      allocated.traceable_completed_pieces + allocated.manual_quantity
    )::integer as effective_completed_pieces
  from lot_allocated allocated
),
batch_effective as (
  select
    batch.*,
    coalesce(manual.recorded_manual_quantity, 0)::integer as recorded_manual_quantity,
    least(
      greatest(
        batch.required_pieces
          - batch.replacement_pending_pieces
          - batch.traceable_completed_pieces,
        0
      ),
      coalesce(manual.recorded_manual_quantity, 0)
    )::integer as manual_quantity,
    coalesce(manual.manual_entry_count, 0)::integer as manual_entry_count
  from batch_stage batch
  left join manual_stage manual on manual.stage_code = batch.stage_code
)
select jsonb_build_object(
  'batch_id', p_batch_id,
  'batch_completed', not exists (
    select 1
    from batch_effective stage
    where stage.required_pieces > 0
      and least(
        greatest(stage.required_pieces - stage.replacement_pending_pieces, 0),
        stage.traceable_completed_pieces + stage.manual_quantity
      ) < stage.required_pieces
  ),
  'batch_stages', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', batch.stage_code,
        'stage_label', batch.stage_label,
        'stage_order', batch.stage_order,
        'required_pieces', batch.required_pieces,
        'traceable_completed_pieces', batch.traceable_completed_pieces,
        'replacement_pending_pieces', batch.replacement_pending_pieces,
        'manual_quantity', batch.manual_quantity,
        'recorded_manual_quantity', batch.recorded_manual_quantity,
        'completed_pieces', least(
          greatest(batch.required_pieces - batch.replacement_pending_pieces, 0),
          batch.traceable_completed_pieces + batch.manual_quantity
        ),
        'effective_completed_pieces', least(
          greatest(batch.required_pieces - batch.replacement_pending_pieces, 0),
          batch.traceable_completed_pieces + batch.manual_quantity
        ),
        'remaining_pieces', greatest(
          batch.required_pieces
            - batch.traceable_completed_pieces
            - batch.manual_quantity,
          batch.replacement_pending_pieces
        ),
        'progress_percent', case when batch.required_pieces > 0
          then round((
            100.0 * least(
              greatest(batch.required_pieces - batch.replacement_pending_pieces, 0),
              batch.traceable_completed_pieces + batch.manual_quantity
            ) / batch.required_pieces
          )::numeric, 2)
          else 100.0::numeric
        end,
        'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
        'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false),
        'manual_entry_count', batch.manual_entry_count
      )
      order by batch.stage_order
    )
    from batch_effective batch
    left join public.production_stage_policies policy
      on policy.stage_code = batch.stage_code
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
            'traceable_completed_pieces', stage.traceable_completed_pieces,
            'replacement_pending_pieces', stage.replacement_pending_pieces,
            'manual_quantity', stage.manual_quantity,
            'completed_pieces', stage.effective_completed_pieces,
            'effective_completed_pieces', stage.effective_completed_pieces,
            'remaining_pieces', greatest(
              stage.required_pieces - stage.effective_completed_pieces,
              stage.replacement_pending_pieces
            ),
            'progress_percent', case when stage.required_pieces > 0
              then round((100.0 * stage.effective_completed_pieces / stage.required_pieces)::numeric, 2)
              else 100.0::numeric
            end,
            'traceable_collection_required', coalesce(policy.traceable_collection_required, true),
            'manual_quantity_allowed', coalesce(policy.manual_quantity_allowed, false)
          )
          order by stage.stage_order
        ) as stages
      from lot_effective stage
      left join public.production_stage_policies policy
        on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
);
$function$;

revoke all on function public.get_lot_route_stage_progress(uuid) from public, anon;
grant execute on function public.get_lot_route_stage_progress(uuid) to authenticated, service_role;

comment on function public.get_lot_route_stage_progress(uuid) is
  'Progresso por etapa sem duplicar substitutas e com aprovação suspensa enquanto existir reposição aberta.';

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
    root.id,
    root.lot_id,
    root.pcp_import_batch_id,
    accounting.replacement_pending,
    public.canonicalize_production_route(
      coalesce(root.route_steps, '{}'::text[])
      || case when coalesce(root.requires_cut, false) then array['cut']::text[] else '{}'::text[] end
      || case when coalesce(root.requires_edge, false) then array['edge']::text[] else '{}'::text[] end
      || case when coalesce(root.requires_cnc, false) then array['cnc']::text[] else '{}'::text[] end
      || case when coalesce(root.requires_joinery, false) or coalesce(root.manual_joinery, false)
        then array['joinery']::text[] else '{}'::text[] end
      || case when coalesce(root.requires_separation, false) then array['separation']::text[] else '{}'::text[] end
      || case when coalesce(root.requires_packaging, false) then array['packaging']::text[] else '{}'::text[] end
    ) as required_steps,
    case
      when accounting.replacement_pending then '{}'::text[]
      else public.canonicalize_production_route(effective.completed_steps)
    end as completed_steps
  from public.production_piece_accounting accounting
  join public.production_pieces root
    on root.id = accounting.root_piece_id
  left join public.production_pieces effective
    on effective.id = accounting.effective_piece_id
  where root.pcp_import_batch_id = p_batch_id
    and coalesce(root.is_active, true) is true
    and lower(coalesce(root.status, '')) not in ('cancelled', 'canceled')
),
piece_metrics as (
  select
    piece.id,
    piece.lot_id,
    piece.pcp_import_batch_id,
    piece.replacement_pending,
    count(*) filter (
      where route.stage_code is not null
        and coalesce(policy.traceable_collection_required, true)
    )::integer as required_operations,
    count(*) filter (
      where route.stage_code is not null
        and coalesce(policy.traceable_collection_required, true)
        and not piece.replacement_pending
        and route.stage_code = any(piece.completed_steps)
    )::integer as completed_operations
  from pieces piece
  left join lateral unnest(piece.required_steps) route(stage_code) on true
  left join public.production_stage_policies policy
    on policy.stage_code = route.stage_code
  group by piece.id, piece.lot_id, piece.pcp_import_batch_id, piece.replacement_pending
),
lot_metrics as (
  select
    metric.lot_id,
    count(*)::integer as total_pieces,
    count(*) filter (
      where not metric.replacement_pending
        and metric.required_operations > 0
        and metric.required_operations = metric.completed_operations
    )::integer as ready_for_separation_pieces,
    count(*) filter (where metric.replacement_pending)::integer as replacement_pending_pieces,
    coalesce(sum(metric.required_operations), 0)::integer as total_operations,
    coalesce(sum(metric.completed_operations), 0)::integer as completed_operations
  from piece_metrics metric
  group by metric.lot_id
),
batch_metrics as (
  select
    count(*)::integer as total_pieces,
    count(*) filter (
      where not metric.replacement_pending
        and metric.required_operations > 0
        and metric.required_operations = metric.completed_operations
    )::integer as ready_for_separation_pieces,
    count(*) filter (where metric.replacement_pending)::integer as replacement_pending_pieces,
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
      'replacement_pending_pieces', batch.replacement_pending_pieces,
      'total_operations', batch.total_operations,
      'completed_operations', batch.completed_operations,
      'progress_percent', case
        when batch.total_operations > 0
          then round((100.0 * batch.completed_operations / batch.total_operations)::numeric, 2)
        else 0.0::numeric
      end,
      'ready_for_separation', batch.total_pieces > 0
        and batch.replacement_pending_pieces = 0
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
        'replacement_pending_pieces', lot.replacement_pending_pieces,
        'total_operations', lot.total_operations,
        'completed_operations', lot.completed_operations,
        'progress_percent', case
          when lot.total_operations > 0
            then round((100.0 * lot.completed_operations / lot.total_operations)::numeric, 2)
          else 0.0::numeric
        end,
        'ready_for_separation', lot.total_pieces > 0
          and lot.replacement_pending_pieces = 0
          and lot.ready_for_separation_pieces = lot.total_pieces
      )
    )
    from lot_metrics lot
  ), '{}'::jsonb)
);
$function$;

revoke all on function public.get_lot_route_completion_metrics(uuid) from public, anon;
grant execute on function public.get_lot_route_completion_metrics(uuid) to authenticated, service_role;

comment on function public.get_lot_route_completion_metrics(uuid) is
  'Métricas de conclusão por unidade original, usando a substituta concluída e suspendendo a aprovação durante reposição aberta.';

create or replace function public.get_collection_cell_snapshot_v2(
  p_cell_name text,
  p_workstation_id uuid default null::uuid,
  p_shift text default null::text,
  p_date_from timestamptz default null::timestamptz,
  p_date_to timestamptz default null::timestamptz,
  p_pcp_import_batch_id uuid default null::uuid,
  p_lot_id uuid default null::uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_step_code text;
  v_expected bigint := 0;
  v_traceable_approved_cumulative bigint := 0;
  v_manual_approved_cumulative bigint := 0;
  v_approved_cumulative bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_active_lots bigint := 0;
  v_active_batches bigint := 0;
  v_shift_total_reads bigint := 0;
  v_shift_approved_events bigint := 0;
  v_shift_unique_completions bigint := 0;
  v_shift_manual_quantity bigint := 0;
  v_produced_this_shift bigint := 0;
  v_shift_rejected bigint := 0;
  v_shift_blocked bigint := 0;
  v_shift_duplicated bigint := 0;
  v_shift_errors bigint := 0;
  v_active_general_lots jsonb := '[]'::jsonb;
begin
  v_step_code := coalesce(
    public.resolve_production_stage_for_cell(null, p_cell_name),
    '__unmapped_cell__'
  );

  with eligible_pieces as (
    select
      root.id,
      root.lot_id,
      root.status,
      root.rework_status,
      accounting.effective_piece_id,
      accounting.replacement_pending,
      coalesce(root.pcp_import_batch_id, lot.pcp_import_batch_id) as effective_batch_id
    from public.production_piece_accounting accounting
    join public.production_pieces root
      on root.id = accounting.root_piece_id
    join public.production_lots lot
      on lot.id = root.lot_id
    left join public.promob_import_batches batch
      on batch.id = coalesce(root.pcp_import_batch_id, lot.pcp_import_batch_id)
    where coalesce(root.is_active, true) is true
      and root.status not in ('cancelled', 'shipped')
      and lot.status not in ('closed', 'shipped', 'cancelled')
      and (
        (
          coalesce(root.pcp_import_batch_id, lot.pcp_import_batch_id) is not null
          and batch.id is not null
          and batch.status not in ('cancelled', 'error', 'failed_validation', 'duplicated')
        )
        or (
          coalesce(root.pcp_import_batch_id, lot.pcp_import_batch_id) is null
          and coalesce(root.source_origin, 'manual') in ('manual', 'rework')
        )
      )
      and (
        p_pcp_import_batch_id is null
        or coalesce(root.pcp_import_batch_id, lot.pcp_import_batch_id) = p_pcp_import_batch_id
      )
      and (p_lot_id is null or root.lot_id = p_lot_id)
      and public.piece_requires_routing_step(
        v_step_code,
        root.route_steps,
        root.requires_cut,
        root.requires_edge,
        root.requires_cnc,
        root.requires_joinery,
        root.requires_separation,
        root.requires_packaging
      )
  ),
  progress_by_batch as (
    select
      eligible.effective_batch_id,
      count(distinct eligible.id)::bigint as expected,
      count(distinct eligible.id) filter (
        where eligible.status in ('rework', 'rework_pending', 'rework_in_progress')
           or eligible.rework_status in ('pending', 'in_progress')
      )::bigint as rework,
      count(distinct eligible.id) filter (
        where eligible.replacement_pending
      )::bigint as replacement,
      count(distinct eligible.lot_id)::bigint as active_lots,
      count(distinct eligible.id) filter (
        where fact.piece_id is not null
      )::bigint as traceable_approved,
      case
        when p_lot_id is not null or eligible.effective_batch_id is null then 0::bigint
        else coalesce(manual.quantity, 0)::bigint
      end as manual_quantity
    from eligible_pieces eligible
    left join public.collection_stage_facts fact
      on fact.piece_id = eligible.effective_piece_id
     and fact.step_code_canonico = v_step_code
    left join lateral (
      select coalesce(sum(record.quantity), 0)::bigint as quantity
      from public.manual_production_records record
      where record.pcp_import_batch_id = eligible.effective_batch_id
        and record.stage_code = v_step_code
        and record.status = 'approved'
    ) manual on true
    group by eligible.effective_batch_id, manual.quantity
  )
  select
    coalesce(sum(progress.expected), 0)::bigint,
    coalesce(sum(progress.rework), 0)::bigint,
    coalesce(sum(progress.replacement), 0)::bigint,
    coalesce(sum(progress.active_lots), 0)::bigint,
    count(*) filter (where progress.effective_batch_id is not null)::bigint,
    coalesce(sum(progress.traceable_approved), 0)::bigint,
    coalesce(sum(
      least(
        greatest(
          progress.expected
            - progress.replacement
            - progress.traceable_approved,
          0
        ),
        progress.manual_quantity
      )
    ), 0)::bigint,
    coalesce(sum(
      least(
        greatest(progress.expected - progress.replacement, 0),
        progress.traceable_approved + progress.manual_quantity
      )
    ), 0)::bigint
  into
    v_expected,
    v_rework,
    v_replacement,
    v_active_lots,
    v_active_batches,
    v_traceable_approved_cumulative,
    v_manual_approved_cumulative,
    v_approved_cumulative
  from progress_by_batch progress;

  v_pending := greatest(v_expected - v_approved_cumulative, 0);

  select
    count(*),
    count(*) filter (where event.status = 'synced' and event.result_status = 'approved'),
    count(*) filter (where event.result_status = 'rejected'),
    count(*) filter (where event.result_status = 'blocked'),
    count(*) filter (where event.result_status = 'duplicated'),
    count(*) filter (where event.status = 'error')
  into
    v_shift_total_reads,
    v_shift_approved_events,
    v_shift_rejected,
    v_shift_blocked,
    v_shift_duplicated,
    v_shift_errors
  from public.production_collection_events event
  where lower(coalesce(event.cell_name, '')) = lower(p_cell_name)
    and (p_workstation_id is null or event.machine_id = p_workstation_id)
    and (p_shift is null or event.shift = p_shift)
    and (
      p_date_from is null
      or coalesce(event.created_at_client, event.last_attempt_at, event.created_at) >= p_date_from
    )
    and (
      p_date_to is null
      or coalesce(event.created_at_client, event.last_attempt_at, event.created_at) < p_date_to
    )
    and (p_pcp_import_batch_id is null or event.pcp_import_batch_id = p_pcp_import_batch_id)
    and (p_lot_id is null or event.lot_id = p_lot_id);

  select count(distinct accounting.root_piece_id)
  into v_shift_unique_completions
  from public.production_piece_accounting accounting
  join public.production_pieces root
    on root.id = accounting.root_piece_id
  join public.production_stage_readings reading
    on reading.piece_id = accounting.effective_piece_id
  where not accounting.replacement_pending
    and reading.step_name = v_step_code
    and reading.status = 'approved'
    and (p_workstation_id is null or reading.machine_id = p_workstation_id)
    and (p_shift is null or reading.shift = p_shift)
    and (p_date_from is null or reading.created_at >= p_date_from)
    and (p_date_to is null or reading.created_at < p_date_to)
    and (
      p_pcp_import_batch_id is null
      or root.pcp_import_batch_id = p_pcp_import_batch_id
    )
    and (p_lot_id is null or root.lot_id = p_lot_id);

  if p_lot_id is null then
    select coalesce(sum(record.quantity), 0)::bigint
    into v_shift_manual_quantity
    from public.manual_production_records record
    join public.promob_import_batches batch
      on batch.id = record.pcp_import_batch_id
    where lower(coalesce(record.cell_name, '')) = lower(p_cell_name)
      and record.stage_code = v_step_code
      and record.status = 'approved'
      and (p_shift is null or record.shift = p_shift)
      and (p_date_from is null or record.created_at >= p_date_from)
      and (p_date_to is null or record.created_at < p_date_to)
      and (
        p_pcp_import_batch_id is null
        or record.pcp_import_batch_id = p_pcp_import_batch_id
      )
      and batch.status not in ('cancelled', 'error', 'failed_validation', 'duplicated');
  end if;

  v_produced_this_shift := v_shift_unique_completions + v_shift_manual_quantity;

  select coalesce(jsonb_agg(to_jsonb(active_batch)), '[]'::jsonb)
  into v_active_general_lots
  from (
    select batch.id, batch.general_lot_code, batch.progress_percent
    from public.promob_import_batches batch
    where batch.status not in ('cancelled', 'error', 'failed_validation', 'duplicated')
      and exists (
        select 1
        from public.production_piece_accounting accounting
        join public.production_pieces root
          on root.id = accounting.root_piece_id
        join public.production_lots lot
          on lot.id = root.lot_id
        where coalesce(root.pcp_import_batch_id, lot.pcp_import_batch_id) = batch.id
          and coalesce(root.is_active, true) is true
          and root.status not in ('cancelled', 'shipped')
          and lot.status not in ('closed', 'shipped', 'cancelled')
      )
    order by batch.created_at desc
    limit 15
  ) active_batch;

  return jsonb_build_object(
    'total', v_shift_total_reads,
    'produced_this_shift', v_produced_this_shift,
    'approved', v_approved_cumulative,
    'traceable_approved', v_traceable_approved_cumulative,
    'manual_approved', v_manual_approved_cumulative,
    'rejected', v_shift_rejected,
    'blocked', v_shift_blocked + v_shift_duplicated,
    'expected', v_expected,
    'pending', v_pending,
    'rework', v_rework,
    'replacement', v_replacement,
    'active_lots', v_active_lots,
    'active_pcp_batches', v_active_batches,
    'step_code', v_step_code,
    'integrity', jsonb_build_object(
      'scope', 'cumulative_active_lots',
      'expected', v_expected,
      'approved', v_approved_cumulative,
      'traceable_approved', v_traceable_approved_cumulative,
      'manual_approved', v_manual_approved_cumulative,
      'pending', v_pending,
      'rework', v_rework,
      'replacement', v_replacement
    ),
    'shift_activity', jsonb_build_object(
      'scope', 'current_shift',
      'total_reads', v_shift_total_reads,
      'approved_events', v_shift_approved_events,
      'unique_completions', v_shift_unique_completions,
      'manual_quantity', v_shift_manual_quantity,
      'produced_quantity', v_produced_this_shift,
      'approved_unique_stage_completions', v_shift_unique_completions,
      'rejected', v_shift_rejected,
      'blocked', v_shift_blocked + v_shift_duplicated,
      'duplicated', v_shift_duplicated,
      'errors', v_shift_errors
    ),
    'traceability', jsonb_build_object(
      'full_quantity', v_traceable_approved_cumulative,
      'limited_quantity', v_manual_approved_cumulative
    ),
    'active_general_lots', v_active_general_lots
  );
end;
$function$;

revoke all on function public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) from public, anon;
grant execute on function public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) to authenticated, service_role;

comment on function public.get_collection_cell_snapshot_v2(
  text, uuid, text, timestamptz, timestamptz, uuid, uuid
) is
  'Snapshot efetivo: preserva leituras históricas, não duplica substitutas e suspende a aprovação enquanto a reposição estiver aberta.';

create or replace function public.calcular_integridade_do_lote(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lot public.production_lots%rowtype;
  v_total_pieces bigint := 0;
  v_approved_pieces bigint := 0;
  v_pending_pieces bigint := 0;
  v_blocked_pieces bigint := 0;
  v_rejected_pieces bigint := 0;
  v_rework_pieces bigint := 0;
  v_replacement_pieces bigint := 0;
  v_packed_pieces bigint := 0;
  v_integrity_percent numeric(5,2) := 0.00;
  v_has_open_replacements boolean := false;
  v_has_open_reworks boolean := false;
  v_bottleneck text := 'Nenhum';
  v_most_pending_stage text := 'Nenhuma';
  v_can_close boolean := false;
begin
  select * into v_lot
  from public.production_lots
  where id = p_lot_id;

  if v_lot.id is null then
    return jsonb_build_object('success', false, 'error', 'Lote não encontrado.');
  end if;

  with accounting_pieces as (
    select
      accounting.*,
      root.route_steps as required_steps,
      effective.completed_steps as effective_completed_steps,
      leaf.status as leaf_status,
      leaf.is_blocked as leaf_is_blocked,
      leaf.rework_status as leaf_rework_status,
      leaf.packaging_status as leaf_packaging_status
    from public.production_piece_accounting accounting
    join public.production_pieces root
      on root.id = accounting.root_piece_id
    left join public.production_pieces leaf
      on leaf.id = accounting.leaf_piece_id
    left join public.production_pieces effective
      on effective.id = accounting.effective_piece_id
    where root.lot_id = p_lot_id
      and root.status not in ('cancelled', 'canceled')
      and coalesce(root.is_active, true) is true
  )
  select
    count(*)::bigint,
    count(*) filter (
      where not piece.replacement_pending
        and not exists (
          select 1
          from unnest(coalesce(piece.required_steps, '{}'::text[])) route_step
          where not (
            route_step = any(coalesce(piece.effective_completed_steps, '{}'::text[]))
          )
            and coalesce((
              select policy.traceable_collection_required
              from public.production_stage_policies policy
              where policy.stage_code = route_step
            ), true)
        )
    )::bigint,
    count(*) filter (
      where coalesce(piece.leaf_is_blocked, false) or piece.leaf_status = 'blocked'
    )::bigint,
    count(*) filter (where piece.leaf_status = 'rejected')::bigint,
    count(*) filter (
      where piece.leaf_status in ('rework', 'rework_pending', 'rework_in_progress')
         or piece.leaf_rework_status in ('pending', 'in_progress')
    )::bigint,
    count(*) filter (where piece.replacement_pending)::bigint,
    count(*) filter (
      where piece.leaf_status = 'packed' or piece.leaf_packaging_status = 'packed'
    )::bigint
  into
    v_total_pieces,
    v_approved_pieces,
    v_blocked_pieces,
    v_rejected_pieces,
    v_rework_pieces,
    v_replacement_pieces,
    v_packed_pieces
  from accounting_pieces piece;

  v_pending_pieces := greatest(v_total_pieces - v_approved_pieces, 0);
  v_has_open_replacements := v_replacement_pieces > 0;

  select exists (
    select 1
    from public.rework_orders rework
    join public.production_pieces piece on piece.id = rework.original_piece_id
    where piece.lot_id = p_lot_id
      and rework.status in ('pending', 'in_progress')
  ) into v_has_open_reworks;

  if v_total_pieces > 0 then
    v_integrity_percent := round(
      (v_approved_pieces::numeric / v_total_pieces::numeric) * 100,
      2
    );
  else
    v_integrity_percent := 100.00;
  end if;

  if v_approved_pieces = v_total_pieces
     and v_pending_pieces = 0
     and not v_has_open_replacements
     and not v_has_open_reworks
     and v_blocked_pieces = 0
     and v_rejected_pieces = 0 then
    v_can_close := true;
  end if;

  with pending_stages as (
    select
      route_step as stage_code,
      count(*)::bigint as pending_count
    from public.production_piece_accounting accounting
    join public.production_pieces root
      on root.id = accounting.root_piece_id
    left join public.production_pieces effective
      on effective.id = accounting.effective_piece_id
    cross join lateral unnest(coalesce(root.route_steps, '{}'::text[])) route_step
    where root.lot_id = p_lot_id
      and root.status not in ('cancelled', 'canceled')
      and coalesce((
        select policy.traceable_collection_required
        from public.production_stage_policies policy
        where policy.stage_code = route_step
      ), true)
      and (
        accounting.replacement_pending
        or not (
          route_step = any(coalesce(effective.completed_steps, '{}'::text[]))
        )
      )
    group by route_step
    order by pending_count desc, route_step
    limit 1
  )
  select
    coalesce(step.name, pending.stage_code),
    coalesce(step.name, pending.stage_code) || ' (' || pending.pending_count || ' peças)'
  into v_most_pending_stage, v_bottleneck
  from pending_stages pending
  left join public.routing_steps step on step.code = pending.stage_code;

  v_most_pending_stage := coalesce(v_most_pending_stage, 'Nenhuma');
  v_bottleneck := coalesce(v_bottleneck, 'Nenhum');

  return jsonb_build_object(
    'success', true,
    'lot_id', p_lot_id,
    'lot_code', v_lot.lot_code,
    'total_pieces', v_total_pieces,
    'approved_pieces', v_approved_pieces,
    'pending_pieces', v_pending_pieces,
    'blocked_pieces', v_blocked_pieces,
    'rejected_pieces', v_rejected_pieces,
    'rework_pieces', v_rework_pieces,
    'replacement_pieces', v_replacement_pieces,
    'packed_pieces', v_packed_pieces,
    'integrity_percent', v_integrity_percent,
    'has_open_replacements', v_has_open_replacements,
    'has_open_reworks', v_has_open_reworks,
    'bottleneck', v_bottleneck,
    'most_pending_stage', v_most_pending_stage,
    'can_close', v_can_close
  );
end;
$function$;

revoke all on function public.calcular_integridade_do_lote(uuid) from public, anon;
grant execute on function public.calcular_integridade_do_lote(uuid) to authenticated, service_role;

comment on function public.calcular_integridade_do_lote(uuid) is
  'Integridade por unidade original: reposição aberta reduz aprovadas e somente a substituta concluída restaura a contagem.';

create or replace function public.complete_piece_replacement(
  p_order_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order public.replacement_orders%rowtype;
  v_replacement public.production_pieces%rowtype;
  v_user_id uuid := auth.uid();
  v_required_steps text[];
  v_completed_steps text[];
  v_pending_steps text[];
  v_notes text := nullif(trim(p_payload->>'notes'), '');
begin
  select * into v_order
  from public.replacement_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Ordem de reposição não encontrada.';
  end if;

  if v_order.status = 'completed' then
    return jsonb_build_object(
      'success', true,
      'already_completed', true,
      'status', 'completed'
    );
  end if;

  if v_order.status not in ('approved', 'released', 'in_production') then
    raise exception 'A reposição não está liberada para conclusão. Status atual: %', v_order.status;
  end if;

  if v_order.replacement_piece_id is null then
    raise exception 'A ordem não possui peça substituta vinculada.';
  end if;

  select * into v_replacement
  from public.production_pieces
  where id = v_order.replacement_piece_id
  for update;

  if v_replacement.id is null then
    raise exception 'Peça substituta não encontrada.';
  end if;

  v_required_steps := public.canonicalize_production_route(
    coalesce(v_replacement.route_steps, '{}'::text[])
    || case when coalesce(v_replacement.requires_cut, false) then array['cut']::text[] else '{}'::text[] end
    || case when coalesce(v_replacement.requires_edge, false) then array['edge']::text[] else '{}'::text[] end
    || case when coalesce(v_replacement.requires_cnc, false) then array['cnc']::text[] else '{}'::text[] end
    || case when coalesce(v_replacement.requires_joinery, false) or coalesce(v_replacement.manual_joinery, false)
      then array['joinery']::text[] else '{}'::text[] end
    || case when coalesce(v_replacement.requires_separation, false) then array['separation']::text[] else '{}'::text[] end
    || case when coalesce(v_replacement.requires_packaging, false) then array['packaging']::text[] else '{}'::text[] end
  );
  v_completed_steps := public.canonicalize_production_route(v_replacement.completed_steps);

  select coalesce(array_agg(required.step_code order by required.ordinality), '{}'::text[])
  into v_pending_steps
  from unnest(v_required_steps) with ordinality required(step_code, ordinality)
  left join public.production_stage_policies policy
    on policy.stage_code = required.step_code
  where coalesce(policy.traceable_collection_required, true)
    and not (required.step_code = any(v_completed_steps));

  if cardinality(v_pending_steps) > 0 then
    raise exception
      'A peça substituta ainda possui etapas obrigatórias pendentes: %.',
      array_to_string(v_pending_steps, ', ');
  end if;

  update public.production_pieces
  set status = 'replaced',
      replacement_status = 'replaced',
      updated_at = now()
  where id = v_order.original_piece_id;

  update public.production_pieces
  set status = 'completed',
      production_status = 'completed',
      replacement_status = 'replaced',
      current_stage = 'Concluída',
      updated_at = now()
  where id = v_order.replacement_piece_id;

  update public.replacement_orders
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      notes = coalesce(v_notes, notes),
      updated_at = now()
  where id = p_order_id;

  update public.quality_nonconformities
  set status = 'closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, v_user_id),
      updated_at = now()
  where related_replacement_id = p_order_id
    and status <> 'closed';

  return jsonb_build_object(
    'success', true,
    'status', 'completed',
    'replacement_piece_id', v_order.replacement_piece_id,
    'restored_approved_accounting', true
  );
end;
$function$;

revoke all on function public.complete_piece_replacement(uuid, jsonb) from public, anon;
grant execute on function public.complete_piece_replacement(uuid, jsonb) to authenticated, service_role;

comment on function public.complete_piece_replacement(uuid, jsonb) is
  'Conclui reposição somente após todas as etapas rastreáveis da substituta; então restaura sua aprovação efetiva.';

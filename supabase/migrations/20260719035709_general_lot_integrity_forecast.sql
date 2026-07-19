-- AC.Prod / Leo Flow
-- Hierarquia lote geral -> lotes de cliente e previsão adaptativa até separação.
--
-- A previsão aprende com a mediana do intervalo entre leituras aprovadas por
-- etapa/dia nos últimos 90 dias. Enquanto não houver amostras suficientes, a
-- resposta explicita baixa confiança e usa uma referência conservadora.

create index if not exists idx_production_lots_pcp_import_batch
  on public.production_lots (pcp_import_batch_id, status, lot_code);

create or replace function public.get_general_lot_tracking(
  p_batch_id uuid default null,
  p_limit integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with
stage_catalog(stage_code, stage_label, stage_order, default_minutes_per_piece) as (
  values
    ('cut'::text, 'Corte'::text, 1, 2.0::numeric),
    ('edge'::text, 'Borda'::text, 2, 3.0::numeric),
    ('cnc'::text, 'Usinagem'::text, 3, 5.0::numeric),
    ('joinery'::text, 'Marcenaria'::text, 4, 20.0::numeric)
),
recent_readings as (
  select
    case
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cut', 'corte') then 'cut'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('edge', 'bordo', 'borda') then 'edge'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('cnc', 'usinagem') then 'cnc'
      when lower(trim(coalesce(r.step_name, r.operation_name, r.cell_name, ''))) in ('joinery', 'marcenaria') then 'joinery'
      else null
    end as stage_code,
    (r.created_at at time zone 'America/Sao_Paulo')::date as production_day,
    r.created_at
  from public.production_stage_readings r
  where r.status = 'approved'
    and r.created_at >= now() - interval '90 days'
),
daily_stage_rates as (
  select
    rr.stage_code,
    rr.production_day,
    count(*)::integer as approved_readings,
    extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0 as active_minutes,
    case
      when count(*) >= 3
       and max(rr.created_at) - min(rr.created_at) >= interval '5 minutes'
      then (extract(epoch from (max(rr.created_at) - min(rr.created_at))) / 60.0)
           / greatest(count(*) - 1, 1)
      else null
    end as minutes_per_piece
  from recent_readings rr
  where rr.stage_code is not null
  group by rr.stage_code, rr.production_day
),
learned_metrics as (
  select
    d.stage_code,
    count(*) filter (where d.minutes_per_piece is not null)::integer as observed_days,
    coalesce(sum(d.approved_readings), 0)::integer as sample_count,
    percentile_cont(0.5) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as median_minutes_per_piece,
    percentile_cont(0.8) within group (order by d.minutes_per_piece)
      filter (where d.minutes_per_piece is not null) as p80_minutes_per_piece
  from daily_stage_rates d
  group by d.stage_code
),
stage_models as (
  select
    s.stage_code,
    s.stage_label,
    s.stage_order,
    s.default_minutes_per_piece,
    coalesce(l.observed_days, 0) as observed_days,
    coalesce(l.sample_count, 0) as sample_count,
    round(coalesce(l.median_minutes_per_piece, s.default_minutes_per_piece)::numeric, 2) as minutes_per_piece,
    round(coalesce(l.p80_minutes_per_piece, s.default_minutes_per_piece * 1.25)::numeric, 2) as p80_minutes_per_piece,
    case
      when coalesce(l.observed_days, 0) >= 5 and coalesce(l.sample_count, 0) >= 500 then 'high'
      when coalesce(l.observed_days, 0) >= 1 and coalesce(l.sample_count, 0) >= 100 then 'medium'
      else 'low'
    end as confidence,
    case when coalesce(l.observed_days, 0) > 0 then 'learned' else 'baseline' end as model_source
  from stage_catalog s
  left join learned_metrics l on l.stage_code = s.stage_code
),
selected_batches as (
  select b.*
  from public.promob_import_batches b
  where (p_batch_id is not null and b.id = p_batch_id)
     or (
       p_batch_id is null
       and lower(coalesce(b.status, '')) not in ('cancelled', 'canceled', 'error', 'failed')
       and exists (
         select 1 from public.production_lots pl where pl.pcp_import_batch_id = b.id
       )
     )
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
),
selected_lots as (
  select l.*
  from public.production_lots l
  join selected_batches b on b.id = l.pcp_import_batch_id
  where lower(coalesce(l.status, '')) not in ('cancelled', 'canceled')
),
selected_pieces as (
  select p.*
  from public.production_pieces p
  join selected_batches b on b.id = p.pcp_import_batch_id
  where lower(coalesce(p.status, '')) not in ('cancelled', 'canceled', 'replaced')
),
piece_stage as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    p.id as piece_id,
    s.stage_code,
    s.stage_label,
    s.stage_order,
    case s.stage_code
      when 'cut' then coalesce(p.requires_cut, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then coalesce(p.requires_edge, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then coalesce(p.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then coalesce(p.requires_joinery, false) or coalesce(p.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(p.route_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_required,
    case s.stage_code
      when 'cut' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cut', 'corte'))
      when 'edge' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('edge', 'bordo', 'borda'))
      when 'cnc' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('cnc', 'usinagem'))
      when 'joinery' then exists (select 1 from unnest(coalesce(p.completed_steps, array[]::text[])) x where lower(trim(x)) in ('joinery', 'marcenaria'))
      else false
    end as is_completed
  from selected_pieces p
  cross join stage_catalog s
),
piece_completion as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.piece_id,
    count(*) filter (where ps.is_required)::integer as required_operations,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_operations,
    (
      count(*) filter (where ps.is_required) > 0
      and count(*) filter (where ps.is_required) = count(*) filter (where ps.is_required and ps.is_completed)
    ) as ready_for_separation
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.piece_id
),
lot_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.lot_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
lot_stage_forecast as (
  select
    lr.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(lr.required_pieces - lr.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(lr.required_pieces - lr.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when lr.required_pieces > 0
      then round((100.0 * lr.completed_pieces / lr.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from lot_stage_rollup lr
  join stage_models m on m.stage_code = lr.stage_code
),
lot_stage_json as (
  select
    lf.pcp_import_batch_id,
    lf.lot_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', lf.stage_code,
        'stage_label', lf.stage_label,
        'stage_order', lf.stage_order,
        'required_pieces', lf.required_pieces,
        'completed_pieces', lf.completed_pieces,
        'remaining_pieces', lf.remaining_pieces,
        'progress_percent', lf.progress_percent,
        'estimated_remaining_minutes', lf.estimated_remaining_minutes,
        'p80_remaining_minutes', lf.p80_remaining_minutes,
        'confidence', lf.confidence,
        'model_source', lf.model_source
      ) order by lf.stage_order
    ) as stages,
    coalesce(sum(lf.estimated_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(lf.p80_remaining_minutes) filter (where lf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(lf.stage_label order by lf.estimated_remaining_minutes desc)
        filter (where lf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case lf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where lf.required_pieces > 0 and lf.remaining_pieces > 0) as confidence_rank
  from lot_stage_forecast lf
  group by lf.pcp_import_batch_id, lf.lot_id
),
lot_piece_rollup as (
  select
    p.pcp_import_batch_id,
    p.lot_id,
    count(*)::integer as total_pieces,
    count(*) filter (where pc.ready_for_separation)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations), 0)::integer as completed_operations,
    count(*) filter (where p.is_blocked)::integer as blocked_pieces,
    count(*) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as rework_pieces,
    count(*) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id, p.lot_id
),
lot_results as (
  select
    l.pcp_import_batch_id,
    l.id as lot_id,
    l.lot_code,
    l.customer_name,
    l.status,
    coalesce(l.current_stage, l.current_step, 'imported') as current_stage,
    l.planned_end,
    coalesce(pr.total_pieces, 0) as total_pieces,
    coalesce(pr.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(pr.total_operations, 0) as total_operations,
    coalesce(pr.completed_operations, 0) as completed_operations,
    coalesce(pr.blocked_pieces, 0) as blocked_pieces,
    coalesce(pr.rework_pieces, 0) as rework_pieces,
    coalesce(pr.replacement_pieces, 0) as replacement_pieces,
    case when coalesce(pr.total_operations, 0) > 0
      then round((100.0 * pr.completed_operations / pr.total_operations)::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(sj.stages, '[]'::jsonb) as stages,
    coalesce(sj.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(sj.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(sj.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(sj.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(pr.blocked_pieces, 0) + coalesce(pr.rework_pieces, 0) + coalesce(pr.replacement_pieces, 0) > 0 then 'attention'
      when l.planned_end is not null and l.planned_end < now() and coalesce(pr.ready_for_separation_pieces, 0) < coalesce(pr.total_pieces, 0) then 'delayed'
      when coalesce(pr.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status
  from selected_lots l
  left join lot_piece_rollup pr on pr.lot_id = l.id
  left join lot_stage_json sj on sj.lot_id = l.id
),
batch_piece_rollup as (
  select
    p.pcp_import_batch_id,
    count(*)::integer as total_pieces,
    count(*) filter (where pc.ready_for_separation)::integer as ready_for_separation_pieces,
    coalesce(sum(pc.required_operations), 0)::integer as total_operations,
    coalesce(sum(pc.completed_operations), 0)::integer as completed_operations,
    count(*) filter (where p.is_blocked)::integer as blocked_pieces,
    count(*) filter (where lower(coalesce(p.rework_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as rework_pieces,
    count(*) filter (where lower(coalesce(p.replacement_status, '')) not in ('', 'none', 'completed', 'resolved'))::integer as replacement_pieces
  from selected_pieces p
  join piece_completion pc on pc.piece_id = p.id
  group by p.pcp_import_batch_id
),
batch_stage_rollup as (
  select
    ps.pcp_import_batch_id,
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as completed_pieces
  from piece_stage ps
  group by ps.pcp_import_batch_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage_forecast as (
  select
    br.*,
    m.minutes_per_piece,
    m.p80_minutes_per_piece,
    m.confidence,
    m.model_source,
    greatest(br.required_pieces - br.completed_pieces, 0)::integer as remaining_pieces,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.minutes_per_piece)::numeric, 1) as estimated_remaining_minutes,
    round((greatest(br.required_pieces - br.completed_pieces, 0) * m.p80_minutes_per_piece)::numeric, 1) as p80_remaining_minutes,
    case when br.required_pieces > 0
      then round((100.0 * br.completed_pieces / br.required_pieces)::numeric, 2)
      else 100.0::numeric
    end as progress_percent
  from batch_stage_rollup br
  join stage_models m on m.stage_code = br.stage_code
),
batch_stage_json as (
  select
    bf.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'stage_code', bf.stage_code,
        'stage_label', bf.stage_label,
        'stage_order', bf.stage_order,
        'required_pieces', bf.required_pieces,
        'completed_pieces', bf.completed_pieces,
        'remaining_pieces', bf.remaining_pieces,
        'progress_percent', bf.progress_percent,
        'estimated_remaining_minutes', bf.estimated_remaining_minutes,
        'p80_remaining_minutes', bf.p80_remaining_minutes,
        'minutes_per_piece', bf.minutes_per_piece,
        'confidence', bf.confidence,
        'model_source', bf.model_source
      ) order by bf.stage_order
    ) as stages,
    coalesce(sum(bf.estimated_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as estimated_remaining_minutes,
    coalesce(sum(bf.p80_remaining_minutes) filter (where bf.required_pieces > 0), 0)::numeric as p80_remaining_minutes,
    coalesce(
      (array_agg(bf.stage_label order by bf.estimated_remaining_minutes desc)
        filter (where bf.remaining_pieces > 0))[1],
      'Concluído'
    ) as bottleneck_stage,
    min(case bf.confidence when 'high' then 3 when 'medium' then 2 else 1 end)
      filter (where bf.required_pieces > 0 and bf.remaining_pieces > 0) as confidence_rank
  from batch_stage_forecast bf
  group by bf.pcp_import_batch_id
),
client_lot_json as (
  select
    lr.pcp_import_batch_id,
    jsonb_agg(
      jsonb_build_object(
        'lot_id', lr.lot_id,
        'lot_code', lr.lot_code,
        'customer_name', lr.customer_name,
        'status', lr.status,
        'current_stage', lr.current_stage,
        'planned_end', lr.planned_end,
        'total_pieces', lr.total_pieces,
        'ready_for_separation_pieces', lr.ready_for_separation_pieces,
        'total_operations', lr.total_operations,
        'completed_operations', lr.completed_operations,
        'progress_percent', lr.progress_percent,
        'blocked_pieces', lr.blocked_pieces,
        'rework_pieces', lr.rework_pieces,
        'replacement_pieces', lr.replacement_pieces,
        'integrity_percent', case when lr.total_pieces > 0 then round((100.0 * greatest(lr.total_pieces - lr.blocked_pieces - lr.rework_pieces - lr.replacement_pieces, 0) / lr.total_pieces)::numeric, 2) else 100.0 end,
        'stages', lr.stages,
        'bottleneck_stage', lr.bottleneck_stage,
        'estimated_remaining_minutes', lr.estimated_remaining_minutes,
        'p80_remaining_minutes', lr.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(lr.estimated_remaining_minutes)::integer),
        'forecast_confidence', lr.forecast_confidence,
        'forecast_status', lr.forecast_status,
        'ready_for_separation', lr.total_pieces > 0 and lr.ready_for_separation_pieces = lr.total_pieces
      ) order by lr.customer_name nulls last, lr.lot_code
    ) as client_lots
  from lot_results lr
  group by lr.pcp_import_batch_id
),
batch_results as (
  select
    b.id as batch_id,
    b.general_lot_code,
    b.file_name,
    b.status,
    b.created_at,
    b.imported_at,
    coalesce(bp.total_pieces, b.total_parts, 0) as total_pieces,
    coalesce(bp.ready_for_separation_pieces, 0) as ready_for_separation_pieces,
    coalesce(bp.total_operations, b.total_operations, 0) as total_operations,
    coalesce(bp.completed_operations, b.completed_operations, 0) as completed_operations,
    coalesce(bp.blocked_pieces, 0) as blocked_pieces,
    coalesce(bp.rework_pieces, 0) as rework_pieces,
    coalesce(bp.replacement_pieces, 0) as replacement_pieces,
    coalesce((select count(*) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as client_lots_count,
    coalesce((select count(distinct nullif(trim(l.customer_name), '')) from selected_lots l where l.pcp_import_batch_id = b.id), 0)::integer as customers_count,
    case when coalesce(bp.total_operations, b.total_operations, 0) > 0
      then round((100.0 * coalesce(bp.completed_operations, b.completed_operations, 0) / coalesce(bp.total_operations, b.total_operations, 0))::numeric, 2)
      else 0.0::numeric
    end as progress_percent,
    coalesce(bs.stages, '[]'::jsonb) as stages,
    coalesce(bs.estimated_remaining_minutes, 0)::numeric as estimated_remaining_minutes,
    coalesce(bs.p80_remaining_minutes, 0)::numeric as p80_remaining_minutes,
    coalesce(bs.bottleneck_stage, 'Sem rota') as bottleneck_stage,
    case coalesce(bs.confidence_rank, 1) when 3 then 'high' when 2 then 'medium' else 'low' end as forecast_confidence,
    case
      when coalesce(bp.blocked_pieces, 0) + coalesce(bp.rework_pieces, 0) + coalesce(bp.replacement_pieces, 0) > 0 then 'attention'
      when coalesce(bp.completed_operations, b.completed_operations, 0) = 0 then 'not_started'
      else 'on_track'
    end as forecast_status,
    case when p_batch_id is not null then coalesce(cl.client_lots, '[]'::jsonb) else '[]'::jsonb end as client_lots
  from selected_batches b
  left join batch_piece_rollup bp on bp.pcp_import_batch_id = b.id
  left join batch_stage_json bs on bs.pcp_import_batch_id = b.id
  left join client_lot_json cl on cl.pcp_import_batch_id = b.id
)
select jsonb_build_object(
  'generated_at', now(),
  'prediction_target', 'ready_for_separation',
  'model_window_days', 90,
  'stage_models', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', m.stage_code,
        'stage_label', m.stage_label,
        'stage_order', m.stage_order,
        'sample_count', m.sample_count,
        'observed_days', m.observed_days,
        'minutes_per_piece', m.minutes_per_piece,
        'p80_minutes_per_piece', m.p80_minutes_per_piece,
        'confidence', m.confidence,
        'model_source', m.model_source
      ) order by m.stage_order
    ) from stage_models m
  ), '[]'::jsonb),
  'general_lots', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'batch_id', br.batch_id,
        'general_lot_code', br.general_lot_code,
        'file_name', br.file_name,
        'status', br.status,
        'created_at', br.created_at,
        'imported_at', br.imported_at,
        'total_pieces', br.total_pieces,
        'ready_for_separation_pieces', br.ready_for_separation_pieces,
        'total_operations', br.total_operations,
        'completed_operations', br.completed_operations,
        'progress_percent', br.progress_percent,
        'client_lots_count', br.client_lots_count,
        'customers_count', br.customers_count,
        'blocked_pieces', br.blocked_pieces,
        'rework_pieces', br.rework_pieces,
        'replacement_pieces', br.replacement_pieces,
        'integrity_percent', case when br.total_pieces > 0 then round((100.0 * greatest(br.total_pieces - br.blocked_pieces - br.rework_pieces - br.replacement_pieces, 0) / br.total_pieces)::numeric, 2) else 100.0 end,
        'stages', br.stages,
        'bottleneck_stage', br.bottleneck_stage,
        'estimated_remaining_minutes', br.estimated_remaining_minutes,
        'p80_remaining_minutes', br.p80_remaining_minutes,
        'predicted_ready_at', now() + make_interval(mins => ceil(br.estimated_remaining_minutes)::integer),
        'forecast_confidence', br.forecast_confidence,
        'forecast_status', br.forecast_status,
        'ready_for_separation', br.total_pieces > 0 and br.ready_for_separation_pieces = br.total_pieces,
        'client_lots', br.client_lots
      ) order by br.created_at desc
    ) from batch_results br
  ), '[]'::jsonb)
);
$function$;

revoke all on function public.get_general_lot_tracking(uuid, integer) from public;
grant execute on function public.get_general_lot_tracking(uuid, integer) to authenticated;

comment on function public.get_general_lot_tracking(uuid, integer) is
  'Retorna lote geral, lotes de clientes, integridade por etapa e previsão adaptativa até ficar pronto para separação.';

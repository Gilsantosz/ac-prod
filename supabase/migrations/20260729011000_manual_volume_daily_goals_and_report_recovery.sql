-- AC.Prod / Leo Flow
-- Fecha três lacunas do fluxo produtivo:
-- 1. baixa agregada limitada ao saldo real do lote/etapa;
-- 2. progresso efetivo considerando volume manual sem inventar peças;
-- 3. recuperação de agendamentos de relatório presos em uma execução já finalizada.

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
    count(*) filter (where ps.is_required and ps.is_completed)::integer as traceable_completed_pieces
  from piece_stage ps
  group by ps.lot_id, ps.stage_code, ps.stage_label, ps.stage_order
),
batch_stage as (
  select
    ps.stage_code,
    ps.stage_label,
    ps.stage_order,
    count(*) filter (where ps.is_required)::integer as required_pieces,
    count(*) filter (where ps.is_required and ps.is_completed)::integer as traceable_completed_pieces
  from piece_stage ps
  group by ps.stage_code, ps.stage_label, ps.stage_order
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
    lot_stage.*,
    lot.created_at as lot_created_at,
    greatest(lot_stage.required_pieces - lot_stage.traceable_completed_pieces, 0)::integer as traceable_remaining,
    coalesce(manual.recorded_manual_quantity, 0)::integer as batch_manual_quantity
  from lot_stage
  left join public.production_lots lot on lot.id = lot_stage.lot_id
  left join manual_stage manual on manual.stage_code = lot_stage.stage_code
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
      allocated.required_pieces,
      allocated.traceable_completed_pieces + allocated.manual_quantity
    )::integer as effective_completed_pieces
  from lot_allocated allocated
),
batch_effective as (
  select
    batch.*,
    coalesce(manual.recorded_manual_quantity, 0)::integer as recorded_manual_quantity,
    least(
      greatest(batch.required_pieces - batch.traceable_completed_pieces, 0),
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
      and stage.traceable_completed_pieces + stage.manual_quantity < stage.required_pieces
  ),
  'batch_stages', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'stage_code', batch.stage_code,
        'stage_label', batch.stage_label,
        'stage_order', batch.stage_order,
        'required_pieces', batch.required_pieces,
        'traceable_completed_pieces', batch.traceable_completed_pieces,
        'manual_quantity', batch.manual_quantity,
        'recorded_manual_quantity', batch.recorded_manual_quantity,
        'completed_pieces', least(
          batch.required_pieces,
          batch.traceable_completed_pieces + batch.manual_quantity
        ),
        'effective_completed_pieces', least(
          batch.required_pieces,
          batch.traceable_completed_pieces + batch.manual_quantity
        ),
        'remaining_pieces', greatest(
          batch.required_pieces - batch.traceable_completed_pieces - batch.manual_quantity,
          0
        ),
        'progress_percent', case when batch.required_pieces > 0
          then round((
            100.0 * least(
              batch.required_pieces,
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
    left join public.production_stage_policies policy on policy.stage_code = batch.stage_code
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
            'manual_quantity', stage.manual_quantity,
            'completed_pieces', stage.effective_completed_pieces,
            'effective_completed_pieces', stage.effective_completed_pieces,
            'remaining_pieces', greatest(stage.required_pieces - stage.effective_completed_pieces, 0),
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
      left join public.production_stage_policies policy on policy.stage_code = stage.stage_code
      group by stage.lot_id
    ) lot
  ), '{}'::jsonb)
);
$function$;

revoke all on function public.get_lot_route_stage_progress(uuid) from public;
revoke all on function public.get_lot_route_stage_progress(uuid) from anon;
grant execute on function public.get_lot_route_stage_progress(uuid) to authenticated;

comment on function public.get_lot_route_stage_progress(uuid) is
  'Retorna progresso por etapa/lote somando coleta individual e volume manual auditável, sem criar rastreabilidade sintética.';

create or replace function public.register_untraceable_stage_quantity(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.get_my_role();
  v_general_lot_code text := upper(trim(coalesce(p_payload->>'general_lot_code', '')));
  v_requested_cell text := trim(coalesce(p_payload->>'cell_name', ''));
  v_requested_batch_id uuid;
  v_stage_code text;
  v_cell_id uuid;
  v_cell_name text;
  v_shift text := coalesce(nullif(trim(p_payload->>'shift'), ''), '1º Turno');
  v_operator text := coalesce(nullif(trim(p_payload->>'operator'), ''), 'Operador Manual');
  v_quantity integer;
  v_unit text := 'pieces';
  v_notes text := nullif(trim(coalesce(p_payload->>'notes', '')), '');
  v_production_date date := coalesce(nullif(p_payload->>'date', '')::date, current_date);
  v_client_event_id text := coalesce(
    nullif(trim(p_payload->>'client_event_id'), ''),
    'manual-untraceable-' || extensions.gen_random_uuid()::text
  );
  v_batch_id uuid;
  v_batch_status text;
  v_lot_id uuid;
  v_entry_id uuid;
  v_record_id uuid;
  v_created_at timestamptz := now();
  v_progress jsonb;
  v_stage_progress jsonb;
  v_required integer;
  v_traceable integer;
  v_manual integer;
  v_remaining integer;
  v_effective_goal numeric := 0;
  v_metric_name text;
  v_batch_completed boolean := false;
  v_total_operations integer := 0;
  v_completed_operations integer := 0;
  v_closed_lot_count integer := 0;
  v_completed_parts integer := 0;
begin
  if v_user_id is null
     or not (
       v_role in ('admin', 'manager', 'supervisor')
       or public.has_permission('register_manual_production')
     )
  then
    raise exception 'Você não possui permissão para registrar baixa manual de produção.';
  end if;

  if v_general_lot_code = '' then
    raise exception 'Selecione um Lote Geral ativo.';
  end if;

  begin
    v_requested_batch_id := nullif(p_payload->>'pcp_import_batch_id', '')::uuid;
  exception when others then
    raise exception 'O identificador do Lote Geral ativo é inválido.';
  end;

  if v_requested_batch_id is null then
    raise exception 'Selecione um Lote Geral ativo na lista.';
  end if;

  begin
    v_quantity := (p_payload->>'quantity')::integer;
  exception when others then
    v_quantity := null;
  end;

  if v_quantity is null or v_quantity <= 0 then
    raise exception 'A quantidade produzida deve ser um número inteiro maior que zero.';
  end if;

  select record.id, record.production_entry_id
    into v_record_id, v_entry_id
  from public.manual_production_records record
  where record.client_event_id = v_client_event_id;

  if v_record_id is not null then
    return jsonb_build_object(
      'success', true,
      'duplicated', true,
      'record_id', v_record_id,
      'production_entry_id', v_entry_id,
      'general_lot_code', v_general_lot_code,
      'quantity', v_quantity,
      'traceability_type', 'aggregate_untraceable'
    );
  end if;

  select batch.id, batch.status
    into v_batch_id, v_batch_status
  from public.promob_import_batches batch
  where batch.id = v_requested_batch_id
    and upper(trim(coalesce(batch.general_lot_code, ''))) = v_general_lot_code
    and batch.status not in ('cancelled', 'error', 'duplicated', 'failed_validation')
  for update;

  if v_batch_id is null then
    raise exception 'O Lote Geral selecionado não está mais ativo. Atualize a lista e tente novamente.';
  end if;

  v_stage_code := public.resolve_production_stage_for_cell(null, v_requested_cell);
  if v_stage_code is null then
    raise exception 'A célula selecionada não está vinculada a uma etapa produtiva.';
  end if;

  if not coalesce((
    select policy.manual_quantity_allowed
    from public.production_stage_policies policy
    where policy.stage_code = v_stage_code
  ), false) then
    raise exception 'A baixa por volume está desativada para esta etapa. Use a coleta individual por código de barras.';
  end if;

  select cell.id, cell.name
    into v_cell_id, v_cell_name
  from public.cells cell
  where coalesce(cell.active, true)
    and public.resolve_production_stage_for_cell(cell.id, cell.name) = v_stage_code
  order by
    case when public.normalize_production_name(cell.name) = public.normalize_production_name(v_requested_cell) then 0 else 1 end,
    cell.created_at
  limit 1;

  if v_cell_id is null then
    raise exception 'Nenhuma célula ativa está vinculada à etapa solicitada.';
  end if;

  v_progress := public.get_lot_route_stage_progress(v_batch_id);
  select stage.value
    into v_stage_progress
  from jsonb_array_elements(coalesce(v_progress->'batch_stages', '[]'::jsonb)) stage(value)
  where stage.value->>'stage_code' = v_stage_code
  limit 1;

  if v_stage_progress is null then
    raise exception 'A etapa selecionada não faz parte da rota deste Lote Geral.';
  end if;

  v_required := coalesce((v_stage_progress->>'required_pieces')::integer, 0);
  v_traceable := coalesce((v_stage_progress->>'traceable_completed_pieces')::integer, 0);
  v_manual := coalesce((v_stage_progress->>'manual_quantity')::integer, 0);
  v_remaining := greatest(v_required - v_traceable - v_manual, 0);

  if v_required <= 0 then
    raise exception 'Este Lote Geral não possui peças previstas para a etapa %.', v_cell_name;
  end if;

  if v_remaining <= 0 then
    raise exception 'A etapa % já está concluída para este Lote Geral.', v_cell_name;
  end if;

  if v_quantity > v_remaining then
    raise exception 'Quantidade acima do saldo da etapa. Saldo disponível: % peça(s).', v_remaining;
  end if;

  select lot.id
    into v_lot_id
  from public.production_lots lot
  where lot.pcp_import_batch_id = v_batch_id
  order by lot.created_at, lot.id
  limit 1;

  select coalesce(goal.target, goal.capacity, 0)
    into v_effective_goal
  from public.production_daily_goals goal
  where goal.date <= v_production_date
    and goal.shift = v_shift
    and public.normalize_production_name(goal.cell_name) = public.normalize_production_name(v_cell_name)
    and goal.metric_unit = v_unit
  order by goal.date desc, goal.updated_at desc
  limit 1;

  v_metric_name := case v_stage_code
    when 'separation' then 'Peças separadas'
    when 'packaging' then 'Peças embaladas'
    else 'Peças produzidas'
  end;

  insert into public.production_entries (
    date,
    shift,
    cell,
    hour,
    produced,
    target,
    scrap,
    downtime,
    operator,
    notes,
    created_by,
    created_at,
    lot_id,
    step_code,
    order_number,
    lot_code,
    process_step,
    entry_mode,
    source,
    approval_status,
    traceability_status,
    client_event_id,
    metric_unit,
    metric_unit_label,
    metric_name,
    planned_target,
    realized_quantity,
    pieces_quantity,
    pcp_import_batch_id,
    is_manual,
    unit_of_measure
  )
  values (
    v_production_date,
    v_shift,
    v_cell_name,
    to_char(v_created_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
    v_quantity,
    round(v_effective_goal)::integer,
    0,
    0,
    v_operator,
    coalesce(v_notes, 'Baixa por volume sem rastreabilidade individual'),
    v_user_id,
    v_created_at,
    v_lot_id,
    v_stage_code,
    v_general_lot_code,
    v_general_lot_code,
    v_stage_code,
    'manual_volume',
    'manual_untraceable_stage',
    'valid',
    'limited',
    v_client_event_id,
    v_unit,
    'peças',
    v_metric_name,
    v_effective_goal,
    v_quantity,
    v_quantity,
    v_batch_id,
    true,
    'pecas'
  )
  returning id into v_entry_id;

  insert into public.manual_production_records (
    type,
    general_lot_code,
    cell_name,
    shift,
    operator,
    quantity,
    unit_of_measure,
    cascade_all_cells,
    notes,
    status,
    created_at,
    production_date,
    stage_code,
    traceability_type,
    created_by,
    client_event_id,
    pcp_import_batch_id,
    production_entry_id,
    metadata
  )
  values (
    'baixa_por_volume',
    v_general_lot_code,
    v_cell_name,
    v_shift,
    v_operator,
    v_quantity,
    'pecas',
    false,
    v_notes,
    'approved',
    v_created_at,
    v_production_date,
    v_stage_code,
    'aggregate_untraceable',
    v_user_id,
    v_client_event_id,
    v_batch_id,
    v_entry_id,
    jsonb_build_object(
      'individual_pieces_changed', false,
      'collection_event_created', false,
      'physical_traceability', false,
      'remaining_before', v_remaining,
      'remaining_after', v_remaining - v_quantity
    )
  )
  returning id into v_record_id;

  v_progress := public.get_lot_route_stage_progress(v_batch_id);
  v_batch_completed := coalesce((v_progress->>'batch_completed')::boolean, false);

  with lot_progress as (
    select
      lot.id,
      not exists (
        select 1
        from jsonb_array_elements(
          coalesce(v_progress->'lot_stages'->(lot.id::text), '[]'::jsonb)
        ) stage(value)
        where coalesce((stage.value->>'required_pieces')::integer, 0) > 0
          and coalesce((stage.value->>'remaining_pieces')::integer, 0) > 0
      ) as is_complete
    from public.production_lots lot
    where lot.pcp_import_batch_id = v_batch_id
  )
  update public.production_lots lot
  set status = 'closed',
      current_status = 'completed',
      current_stage = 'completed',
      current_step = 'completed',
      current_cell = v_cell_name,
      progress_percent = 100,
      produced_quantity = coalesce(nullif(lot.planned_quantity, 0), lot.produced_quantity),
      approved_quantity = coalesce(nullif(lot.planned_quantity, 0), lot.approved_quantity),
      pending_quantity = 0,
      actual_end = coalesce(lot.actual_end, v_created_at),
      closed_at = coalesce(lot.closed_at, v_created_at),
      updated_at = v_created_at
  from lot_progress progress
  where lot.id = progress.id
    and progress.is_complete
    and lot.status not in ('closed', 'shipped', 'cancelled');

  select
    coalesce(sum((stage.value->>'required_pieces')::integer), 0),
    coalesce(sum((stage.value->>'effective_completed_pieces')::integer), 0)
    into v_total_operations, v_completed_operations
  from jsonb_array_elements(coalesce(v_progress->'batch_stages', '[]'::jsonb)) stage(value);

  select
    count(*) filter (where lot.status in ('closed', 'shipped')),
    coalesce(sum(
      case when lot.status in ('closed', 'shipped')
        then coalesce(nullif(lot.planned_quantity, 0), 0)
        else 0
      end
    ), 0)::integer
    into v_closed_lot_count, v_completed_parts
  from public.production_lots lot
  where lot.pcp_import_batch_id = v_batch_id;

  update public.promob_import_batches batch
  set completed_operations = v_completed_operations,
      total_operations = greatest(coalesce(batch.total_operations, 0), v_total_operations),
      progress_percent = case when v_total_operations > 0
        then round((100.0 * v_completed_operations / v_total_operations)::numeric, 2)
        else coalesce(batch.progress_percent, 0)
      end,
      completed_parts = case when v_batch_completed
        then coalesce(batch.total_parts, v_completed_parts)
        else greatest(coalesce(batch.completed_parts, 0), least(v_completed_parts, coalesce(batch.total_parts, v_completed_parts)))
      end,
      pending_parts = case when v_batch_completed
        then 0
        else greatest(coalesce(batch.total_parts, 0) - greatest(coalesce(batch.completed_parts, 0), v_completed_parts), 0)
      end
  where batch.id = v_batch_id;

  perform pg_notify(
    'production_events',
    jsonb_build_object(
      'event', 'manual_volume_registered',
      'batch_id', v_batch_id,
      'general_lot_code', v_general_lot_code,
      'stage_code', v_stage_code,
      'cell_name', v_cell_name,
      'quantity', v_quantity
    )::text
  );

  return jsonb_build_object(
    'success', true,
    'duplicated', false,
    'record_id', v_record_id,
    'production_entry_id', v_entry_id,
    'batch_id', v_batch_id,
    'lot_id', v_lot_id,
    'general_lot_code', v_general_lot_code,
    'stage_code', v_stage_code,
    'cell_name', v_cell_name,
    'quantity', v_quantity,
    'unit_of_measure', 'pecas',
    'production_date', v_production_date,
    'traceability_type', 'aggregate_untraceable',
    'individual_pieces_changed', false,
    'remaining_before', v_remaining,
    'remaining_after', v_remaining - v_quantity,
    'stage_completed', v_remaining - v_quantity = 0,
    'batch_completed', v_batch_completed,
    'closed_lot_count', v_closed_lot_count,
    'progress', v_progress
  );
end;
$function$;

revoke all on function public.register_untraceable_stage_quantity(jsonb) from public;
revoke all on function public.register_untraceable_stage_quantity(jsonb) from anon;
grant execute on function public.register_untraceable_stage_quantity(jsonb) to authenticated;

comment on function public.register_untraceable_stage_quantity(jsonb) is
  'Registra baixa por volume em lote geral ativo, limitada ao saldo da etapa, contabilizada em KPIs sem rastreabilidade individual sintética.';

create or replace function public.claim_due_report_schedules(
  p_lock_token text,
  p_lock_duration interval default interval '10 minutes'
)
returns table(
  run_id uuid,
  schedule_id uuid,
  name text,
  report_types text[],
  format text,
  cell_filter text[],
  period_mode text,
  shift_filter text[]
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := now();
  v_rounded_now timestamptz := date_trunc('minute', v_now);
  v_schedule record;
  v_idempotency_key text;
  v_run_id uuid;
  v_existing_status text;
begin
  for v_schedule in
    select
      schedule.id,
      schedule.name,
      schedule.report_types,
      schedule.report_type,
      schedule.format,
      schedule.cell_filter,
      schedule.period_mode,
      schedule.shift_filter,
      schedule.next_run_at,
      schedule.frequency,
      schedule.time_local,
      schedule.timezone
    from public.report_schedules schedule
    where schedule.enabled = true
      and (schedule.next_run_at is null or schedule.next_run_at <= v_now)
    for update skip locked
  loop
    v_run_id := null;
    v_existing_status := null;
    v_idempotency_key := 'scheduled:' || v_schedule.id || ':' ||
      to_char(coalesce(v_schedule.next_run_at, v_rounded_now), 'YYYY-MM-DD HH24:MI:SS"Z"');

    insert into public.report_schedule_runs (
      schedule_id,
      trigger_source,
      scheduled_for,
      period_start,
      period_end,
      status,
      idempotency_key,
      locked_at,
      lock_token,
      started_at,
      created_at,
      updated_at
    )
    values (
      v_schedule.id,
      'scheduled',
      coalesce(v_schedule.next_run_at, v_rounded_now),
      v_now - interval '1 day',
      v_now,
      'processing',
      v_idempotency_key,
      v_now,
      p_lock_token,
      v_now,
      v_now,
      v_now
    )
    on conflict (idempotency_key) do nothing
    returning id into v_run_id;

    if v_run_id is null then
      select existing.status
        into v_existing_status
      from public.report_schedule_runs existing
      where existing.idempotency_key = v_idempotency_key;

      if v_existing_status in ('sent', 'partial', 'failed', 'skipped', 'cancelled') then
        update public.report_schedules schedule
        set next_run_at = public.compute_report_next_run(
              v_schedule.frequency,
              v_schedule.time_local,
              coalesce(v_schedule.timezone, 'America/Sao_Paulo'),
              v_now + interval '1 minute'
            ),
            updated_at = v_now
        where schedule.id = v_schedule.id;
      end if;

      continue;
    end if;

    run_id := v_run_id;
    schedule_id := v_schedule.id;
    name := v_schedule.name;
    report_types := coalesce(v_schedule.report_types, array[v_schedule.report_type]);
    format := v_schedule.format;
    cell_filter := v_schedule.cell_filter;
    period_mode := coalesce(v_schedule.period_mode, 'current_day');
    shift_filter := v_schedule.shift_filter;
    return next;
  end loop;
end;
$function$;

revoke all on function public.claim_due_report_schedules(text, interval) from public;
revoke all on function public.claim_due_report_schedules(text, interval) from anon;
grant execute on function public.claim_due_report_schedules(text, interval) to service_role;

-- Repara imediatamente horários presos em uma execução já finalizada.
update public.report_schedules schedule
set next_run_at = public.compute_report_next_run(
      schedule.frequency,
      schedule.time_local,
      coalesce(schedule.timezone, 'America/Sao_Paulo'),
      now() + interval '1 minute'
    ),
    updated_at = now(),
    last_error = null,
    paused_reason = null
where schedule.enabled = true
  and schedule.next_run_at <= now()
  and exists (
    select 1
    from public.report_schedule_runs run
    where run.schedule_id = schedule.id
      and run.scheduled_for = schedule.next_run_at
      and run.status in ('sent', 'partial', 'failed', 'skipped', 'cancelled')
  );

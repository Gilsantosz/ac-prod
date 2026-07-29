-- AC.Prod / Leo Flow
-- Resolve células produtivas por vínculo/alias, torna Separação e Embalagem
-- configuráveis e registra baixas quantitativas sem inventar rastreabilidade.

create or replace function public.normalize_production_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select regexp_replace(
    translate(
      lower(trim(coalesce(p_value, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[^a-z0-9]+',
    '',
    'g'
  );
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

  if v_step_code is not null then
    return v_step_code;
  end if;

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

comment on function public.resolve_production_stage_for_cell(uuid, text) is
  'Resolve a etapa canônica por vínculo routing_steps.cell_id ou por aliases normalizados; nunca usa a etapa atual da peça como fallback.';

-- Garante que as duas células de acabamento existam para uso imediato e
-- vincula etapas conhecidas sem depender de UUIDs gerados em cada ambiente.
insert into public.cells (name, description, active, notes)
select 'Separação', 'Separação de peças e preparação para embalagem.', true,
       'Coleta física configurável; aceita baixa quantitativa sem rastreabilidade.'
where not exists (
  select 1 from public.cells
  where public.normalize_production_name(name) = 'separacao'
);

insert into public.cells (name, description, active, notes)
select 'Embalagem', 'Embalagem e preparação final do lote.', true,
       'Coleta física configurável; aceita baixa quantitativa sem rastreabilidade.'
where not exists (
  select 1 from public.cells
  where public.normalize_production_name(name) = 'embalagem'
);

update public.routing_steps step
set cell_id = (
      select c.id
      from public.cells c
      where coalesce(c.active, true)
        and public.resolve_production_stage_for_cell(null, c.name) = step.code
      order by
        case when public.normalize_production_name(c.name) = public.normalize_production_name(step.name) then 0 else 1 end,
        c.created_at
      limit 1
    ),
    updated_at = now()
where step.code in ('cut', 'edge', 'drill', 'cnc', 'joinery', 'separation', 'packaging')
  and step.cell_id is null
  and exists (
    select 1
    from public.cells c
    where coalesce(c.active, true)
      and public.resolve_production_stage_for_cell(null, c.name) = step.code
  );

create table if not exists public.production_stage_policies (
  stage_code text primary key,
  stage_label text not null,
  display_order integer not null,
  traceable_collection_required boolean not null default true,
  manual_quantity_allowed boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.production_stage_policies (
  stage_code,
  stage_label,
  display_order,
  traceable_collection_required,
  manual_quantity_allowed
)
values
  ('cut', 'Corte', 1, true, false),
  ('edge', 'Borda', 2, true, false),
  ('drill', 'Furação', 3, true, false),
  ('cnc', 'Usinagem CNC', 4, true, false),
  ('joinery', 'Marcenaria', 5, true, false),
  ('separation', 'Separação', 6, false, true),
  ('packaging', 'Embalagem', 7, false, true)
on conflict (stage_code) do update
set stage_label = excluded.stage_label,
    display_order = excluded.display_order;

alter table public.production_stage_policies enable row level security;

drop policy if exists production_stage_policies_read on public.production_stage_policies;
create policy production_stage_policies_read
on public.production_stage_policies
for select
to authenticated
using (true);

drop policy if exists production_stage_policies_manage on public.production_stage_policies;
create policy production_stage_policies_manage
on public.production_stage_policies
for update
to authenticated
using (public.get_my_role() in ('admin', 'manager', 'supervisor'))
with check (public.get_my_role() in ('admin', 'manager', 'supervisor'));

revoke all on table public.production_stage_policies from anon;
grant select on table public.production_stage_policies to authenticated;
grant update (
  traceable_collection_required,
  manual_quantity_allowed,
  updated_by,
  updated_at
) on table public.production_stage_policies to authenticated;

-- Corrige a função de coleta vigente sem substituir as demais evoluções já
-- aplicadas nela (concorrência, snapshots e Broadcast).
do $migration$
declare
  v_definition text;
  v_patched text;
  v_old text := $old$
  IF v_step_input IS NOT NULL THEN
    v_target_step_code := v_step_input;
  ELSE
    SELECT code INTO v_target_step_code
    FROM public.routing_steps
    WHERE lower(code) = lower(v_cell)
       OR lower(name) = lower(v_cell)
       OR (v_cell IN ('Borda', 'Bordo') AND code = 'edge')
       OR (v_cell = 'Usinagem' AND code = 'cnc')
       OR (v_cell = 'Furação' AND code = 'drill')
       OR (v_cell = 'Corte' AND code = 'cut')
       OR (v_cell = 'Marcenaria' AND code = 'joinery')
    ORDER BY sequence NULLS LAST
    LIMIT 1;
  END IF;
  v_target_step_code := COALESCE(v_target_step_code, v_piece.current_stage, 'Corte');
$old$;
  v_new text := $new$
  IF v_step_input IS NOT NULL THEN
    v_target_step_code := COALESCE(
      public.resolve_production_stage_for_cell(NULL, v_step_input),
      lower(trim(v_step_input))
    );
  ELSE
    v_target_step_code := public.resolve_production_stage_for_cell(v_session.cell_id, v_cell);
  END IF;

  -- Uma célula desconhecida deve bloquear claramente. Usar current_stage como
  -- fallback fazia "Fura" virar "Concluída" e rejeitava uma rota válida.
  v_target_step_code := COALESCE(v_target_step_code, '__unmapped_cell__');
$new$;
begin
  select pg_get_functiondef('public.process_production_reading_impl(jsonb)'::regprocedure)
    into v_definition;
  v_patched := replace(v_definition, v_old, v_new);

  if v_patched = v_definition then
    raise exception 'Não foi possível localizar o resolvedor legado em process_production_reading_impl.';
  end if;

  execute v_patched;
end;
$migration$;

-- O snapshot/KPI da célula usa o mesmo resolvedor. Assim "Fura" não aparece
-- como uma etapa separada de "Furação".
do $migration$
declare
  v_definition text;
  v_patched text;
  v_old text := $old$
  SELECT step.code
  INTO v_step_code
  FROM public.routing_steps step
  WHERE lower(step.code) = lower(p_cell_name)
     OR lower(step.name) = lower(p_cell_name)
     OR (lower(p_cell_name) IN ('borda', 'bordo') AND step.code = 'edge')
     OR (lower(p_cell_name) IN ('usinagem', 'cnc') AND step.code = 'cnc')
     OR (lower(p_cell_name) IN ('furação', 'furacao', 'drill') AND step.code = 'drill')
     OR (lower(p_cell_name) IN ('corte', 'cut') AND step.code = 'cut')
     OR (lower(p_cell_name) IN ('marcenaria', 'joinery') AND step.code = 'joinery')
     OR (lower(p_cell_name) IN ('separação', 'separacao', 'separation') AND step.code = 'separation')
     OR (lower(p_cell_name) IN ('embalagem', 'packaging') AND step.code = 'packaging')
     OR (lower(p_cell_name) IN ('expedição', 'expedicao', 'shipping') AND step.code = 'shipping')
  ORDER BY step.sequence NULLS LAST
  LIMIT 1;

  v_step_code := COALESCE(v_step_code, lower(trim(p_cell_name)));
$old$;
  v_new text := $new$
  v_step_code := COALESCE(
    public.resolve_production_stage_for_cell(NULL, p_cell_name),
    '__unmapped_cell__'
  );
$new$;
begin
  if to_regprocedure('public.get_collection_cell_snapshot_v2(text,uuid,text,timestamptz,timestamptz,uuid,uuid)') is null then
    return;
  end if;

  select pg_get_functiondef(
    'public.get_collection_cell_snapshot_v2(text,uuid,text,timestamptz,timestamptz,uuid,uuid)'::regprocedure
  ) into v_definition;
  v_patched := replace(v_definition, v_old, v_new);

  if v_patched = v_definition then
    raise exception 'Não foi possível atualizar o resolvedor de get_collection_cell_snapshot_v2.';
  end if;

  execute v_patched;
end;
$migration$;

-- Etapas opcionais não bloqueiam uma coleta posterior. Ao reativar a
-- obrigatoriedade, a validação sequencial volta a exigi-las automaticamente.
do $migration$
declare
  v_definition text;
  v_patched text;
  v_old text := $old$
    IF NOT (v_step = ANY(v_piece.completed_steps)) THEN
      v_pending_stages := array_append(v_pending_stages, v_step);
    END IF;
$old$;
  v_new text := $new$
    IF NOT (v_step = ANY(COALESCE(v_piece.completed_steps, '{}'::text[])))
       AND COALESCE((
         SELECT policy.traceable_collection_required
         FROM public.production_stage_policies policy
         WHERE policy.stage_code = v_step
       ), true)
    THEN
      v_pending_stages := array_append(v_pending_stages, v_step);
    END IF;
$new$;
begin
  select pg_get_functiondef('public.validar_fluxo_da_peca(uuid,text)'::regprocedure)
    into v_definition;
  v_patched := replace(v_definition, v_old, v_new);

  if v_patched = v_definition then
    raise exception 'Não foi possível tornar etapas opcionais em validar_fluxo_da_peca.';
  end if;

  execute v_patched;
end;
$migration$;

-- A integridade considera apenas etapas cuja coleta física está obrigatória,
-- embora a rota completa continue sendo exibida na interface.
do $migration$
declare
  v_definition text;
  v_patched text;
  v_before text;
  v_old_approved text := $old$
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'completed' OR status = 'inspected' OR status = 'ready_for_shipping' OR status = 'shipped')
  INTO v_total_pieces, v_approved_pieces
  FROM public.production_pieces WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced';
$old$;
  v_new_approved text := $new$
  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1
             FROM unnest(COALESCE(piece.route_steps, '{}'::text[])) route_step
             WHERE NOT (
               route_step = ANY(COALESCE(piece.completed_steps, '{}'::text[]))
             )
               AND COALESCE((
                 SELECT policy.traceable_collection_required
                 FROM public.production_stage_policies policy
                 WHERE policy.stage_code = route_step
               ), true)
           )
         )
  INTO v_total_pieces, v_approved_pieces
  FROM public.production_pieces piece
  WHERE piece.lot_id = p_lot_id
    AND piece.status <> 'cancelled'
    AND piece.status <> 'replaced';
$new$;
  v_old_pending text := $old$
          IF NOT (v_step = ANY(COALESCE(v_piece.completed_steps, '{}'::text[]))) THEN
            v_is_pending := true;
          END IF;
$old$;
  v_new_pending text := $new$
          IF NOT (v_step = ANY(COALESCE(v_piece.completed_steps, '{}'::text[])))
             AND COALESCE((
               SELECT policy.traceable_collection_required
               FROM public.production_stage_policies policy
               WHERE policy.stage_code = v_step
             ), true)
          THEN
            v_is_pending := true;
          END IF;
$new$;
  v_old_bottleneck text := $old$
    WHERE step_name NOT IN (
      SELECT unnest(COALESCE(completed_steps, '{}'::text[]))
      FROM public.production_pieces
      WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced'
    )
$old$;
  v_new_bottleneck text := $new$
    WHERE step_name NOT IN (
      SELECT unnest(COALESCE(completed_steps, '{}'::text[]))
      FROM public.production_pieces
      WHERE lot_id = p_lot_id AND status <> 'cancelled' AND status <> 'replaced'
    )
      AND COALESCE((
        SELECT policy.traceable_collection_required
        FROM public.production_stage_policies policy
        WHERE policy.stage_code = step_name
      ), true)
$new$;
begin
  select pg_get_functiondef('public.calcular_integridade_do_lote(uuid)'::regprocedure)
    into v_definition;

  v_before := v_definition;
  v_patched := replace(v_definition, v_old_approved, v_new_approved);
  if v_patched = v_before then
    raise exception 'Não foi possível atualizar peças aprovadas na integridade do lote.';
  end if;

  v_before := v_patched;
  v_patched := replace(v_patched, v_old_pending, v_new_pending);
  if v_patched = v_before then
    raise exception 'Não foi possível atualizar etapas pendentes na integridade do lote.';
  end if;

  v_before := v_patched;
  v_patched := replace(v_patched, v_old_bottleneck, v_new_bottleneck);
  if v_patched = v_before then
    raise exception 'Não foi possível atualizar o gargalo na integridade do lote.';
  end if;

  execute v_patched;
end;
$migration$;

-- Histórico quantitativo agregado: não cria peça sintética, leitura unitária
-- ou evento de scanner.
alter table public.manual_production_records
  add column if not exists production_date date,
  add column if not exists stage_code text,
  add column if not exists traceability_type text not null default 'aggregate_untraceable',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists client_event_id text,
  add column if not exists pcp_import_batch_id uuid references public.promob_import_batches(id) on delete set null,
  add column if not exists production_entry_id uuid references public.production_entries(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists uq_manual_production_records_client_event
  on public.manual_production_records (client_event_id)
  where client_event_id is not null;

create index if not exists idx_manual_production_stage_daily
  on public.manual_production_records (
    production_date,
    stage_code,
    general_lot_code
  )
  where traceability_type = 'aggregate_untraceable';

create or replace function public.register_untraceable_stage_quantity(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.get_my_role();
  v_general_lot_code text := upper(trim(coalesce(p_payload->>'general_lot_code', '')));
  v_requested_cell text := trim(coalesce(p_payload->>'cell_name', ''));
  v_stage_code text;
  v_cell_id uuid;
  v_cell_name text;
  v_shift text := coalesce(nullif(trim(p_payload->>'shift'), ''), '1º Turno');
  v_operator text := coalesce(nullif(trim(p_payload->>'operator'), ''), 'Operador Manual');
  v_quantity integer;
  v_unit text := coalesce(nullif(trim(p_payload->>'unit_of_measure'), ''), 'pecas');
  v_notes text := nullif(trim(coalesce(p_payload->>'notes', '')), '');
  v_production_date date := coalesce(nullif(p_payload->>'date', '')::date, current_date);
  v_client_event_id text := coalesce(
    nullif(trim(p_payload->>'client_event_id'), ''),
    'manual-untraceable-' || gen_random_uuid()::text
  );
  v_batch_id uuid;
  v_lot_id uuid;
  v_entry_id uuid;
  v_record_id uuid;
  v_created_at timestamptz := (v_production_date::text || ' ' || to_char(now(), 'HH24:MI:SS'))::timestamptz;
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
    raise exception 'Informe o código do Lote Geral.';
  end if;

  begin
    v_quantity := (p_payload->>'quantity')::integer;
  exception when others then
    v_quantity := null;
  end;

  if v_quantity is null or v_quantity <= 0 then
    raise exception 'A quantidade produzida deve ser maior que zero.';
  end if;

  v_stage_code := public.resolve_production_stage_for_cell(null, v_requested_cell);
  if v_stage_code not in ('separation', 'packaging') then
    raise exception 'A baixa sem rastreabilidade está autorizada apenas para Separação e Embalagem.';
  end if;

  if not coalesce((
    select policy.manual_quantity_allowed
    from public.production_stage_policies policy
    where policy.stage_code = v_stage_code
  ), false) then
    raise exception 'A baixa quantitativa manual está desativada para esta etapa.';
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

  select batch.id
    into v_batch_id
  from public.promob_import_batches batch
  where upper(trim(coalesce(batch.general_lot_code, ''))) = v_general_lot_code
     or upper(trim(coalesce(batch.file_name, ''))) = v_general_lot_code
  order by batch.created_at desc
  limit 1;

  if v_batch_id is null and not exists (
    select 1
    from public.production_lots lot
    where upper(trim(coalesce(lot.general_lot_code, lot.lot_code, ''))) = v_general_lot_code
  ) then
    raise exception 'Lote Geral não encontrado. Confira o código antes de registrar a baixa.';
  end if;

  select lot.id
    into v_lot_id
  from public.production_lots lot
  where (v_batch_id is not null and lot.pcp_import_batch_id = v_batch_id)
     or upper(trim(coalesce(lot.general_lot_code, lot.lot_code, ''))) = v_general_lot_code
  order by lot.created_at desc
  limit 1;

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
      'stage_code', v_stage_code,
      'cell_name', v_cell_name,
      'quantity', v_quantity,
      'traceability_type', 'aggregate_untraceable'
    );
  end if;

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
    0,
    0,
    0,
    v_operator,
    coalesce(v_notes, 'Baixa quantitativa sem rastreabilidade individual'),
    v_user_id,
    v_created_at,
    v_lot_id,
    v_stage_code,
    v_general_lot_code,
    v_general_lot_code,
    v_stage_code,
    'manual',
    'manual_untraceable_stage',
    'valid',
    'limited',
    v_client_event_id,
    v_quantity,
    case when v_unit in ('pecas', 'pieces') then v_quantity else 0 end,
    v_batch_id,
    true,
    v_unit
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
    'baixa_sem_rastreabilidade',
    v_general_lot_code,
    v_cell_name,
    v_shift,
    v_operator,
    v_quantity,
    v_unit,
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
      'physical_traceability', false
    )
  )
  returning id into v_record_id;

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
    'unit_of_measure', v_unit,
    'production_date', v_production_date,
    'traceability_type', 'aggregate_untraceable',
    'individual_pieces_changed', false
  );
end;
$function$;

revoke all on function public.register_untraceable_stage_quantity(jsonb) from public, anon;
grant execute on function public.register_untraceable_stage_quantity(jsonb) to authenticated;

-- Progresso completo da rota para complementar o dashboard de previsão, que
-- continua calculando prazo apenas até a Separação.
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
pieces as (
  select piece.*
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
        or exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'cut')
      when 'edge' then coalesce(piece.requires_edge, false)
        or exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'edge')
      when 'drill' then exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'drill')
      when 'cnc' then coalesce(piece.requires_cnc, false)
        or exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'cnc')
      when 'joinery' then coalesce(piece.requires_joinery, false) or coalesce(piece.manual_joinery, false)
        or exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'joinery')
      when 'separation' then coalesce(piece.requires_separation, false)
        or exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'separation')
      when 'packaging' then coalesce(piece.requires_packaging, false)
        or exists (select 1 from unnest(coalesce(piece.route_steps, array[]::text[])) route_step where public.resolve_production_stage_for_cell(null, route_step) = 'packaging')
      else false
    end as is_required,
    exists (
      select 1
      from unnest(coalesce(piece.completed_steps, array[]::text[])) completed_step
      where public.resolve_production_stage_for_cell(null, completed_step) = stage.stage_code
    ) as is_completed
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

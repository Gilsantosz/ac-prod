-- Corrige a infraestrutura de impressao de etiquetas e auditoria de relatorios
-- de reposicao. A migracao anterior existia no repositorio, mas nao havia sido
-- aplicada ao banco de producao.

create table if not exists public.label_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  width_mm numeric(6,2) not null default 100.00,
  height_mm numeric(6,2) not null default 50.00,
  orientation text not null default 'landscape',
  margin_top_mm numeric(4,2) not null default 2.00,
  margin_right_mm numeric(4,2) not null default 2.00,
  margin_bottom_mm numeric(4,2) not null default 2.00,
  margin_left_mm numeric(4,2) not null default 2.00,
  layout_config jsonb not null default '{}'::jsonb,
  barcode_config jsonb not null default '{"symbology":"code128","height_mm":12,"dpi":203}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_label_templates_name
  on public.label_templates (name);

insert into public.label_templates
  (name, width_mm, height_mm, orientation, is_default, layout_config)
values
  ('Reposicao Promob 100 x 50 mm', 100, 50, 'landscape', true, '{"type":"promob_standard"}'::jsonb),
  ('Reposicao Promob 100 x 70 mm', 100, 70, 'landscape', false, '{"type":"promob_expanded"}'::jsonb),
  ('Reposicao Compacta 80 x 50 mm', 80, 50, 'landscape', false, '{"type":"compact_80x50"}'::jsonb),
  ('Reposicao Compacta 60 x 40 mm', 60, 40, 'landscape', false, '{"type":"compact_60x40"}'::jsonb),
  ('Folha A4 Multi-Etiquetas', 210, 297, 'portrait', false, '{"type":"a4_sheet","rows":5,"cols":2}'::jsonb)
on conflict (name) do update
set width_mm = excluded.width_mm,
    height_mm = excluded.height_mm,
    orientation = excluded.orientation,
    layout_config = excluded.layout_config,
    updated_at = now();

create table if not exists public.replacement_labels (
  id uuid primary key default gen_random_uuid(),
  replacement_request_id uuid not null references public.replacement_orders(id) on delete cascade,
  replacement_piece_id uuid references public.production_pieces(id) on delete set null,
  original_piece_id uuid references public.production_pieces(id) on delete set null,
  promob_original_code text,
  replacement_trace_code text not null,
  template_id uuid references public.label_templates(id) on delete set null,
  print_status text not null default 'pending',
  copies integer not null default 1 check (copies > 0),
  current_copy_number integer not null default 0 check (current_copy_number >= 0),
  last_printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_replacement_labels_request
  on public.replacement_labels (replacement_request_id);
create unique index if not exists uq_replacement_labels_trace_code
  on public.replacement_labels (replacement_trace_code);

create table if not exists public.replacement_label_prints (
  id uuid primary key default gen_random_uuid(),
  label_id uuid not null references public.replacement_labels(id) on delete cascade,
  replacement_request_id uuid not null references public.replacement_orders(id) on delete cascade,
  replacement_piece_id uuid references public.production_pieces(id) on delete set null,
  print_sequence integer not null default 1 check (print_sequence > 0),
  copy_number integer not null default 1 check (copy_number > 0),
  is_reprint boolean not null default false,
  reprint_reason text,
  reprint_reason_details text,
  printer_name text default 'Padrao do Sistema / Navegador',
  printed_by uuid,
  printed_by_name text,
  printed_at timestamptz not null default now(),
  device_information text,
  client_event_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_replacement_label_prints_request
  on public.replacement_label_prints (replacement_request_id, printed_at desc);
create index if not exists idx_replacement_label_prints_label
  on public.replacement_label_prints (label_id, printed_at desc);
create unique index if not exists uq_replacement_label_prints_client_event
  on public.replacement_label_prints (client_event_id)
  where client_event_id is not null;

create table if not exists public.replacement_report_exports (
  id uuid primary key default gen_random_uuid(),
  report_code text not null unique,
  report_type text not null default 'filtered',
  filters jsonb not null default '{}'::jsonb,
  replacement_ids uuid[] not null default '{}',
  file_path text,
  generated_by uuid,
  generated_by_name text,
  generated_at timestamptz not null default now(),
  checksum text,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create index if not exists idx_replacement_report_exports_date
  on public.replacement_report_exports (generated_at desc);

alter table public.label_templates enable row level security;
alter table public.replacement_labels enable row level security;
alter table public.replacement_label_prints enable row level security;
alter table public.replacement_report_exports enable row level security;

drop policy if exists "Permitir leitura de templates" on public.label_templates;
drop policy if exists "Permitir escrita de templates para autenticados" on public.label_templates;
drop policy if exists "Permitir acesso geral a replacement_labels" on public.replacement_labels;
drop policy if exists "Permitir acesso geral a replacement_label_prints" on public.replacement_label_prints;
drop policy if exists "Permitir acesso geral a replacement_report_exports" on public.replacement_report_exports;

drop policy if exists label_templates_read on public.label_templates;
create policy label_templates_read on public.label_templates
  for select to authenticated
  using (is_active and (select auth.uid()) is not null);

drop policy if exists label_templates_manage on public.label_templates;
create policy label_templates_manage on public.label_templates
  for all to authenticated
  using (
    public.get_my_role() in ('admin', 'manager')
    or (select public.has_permission('manage_quality'))
  )
  with check (
    public.get_my_role() in ('admin', 'manager')
    or (select public.has_permission('manage_quality'))
  );

drop policy if exists replacement_labels_read on public.replacement_labels;
create policy replacement_labels_read on public.replacement_labels
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists replacement_label_prints_read on public.replacement_label_prints;
create policy replacement_label_prints_read on public.replacement_label_prints
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists replacement_report_exports_read on public.replacement_report_exports;
create policy replacement_report_exports_read on public.replacement_report_exports
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists replacement_report_exports_insert on public.replacement_report_exports;
create policy replacement_report_exports_insert on public.replacement_report_exports
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (generated_by is null or generated_by = (select auth.uid()))
  );

revoke all on public.label_templates from public, anon;
revoke all on public.replacement_labels from public, anon;
revoke all on public.replacement_label_prints from public, anon;
revoke all on public.replacement_report_exports from public, anon;

grant select on public.label_templates to authenticated;
grant select on public.replacement_labels to authenticated;
grant select on public.replacement_label_prints to authenticated;
grant select, insert on public.replacement_report_exports to authenticated;
grant all on public.label_templates to service_role;
grant all on public.replacement_labels to service_role;
grant all on public.replacement_label_prints to service_role;
grant all on public.replacement_report_exports to service_role;

create or replace function public.register_replacement_label_print(
  p_replacement_request_id uuid,
  p_reprint_reason text default null,
  p_reprint_reason_details text default null,
  p_printer_name text default 'Impressora Padrao',
  p_user_name text default 'Operador MES',
  p_client_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_order public.replacement_orders%rowtype;
  v_orig_piece public.production_pieces%rowtype;
  v_repl_piece public.production_pieces%rowtype;
  v_label public.replacement_labels%rowtype;
  v_existing_print public.replacement_label_prints%rowtype;
  v_trace_code text;
  v_orig_code text;
  v_print_count integer;
  v_is_reprint boolean;
  v_print_id uuid;
  v_template_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sessao expirada. Entre novamente para imprimir a etiqueta.'
      using errcode = '42501';
  end if;

  select profile.name
    into v_user_name
  from public.profiles profile
  where profile.id = v_user_id
    and coalesce(profile.active, true)
  limit 1;

  if v_user_name is null then
    raise exception 'Usuario inativo ou sem perfil para registrar a impressao.'
      using errcode = '42501';
  end if;

  if p_client_event_id is not null then
    select *
      into v_existing_print
    from public.replacement_label_prints
    where client_event_id = p_client_event_id;

    if found then
      select * into v_label
      from public.replacement_labels
      where id = v_existing_print.label_id;

      return jsonb_build_object(
        'success', true,
        'idempotent', true,
        'print_id', v_existing_print.id,
        'label_id', v_existing_print.label_id,
        'copy_number', v_existing_print.copy_number,
        'is_reprint', v_existing_print.is_reprint,
        'via_label', case
          when v_existing_print.copy_number = 1 then '1a VIA'
          else v_existing_print.copy_number || 'a VIA'
        end,
        'replacement_trace_code', v_label.replacement_trace_code
      );
    end if;
  end if;

  select * into v_order
  from public.replacement_orders
  where id = p_replacement_request_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Ordem de reposicao nao encontrada.');
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('success', false, 'error', 'Etiqueta bloqueada. A ordem de reposicao foi cancelada.');
  end if;

  select * into v_orig_piece
  from public.production_pieces
  where id = v_order.original_piece_id;

  if v_order.replacement_piece_id is not null then
    select * into v_repl_piece
    from public.production_pieces
    where id = v_order.replacement_piece_id;
  end if;

  v_orig_code := coalesce(
    nullif(trim(v_orig_piece.piece_code), ''),
    nullif(trim(v_orig_piece.traceability_code), ''),
    nullif(trim(v_orig_piece.piece_uid), ''),
    '00000000'
  );

  v_trace_code := coalesce(
    nullif(trim(v_repl_piece.traceability_code), ''),
    nullif(trim(v_repl_piece.piece_uid), ''),
    v_orig_code || '-REP-R01'
  );

  select id into v_template_id
  from public.label_templates
  where is_default and is_active
  order by created_at
  limit 1;

  insert into public.replacement_labels (
    replacement_request_id,
    replacement_piece_id,
    original_piece_id,
    promob_original_code,
    replacement_trace_code,
    template_id,
    print_status,
    current_copy_number
  ) values (
    p_replacement_request_id,
    v_order.replacement_piece_id,
    v_order.original_piece_id,
    v_orig_code,
    v_trace_code,
    v_template_id,
    'pending',
    0
  )
  on conflict (replacement_request_id) do update
  set replacement_piece_id = excluded.replacement_piece_id,
      original_piece_id = excluded.original_piece_id,
      promob_original_code = excluded.promob_original_code,
      replacement_trace_code = excluded.replacement_trace_code,
      template_id = coalesce(public.replacement_labels.template_id, excluded.template_id),
      updated_at = now();

  select * into v_label
  from public.replacement_labels
  where replacement_request_id = p_replacement_request_id
  for update;

  v_print_count := coalesce(v_label.current_copy_number, 0) + 1;
  v_is_reprint := v_print_count > 1;

  if v_is_reprint and nullif(trim(p_reprint_reason), '') is null then
    return jsonb_build_object(
      'success', false,
      'error', 'Toda reimpressao (2a via em diante) exige motivo obrigatorio.'
    );
  end if;

  update public.replacement_labels
  set current_copy_number = v_print_count,
      print_status = 'printed',
      last_printed_at = now(),
      updated_at = now()
  where id = v_label.id;

  insert into public.replacement_label_prints (
    label_id,
    replacement_request_id,
    replacement_piece_id,
    print_sequence,
    copy_number,
    is_reprint,
    reprint_reason,
    reprint_reason_details,
    printer_name,
    printed_by,
    printed_by_name,
    printed_at,
    client_event_id
  ) values (
    v_label.id,
    p_replacement_request_id,
    v_order.replacement_piece_id,
    v_print_count,
    v_print_count,
    v_is_reprint,
    nullif(trim(p_reprint_reason), ''),
    nullif(trim(p_reprint_reason_details), ''),
    coalesce(nullif(trim(p_printer_name), ''), 'Impressora Padrao'),
    v_user_id,
    coalesce(v_user_name, nullif(trim(p_user_name), ''), 'Operador MES'),
    now(),
    p_client_event_id
  )
  returning id into v_print_id;

  return jsonb_build_object(
    'success', true,
    'print_id', v_print_id,
    'label_id', v_label.id,
    'copy_number', v_print_count,
    'is_reprint', v_is_reprint,
    'via_label', case when v_print_count = 1 then '1a VIA' else v_print_count || 'a VIA' end,
    'replacement_trace_code', v_trace_code
  );
end;
$$;

revoke all on function public.register_replacement_label_print(uuid, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.register_replacement_label_print(uuid, text, text, text, text, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

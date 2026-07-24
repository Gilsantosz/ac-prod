-- AC.Prod — Orquestração de IA, integrações resilientes e hardening aditivo.
-- Esta migração não altera as tabelas canônicas de peças/eventos nem os fluxos
-- de embalagem/expedição.

create table if not exists public.ai_capabilities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  actions text[] not null default '{}',
  routes text[] not null default '{}',
  required_permissions text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_action_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  capability_code text references public.ai_capabilities(code) on delete set null,
  action text not null,
  status text not null default 'completed'
    check (status in ('processing', 'completed', 'failed', 'denied')),
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.integration_inbox (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'dead_letter')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source_system, idempotency_key)
);

create table if not exists public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  destination_system text not null,
  event_type text not null,
  aggregate_type text,
  aggregate_id text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

insert into public.ai_capabilities
  (code, label, description, actions, routes, required_permissions, metadata)
values
  (
    'lot_tracking',
    'Rastreabilidade hierárquica de lotes',
    'Distingue lote geral PCP de lote do cliente, consulta andamento e abre a tela já selecionada.',
    array['search_production', 'navigate'],
    array['/integridade-lote', '/acompanhamento-lotes', '/rastreabilidade'],
    array['view_traceability', 'view_reports', 'ai_operations'],
    '{"entities":["promob_import_batches","production_lots","production_pieces","production_collection_events"],"version":1}'::jsonb
  ),
  (
    'production_reports',
    'Relatórios produtivos e OEE',
    'Gera fechamento produtivo, OEE, integridade, andamento e previsão até a separação.',
    array['generate_report'],
    array['/relatorios', '/ia-operacional', '/acompanhamento-lotes'],
    array['view_reports', 'ai_operations'],
    '{"report_types":["production_summary","daily_production","shift_closure","oee","lot_traceability","lot_forecast"],"version":1}'::jsonb
  ),
  (
    'email_reports',
    'Envio e agendamento de relatórios',
    'Envia somente para gestores/usuários cadastrados, com auditoria e idempotência.',
    array['send_report_email', 'schedule_report_email', 'list_schedules', 'show_email_logs'],
    array['/usuarios', '/ia-operacional'],
    array['manage_automations', 'ai_operations'],
    '{"recipient_source":"profiles","idempotent":true,"version":1}'::jsonb
  )
on conflict (code) do update
set
  label = excluded.label,
  description = excluded.description,
  actions = excluded.actions,
  routes = excluded.routes,
  required_permissions = excluded.required_permissions,
  metadata = excluded.metadata,
  active = true,
  updated_at = now();

alter table public.ai_capabilities enable row level security;
alter table public.ai_action_runs enable row level security;
alter table public.integration_inbox enable row level security;
alter table public.integration_outbox enable row level security;

-- Alguns ambientes antigos receberam as tabelas de IA sem a função auxiliar.
-- Recriá-la aqui torna esta migração autocontida e preserva as regras existentes.
create or replace function public.has_ai_permission(permission_name text default 'ai_operations')
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active is distinct from false
      and (
        role in ('admin', 'manager')
        or coalesce((permissions ->> permission_name)::boolean, false)
        or (
          permission_name = 'ai_operations'
          and coalesce((permissions ->> 'view_reports')::boolean, false)
        )
      )
  );
$$;

revoke all on function public.has_ai_permission(text) from public, anon;
grant execute on function public.has_ai_permission(text) to authenticated;

drop policy if exists ai_capabilities_authorized_read on public.ai_capabilities;
create policy ai_capabilities_authorized_read
on public.ai_capabilities
for select
to authenticated
using (active and public.has_ai_permission());

drop policy if exists ai_action_runs_authorized_read on public.ai_action_runs;
create policy ai_action_runs_authorized_read
on public.ai_action_runs
for select
to authenticated
using (
  user_id = auth.uid()
  or public.get_my_role() = any (array['admin'::text, 'manager'::text])
);

drop policy if exists ai_action_runs_own_insert on public.ai_action_runs;
create policy ai_action_runs_own_insert
on public.ai_action_runs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.has_ai_permission()
);

revoke all on public.ai_capabilities from anon, authenticated;
revoke all on public.ai_action_runs from anon, authenticated;
revoke all on public.integration_inbox from anon, authenticated;
revoke all on public.integration_outbox from anon, authenticated;
grant select on public.ai_capabilities to authenticated;
grant select, insert on public.ai_action_runs to authenticated;
grant all on public.integration_inbox to service_role;
grant all on public.integration_outbox to service_role;

create or replace function public.get_ai_capability_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_permissions jsonb := '{}'::jsonb;
  v_capabilities jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.role, coalesce(p.permissions, '{}'::jsonb)
  into v_role, v_permissions
  from public.profiles p
  where p.id = auth.uid()
    and p.active is distinct from false;

  if v_role is null then
    raise exception 'ACCESS_DENIED';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', c.code,
        'label', c.label,
        'description', c.description,
        'actions', c.actions,
        'routes', c.routes,
        'metadata', c.metadata
      )
      order by c.code
    ),
    '[]'::jsonb
  )
  into v_capabilities
  from public.ai_capabilities c
  where c.active
    and (
      v_role in ('admin', 'manager')
      or cardinality(c.required_permissions) = 0
      or exists (
        select 1
        from unnest(c.required_permissions) permission_name
        where lower(coalesce(v_permissions ->> permission_name, 'false')) in ('true', '1')
      )
    );

  return jsonb_build_object(
    'generatedAt', now(),
    'role', v_role,
    'capabilities', v_capabilities
  );
end;
$$;

revoke all on function public.get_ai_capability_context() from public, anon;
grant execute on function public.get_ai_capability_context() to authenticated;

create index if not exists idx_ai_action_runs_user_created
  on public.ai_action_runs (user_id, created_at desc);
create index if not exists idx_ai_action_runs_capability_created
  on public.ai_action_runs (capability_code, created_at desc);
create index if not exists idx_integration_inbox_due
  on public.integration_inbox (status, next_attempt_at, received_at)
  where status in ('received', 'failed');
create index if not exists idx_integration_outbox_due
  on public.integration_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');
create index if not exists idx_production_entries_lot_date
  on public.production_entries (lot_code, date desc);
create index if not exists idx_production_lots_batch_code
  on public.production_lots (pcp_import_batch_id, lot_code);
create index if not exists idx_collection_events_batch_created
  on public.production_collection_events (pcp_import_batch_id, created_at desc);
create index if not exists idx_report_email_logs_sender_created
  on public.report_email_logs (sent_by, created_at desc);

alter default privileges in schema public revoke all on tables from public, anon;
alter default privileges in schema public revoke all on sequences from public, anon;
alter default privileges in schema public revoke all on functions from public, anon;

-- Corrige apenas funções próprias sem search_path explícito; funções de
-- extensões são ignoradas para não comprometer upgrades gerenciados.
do $$
declare
  function_record record;
begin
  for function_record in
    select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) config
        where config like 'search_path=%'
      )
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = pg_catalog, public, extensions',
      function_record.nspname,
      function_record.proname,
      function_record.args
    );
  end loop;
end;
$$;

comment on table public.ai_capabilities is
  'Catálogo declarativo usado pelo Copilot para descobrir funções implantadas sem expor operações arbitrárias.';
comment on table public.ai_action_runs is
  'Auditoria imutável das ações operacionais executadas pelo motor de IA.';
comment on table public.integration_inbox is
  'Inbox idempotente para receber eventos de outros sistemas sem duplicidade.';
comment on table public.integration_outbox is
  'Outbox transacional para publicar integrações com retentativa e consistência.';

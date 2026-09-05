-- Administração > Configurações: screen inactivity policy shared by all devices.
-- Sectors below group cells ONLY for session policy; they are not a production
-- data partition and do not change existing collection or authorization rules.
begin;

create table public.system_settings (
  id text primary key default 'session' check (id = 'session'),
  default_timeout_minutes integer not null default 30
    check (default_timeout_minutes between 1 and 1440),
  warning_seconds integer not null default 60 check (warning_seconds between 0 and 300),
  role_timeouts jsonb not null default '{}'::jsonb check (jsonb_typeof(role_timeouts) = 'object'),
  cell_timeouts jsonb not null default '{}'::jsonb check (jsonb_typeof(cell_timeouts) = 'object'),
  sectors jsonb not null default '[]'::jsonb check (jsonb_typeof(sectors) = 'array'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table public.system_settings_audit (
  id bigint generated always as identity primary key,
  settings_id text not null references public.system_settings(id),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null,
  previous_settings jsonb not null,
  next_settings jsonb not null
);

alter table public.system_settings enable row level security;
alter table public.system_settings_audit enable row level security;
revoke all on table public.system_settings, public.system_settings_audit from public, anon, authenticated, service_role;
revoke all on sequence public.system_settings_audit_id_seq from public, anon, authenticated, service_role;
grant select on table public.system_settings, public.system_settings_audit to authenticated;

create policy system_settings_active_profile_read on public.system_settings
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active is true)
);

create policy system_settings_audit_admin_read on public.system_settings_audit
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active is true and p.role = 'admin')
);

insert into public.system_settings (id) values ('session');

comment on table public.system_settings is
  'Screen inactivity policy. Active profiles read; only save_system_settings can write from a client. Sector groups apply solely to session timeout.';
comment on table public.system_settings_audit is
  'Administrative session policy revisions. Client writes forbidden; only active administrators may read.';

-- A definer is required for the single controlled write path: callers have
-- SELECT only. Authorization always reads the current profile, never JWT
-- user_metadata. Fully qualified relations and an empty path prevent hijacks.
create function public.save_system_settings(p_settings jsonb, p_expected_version bigint)
returns public.system_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.system_settings%rowtype;
  v_after public.system_settings%rowtype;
  v_key text;
  v_value jsonb;
  v_number numeric;
  v_sector jsonb;
  v_cell jsonb;
  v_cell_id uuid;
  v_sector_id uuid;
  v_sector_ids uuid[] := '{}'::uuid[];
  v_sector_cells uuid[] := '{}'::uuid[];
  v_cells jsonb;
  v_sectors jsonb := '[]'::jsonb;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Lock the actor against concurrent deactivation/demotion until commit.
  perform 1 from public.profiles p
  where p.id = v_actor and p.active is true and p.role = 'admin'
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Somente administradores ativos podem alterar as configurações.';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'Informe a versão das configurações carregadas.';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'As configurações devem ser um objeto JSON.';
  end if;
  if octet_length(p_settings::text) > 262144 then
    raise exception using errcode = '22023', message = 'As configurações ultrapassam o tamanho permitido.';
  end if;
  if not (p_settings ?& array['default_timeout_minutes', 'warning_seconds', 'role_timeouts', 'cell_timeouts', 'sectors'])
    or exists (select 1 from jsonb_object_keys(p_settings) as k(key)
      where k.key <> all(array['default_timeout_minutes', 'warning_seconds', 'role_timeouts', 'cell_timeouts', 'sectors'])) then
    raise exception using errcode = '22023', message = 'Envie todos e somente os campos de configuração permitidos.';
  end if;

  foreach v_key in array array['default_timeout_minutes', 'warning_seconds'] loop
    v_value := p_settings -> v_key;
    if jsonb_typeof(v_value) is distinct from 'number' then
      raise exception using errcode = '22023', message = 'Os tempos devem ser números inteiros.';
    end if;
    v_number := v_value::text::numeric;
    if v_number <> trunc(v_number)
      or (v_key = 'default_timeout_minutes' and v_number not between 1 and 1440)
      or (v_key = 'warning_seconds' and v_number not between 0 and 300) then
      raise exception using errcode = '22023', message = 'Tempo inválido: sessão de 1 a 1440 minutos e aviso de 0 a 300 segundos.';
    end if;
  end loop;

  if jsonb_typeof(p_settings -> 'role_timeouts') is distinct from 'object'
    or jsonb_typeof(p_settings -> 'cell_timeouts') is distinct from 'object'
    or jsonb_typeof(p_settings -> 'sectors') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Níveis e células devem ser objetos; setores devem ser uma lista.';
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_settings -> 'role_timeouts') loop
    if v_key <> all(array['operator', 'viewer', 'supervisor', 'quality_manager', 'manager', 'admin']) then
      raise exception using errcode = '22023', message = 'Nível de acesso inválido nas configurações.';
    end if;
    if jsonb_typeof(v_value) is distinct from 'number' then
      raise exception using errcode = '22023', message = 'O tempo por nível deve ser um número inteiro.';
    end if;
    v_number := v_value::text::numeric;
    if v_number <> trunc(v_number) or v_number not between 1 and 1440 then
      raise exception using errcode = '22023', message = 'O tempo por nível deve estar entre 1 e 1440 minutos.';
    end if;
  end loop;

  for v_key, v_value in select key, value from jsonb_each(p_settings -> 'cell_timeouts') loop
    if v_key !~ v_uuid_pattern then
      raise exception using errcode = '22023', message = 'A célula deve ser identificada pelo UUID canônico do cadastro.';
    end if;
    -- A key-share lock also prevents the catalog entry disappearing mid-save.
    perform 1 from public.cells c where c.id = v_key::uuid for key share;
    if not found then
      raise exception using errcode = '22023', message = 'Célula não encontrada no cadastro.';
    end if;
    if jsonb_typeof(v_value) is distinct from 'number' then
      raise exception using errcode = '22023', message = 'O tempo por célula deve ser um número inteiro.';
    end if;
    v_number := v_value::text::numeric;
    if v_number <> trunc(v_number) or v_number not between 1 and 1440 then
      raise exception using errcode = '22023', message = 'O tempo por célula deve estar entre 1 e 1440 minutos.';
    end if;
  end loop;

  for v_sector in select value from jsonb_array_elements(p_settings -> 'sectors') loop
    if jsonb_typeof(v_sector) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Setor inválido.';
    end if;
    if not (v_sector ?& array['id', 'name', 'cell_ids', 'timeout_minutes'])
      or exists (select 1 from jsonb_object_keys(v_sector) as k(key)
        where k.key <> all(array['id', 'name', 'cell_ids', 'timeout_minutes'])) then
      raise exception using errcode = '22023', message = 'Campos do setor inválidos.';
    end if;
    if jsonb_typeof(v_sector -> 'id') is distinct from 'string'
      or (v_sector ->> 'id') !~ v_uuid_pattern then
      raise exception using errcode = '22023', message = 'O setor deve possuir um UUID canônico válido.';
    end if;
    v_sector_id := (v_sector ->> 'id')::uuid;
    if v_sector_id = any(v_sector_ids) then
      raise exception using errcode = '22023', message = 'Um setor não pode aparecer duas vezes.';
    end if;
    v_sector_ids := array_append(v_sector_ids, v_sector_id);
    if jsonb_typeof(v_sector -> 'name') is distinct from 'string'
      or char_length(btrim(v_sector ->> 'name')) not between 1 and 80 then
      raise exception using errcode = '22023', message = 'O nome do setor deve conter de 1 a 80 caracteres.';
    end if;
    if jsonb_typeof(v_sector -> 'cell_ids') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'As células do setor devem ser uma lista.';
    end if;
    v_cells := '[]'::jsonb;
    for v_cell in select value from jsonb_array_elements(v_sector -> 'cell_ids') loop
      if jsonb_typeof(v_cell) is distinct from 'string' or (v_cell #>> '{}') !~ v_uuid_pattern then
        raise exception using errcode = '22023', message = 'Célula inválida no setor.';
      end if;
      v_cell_id := (v_cell #>> '{}')::uuid;
      if v_cell_id = any(v_sector_cells) then
        raise exception using errcode = '22023', message = 'Cada célula pode pertencer a somente um setor e não pode ser repetida.';
      end if;
      perform 1 from public.cells c where c.id = v_cell_id for key share;
      if not found then
        raise exception using errcode = '22023', message = 'Célula do setor não encontrada no cadastro.';
      end if;
      v_sector_cells := array_append(v_sector_cells, v_cell_id);
      v_cells := v_cells || jsonb_build_array(v_cell_id::text);
    end loop;
    v_value := v_sector -> 'timeout_minutes';
    if jsonb_typeof(v_value) is distinct from 'null' then
      if jsonb_typeof(v_value) is distinct from 'number' then
        raise exception using errcode = '22023', message = 'O tempo do setor deve ser um número inteiro ou nulo para herdar o padrão.';
      end if;
      v_number := v_value::text::numeric;
      if v_number <> trunc(v_number) or v_number not between 1 and 1440 then
        raise exception using errcode = '22023', message = 'O tempo do setor deve estar entre 1 e 1440 minutos.';
      end if;
    end if;
    v_sectors := v_sectors || jsonb_build_array(jsonb_build_object(
      'id', v_sector_id::text, 'name', btrim(v_sector ->> 'name'),
      'cell_ids', v_cells, 'timeout_minutes', v_value
    ));
  end loop;

  select * into strict v_before from public.system_settings where id = 'session' for update;
  if v_before.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'As configurações foram alteradas por outro administrador. Recarregue antes de salvar.';
  end if;

  update public.system_settings set
    default_timeout_minutes = (p_settings ->> 'default_timeout_minutes')::numeric::integer,
    warning_seconds = (p_settings ->> 'warning_seconds')::numeric::integer,
    role_timeouts = p_settings -> 'role_timeouts',
    cell_timeouts = p_settings -> 'cell_timeouts',
    sectors = v_sectors,
    version = v_before.version + 1,
    updated_at = clock_timestamp(), updated_by = v_actor
  where id = 'session'
  returning * into v_after;

  insert into public.system_settings_audit (settings_id, changed_by, previous_settings, next_settings)
  values ('session', v_actor, to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end;
$$;

revoke all on function public.save_system_settings(jsonb, bigint) from public, anon, authenticated, service_role;
grant execute on function public.save_system_settings(jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Minimal dependency fixture for an EMPTY, DISPOSABLE local PostgreSQL cluster.
-- Do not apply to a Supabase project. Used by scripts/test_system_settings_db.mjs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- Model legacy Supabase defaults so revokes are exercised, not merely absent
-- grants in a clean vanilla PostgreSQL cluster.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.profiles (id uuid primary key, role text not null, active boolean);
create table public.cells (id uuid primary key, name text not null, active boolean);
alter table public.profiles enable row level security;
alter table public.cells enable row level security;
grant select on public.profiles, public.cells to authenticated;
create policy fixture_profiles_read on public.profiles for select to authenticated using (id = auth.uid());
create policy fixture_cells_read on public.cells for select to authenticated using (true);
insert into public.profiles values
  ('10000000-0000-0000-0000-000000000001', 'admin', true),
  ('10000000-0000-0000-0000-000000000002', 'operator', true),
  ('10000000-0000-0000-0000-000000000003', 'manager', true),
  ('10000000-0000-0000-0000-000000000004', 'admin', false),
  ('10000000-0000-0000-0000-000000000005', 'admin', true);
insert into public.cells values
  ('20000000-0000-0000-0000-000000000001', 'Corte', true),
  ('20000000-0000-0000-0000-000000000002', 'Borda', true);

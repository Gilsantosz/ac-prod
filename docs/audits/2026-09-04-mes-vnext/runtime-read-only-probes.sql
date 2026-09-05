-- AC-Prod2 MES vNext — probes read-only da Fase Zero
-- Data: 2026-09-04
--
-- Este arquivo contém apenas SELECT/EXPLAIN. Ele não deve ser executado junto a
-- migrations e não substitui a revisão de escopo do ambiente. Não adicione
-- valores de Vault, payloads, JWTs, e-mails, matrículas, IPs ou identificadores
-- de pessoas ao resultado versionado.

-- Identidade do snapshot.
select
  clock_timestamp() as captured_at,
  current_database() as database_name,
  current_setting('server_version') as server_version,
  current_setting('max_connections') as max_connections,
  current_setting('superuser_reserved_connections') as superuser_reserved_connections;

-- Atividade agregada e conexões; application_name é texto controlável pelo
-- cliente, portanto só uma classe allowlisted é emitida.
select
  case
    when coalesce(application_name, '') = '' then '<unset>'
    when lower(application_name) like '%postgrest%' then 'postgrest'
    when lower(application_name) like '%gotrue%'
      or lower(application_name) like '%auth%' then 'auth'
    when lower(application_name) like '%realtime%' then 'realtime'
    when lower(application_name) like '%supavisor%' then 'supavisor'
    when lower(application_name) like '%pg_cron%' then 'pg_cron'
    else '<other>'
  end as application_class,
  state,
  count(*) as connections,
  count(*) filter (where state = 'idle in transaction') as idle_in_transaction
from pg_catalog.pg_stat_activity
where datname = current_database()
group by 1, 2
order by 1, 2;

-- Contadores cumulativos. Um teste deve guardar before/after e calcular deltas.
select
  stats_reset,
  xact_commit,
  xact_rollback,
  deadlocks,
  temp_files,
  temp_bytes,
  sessions,
  sessions_abandoned,
  sessions_fatal,
  sessions_killed
from pg_catalog.pg_stat_database
where datname = current_database();

-- pg_stat_statements é cumulativo; classificar apenas operações conhecidas e
-- jamais exportar query text/parâmetros.
select stats_reset as pg_stat_statements_reset
from extensions.pg_stat_statements_info;

select
  case
    when query ilike '%process_collection_inbox_item%' then 'collection_inbox_item'
    when query ilike '%process_production_reading%' then 'production_reading'
    when query ilike '%ingest_collection_batch_v3%' then 'v3_ingress'
    when query ilike '%process_collection_batch_v3%' then 'v3_decision'
    when query ilike '%claim_collection_batch_v3%' then 'v3_decision_claim'
    when query ilike '%process_collection_projection_batch_v3%' then 'v3_projection'
    when query ilike '%claim_collection_projection_batch_v3%' then 'v3_projection_claim'
    when query ilike '%get_collection_dashboard_snapshot%' then 'dashboard_snapshot'
  end as workload_class,
  sum(calls) as calls,
  min(min_exec_time) as min_exec_ms,
  sum(total_exec_time) / nullif(sum(calls), 0) as weighted_mean_exec_ms,
  max(max_exec_time) as max_exec_ms,
  sum(rows) as rows
from extensions.pg_stat_statements
where query ilike any (array[
  '%process_collection_inbox_item%',
  '%process_production_reading%',
  '%ingest_collection_batch_v3%',
  '%process_collection_batch_v3%',
  '%claim_collection_batch_v3%',
  '%process_collection_projection_batch_v3%',
  '%claim_collection_projection_batch_v3%',
  '%get_collection_dashboard_snapshot%'
])
group by 1
order by 1;

-- Esperas de lock agregadas, sem query text ou PID.
select
  locktype,
  mode,
  granted,
  count(*) as lock_count
from pg_catalog.pg_locks
group by locktype, mode, granted
order by locktype, mode, granted;

-- Relações da aplicação: serializer canônico v1 do manifesto por objeto.
-- Cada definição potencialmente sensível é incorporada somente ao SHA-256; o
-- texto literal não é emitido. Delimitadores: chr(31) entre campos e chr(30)
-- entre itens, com ordenação explícita em cada categoria.
with app_relations as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity, c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
)
select
  r.nspname as schema_name,
  r.relname,
  r.relkind,
  pg_catalog.pg_get_userbyid(r.relowner) as owner,
  r.relrowsecurity,
  r.relforcerowsecurity,
  encode(extensions.digest(coalesce(r.relacl::text, ''), 'sha256'), 'hex') as acl_sha256,
  coalesce(cols.item_count, 0) as column_count,
  encode(extensions.digest(coalesce(cols.serialized, ''), 'sha256'), 'hex') as columns_sha256,
  coalesce(cons.item_count, 0) as constraint_count,
  encode(extensions.digest(coalesce(cons.serialized, ''), 'sha256'), 'hex') as constraints_sha256,
  coalesce(idxs.item_count, 0) as index_count,
  encode(extensions.digest(coalesce(idxs.serialized, ''), 'sha256'), 'hex') as indexes_sha256,
  coalesce(trgs.item_count, 0) as trigger_count,
  encode(extensions.digest(coalesce(trgs.serialized, ''), 'sha256'), 'hex') as triggers_sha256,
  coalesce(pols.item_count, 0) as policy_count,
  encode(extensions.digest(coalesce(pols.serialized, ''), 'sha256'), 'hex') as policies_sha256,
  case when r.relkind in ('v', 'm')
    then encode(extensions.digest(pg_catalog.pg_get_viewdef(r.oid, true), 'sha256'), 'hex')
    else null
  end as view_sha256
from app_relations r
left join lateral (
  select count(*) as item_count,
         string_agg(
           concat_ws(chr(31),
             a.attnum::text,
             a.attname,
             pg_catalog.format_type(a.atttypid, a.atttypmod),
             a.attnotnull::text,
             a.attidentity::text,
             a.attgenerated::text,
             coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid, true), '<null>')
           ),
           chr(30) order by a.attnum
         ) as serialized
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
) cols on true
left join lateral (
  select count(*) as item_count,
         string_agg(
           concat_ws(chr(31), con.conname, con.contype::text,
                     con.convalidated::text,
                     pg_catalog.pg_get_constraintdef(con.oid, true)),
           chr(30) order by con.conname, con.oid
         ) as serialized
  from pg_catalog.pg_constraint con
  where con.conrelid = r.oid
) cons on true
left join lateral (
  select count(*) as item_count,
         string_agg(
           concat_ws(chr(31), ci.relname, i.indisunique::text,
                     i.indisvalid::text, i.indisready::text,
                     pg_catalog.pg_get_indexdef(i.indexrelid)),
           chr(30) order by ci.relname, i.indexrelid
         ) as serialized
  from pg_catalog.pg_index i
  join pg_catalog.pg_class ci on ci.oid = i.indexrelid
  where i.indrelid = r.oid
) idxs on true
left join lateral (
  select count(*) as item_count,
         string_agg(
           concat_ws(chr(31), t.tgname, t.tgenabled::text,
                     pg_catalog.pg_get_triggerdef(t.oid, true)),
           chr(30) order by t.tgname, t.oid
         ) as serialized
  from pg_catalog.pg_trigger t
  where t.tgrelid = r.oid and not t.tgisinternal
) trgs on true
left join lateral (
  select count(*) as item_count,
         string_agg(
           concat_ws(chr(31), p.polname, p.polpermissive::text, p.polcmd::text,
                     p.polroles::text,
                     coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid, true), '<null>'),
                     coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true), '<null>')),
           chr(30) order by p.polname, p.oid
         ) as serialized
  from pg_catalog.pg_policy p
  where p.polrelid = r.oid
) pols on true
order by r.nspname, r.relname;

-- Colunas e defaults. A definição literal fica fora do output padrão porque
-- configurações futuras podem conter valores sensíveis; uma captura literal
-- exige revisão antes de ser versionada.
select
  n.nspname as schema_name,
  c.relname,
  a.attnum,
  a.attname,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
  a.attnotnull,
  d.oid is not null as has_default,
  case when d.oid is null then null else
    encode(extensions.digest(pg_catalog.pg_get_expr(d.adbin, d.adrelid), 'sha256'), 'hex')
  end as default_sha256,
  a.attidentity,
  a.attgenerated
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attrdef d
  on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname in ('public', 'private')
  and c.relkind in ('r', 'p', 'v', 'm')
  and a.attnum > 0
  and not a.attisdropped
order by n.nspname, c.relname, a.attnum;

-- Constraints, inclusive FKs e validação. O hash permite detectar drift; a
-- definição literal é exportada somente para objetos selecionados e depois de
-- screening.
select
  n.nspname as schema_name,
  c.relname,
  con.conname,
  con.contype,
  con.convalidated,
  encode(extensions.digest(pg_catalog.pg_get_constraintdef(con.oid, true), 'sha256'), 'hex') as definition_sha256
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private')
order by n.nspname, c.relname, con.conname;

-- Índices e validade.
select
  n.nspname as schema_name,
  t.relname as table_name,
  i.relname as index_name,
  x.indisunique,
  x.indisvalid,
  x.indisready,
  encode(extensions.digest(pg_catalog.pg_get_indexdef(i.oid), 'sha256'), 'hex') as definition_sha256
from pg_catalog.pg_index x
join pg_catalog.pg_class i on i.oid = x.indexrelid
join pg_catalog.pg_class t on t.oid = x.indrelid
join pg_catalog.pg_namespace n on n.oid = t.relnamespace
where n.nspname in ('public', 'private')
order by n.nspname, t.relname, i.relname;

-- Triggers: metadata e hash da definição.
select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname,
  t.tgenabled,
  encode(extensions.digest(pg_catalog.pg_get_triggerdef(t.oid, true), 'sha256'), 'hex') as definition_sha256
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private')
  and not t.tgisinternal
order by n.nspname, c.relname, t.tgname;

-- Rotinas: serializer canônico v1 do manifesto por overload. ACL, proconfig e
-- definição entram apenas como SHA-256; nenhum corpo é emitido.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prokind,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proparallel as parallel_safety,
  l.lanname as language,
  encode(extensions.digest(coalesce(p.proacl::text, ''), 'sha256'), 'hex') as acl_sha256,
  encode(extensions.digest(coalesce(p.proconfig::text, ''), 'sha256'), 'hex') as proconfig_sha256,
  encode(extensions.digest(pg_catalog.pg_get_functiondef(p.oid), 'sha256'), 'hex') as definition_sha256
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
where n.nspname in ('public', 'private')
  and p.prokind in ('f', 'p')
order by n.nspname, p.proname,
         pg_catalog.pg_get_function_identity_arguments(p.oid);

-- Views: checksum apenas; definição literal requer screening antes de exportar.
select
  n.nspname as schema_name,
  c.relname as view_name,
  encode(extensions.digest(pg_catalog.pg_get_viewdef(c.oid, true), 'sha256'), 'hex') as definition_sha256
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private')
  and c.relkind in ('v', 'm')
order by n.nspname, c.relname;

-- RLS policies: metadata e hash da expressão, sem emitir literais por padrão.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  encode(extensions.digest(concat_ws('|', coalesce(qual, ''), coalesce(with_check, '')), 'sha256'), 'hex') as expression_sha256
from pg_catalog.pg_policies
where schemaname in ('public', 'private', 'realtime')
order by schemaname, tablename, policyname;

-- Grants efetivos de tabelas e rotinas.
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema in ('public', 'private', 'realtime', 'pgmq')
order by table_schema, table_name, grantee, privilege_type;

select
  routine_schema,
  routine_name,
  specific_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_routine_grants
where routine_schema in ('public', 'private', 'pgmq')
order by routine_schema, routine_name, specific_name, grantee;

select
  coalesce(n.nspname, '<global>') as schema_name,
  pg_catalog.pg_get_userbyid(d.defaclrole) as owner,
  d.defaclobjtype,
  d.defaclacl
from pg_catalog.pg_default_acl d
left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
where d.defaclnamespace = 0
   or n.nspname in ('public', 'private', 'realtime', 'pgmq')
order by schema_name, owner, d.defaclobjtype;

-- Publicações e memberships.
select pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate
from pg_catalog.pg_publication
order by pubname;

select pubname, schemaname, tablename
from pg_catalog.pg_publication_tables
order by pubname, schemaname, tablename;

-- Extensões efetivamente instaladas.
select extname, extversion, n.nspname as schema_name
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
order by extname;

-- Migrations e releases: só metadados/hashes, sem repetir statements no output.
select
  count(*) as migration_count,
  min(version) as first_version,
  max(version) as last_version,
  md5(string_agg(concat_ws('|', version, name), E'\n' order by version)) as manifest_md5,
  md5(string_agg(concat_ws('|', version, name, statements::text), E'\n' order by version)) as content_md5
from supabase_migrations.schema_migrations;

select
  count(*) as release_count,
  count(*) filter (where ready) as ready_count,
  count(*) filter (where not ready) as not_ready_count
from public.app_schema_releases;

-- Flags: não emitir rollout_scope, que pode conter texto operacional.
select flag_name, enabled, updated_at,
  md5(coalesce(rollout_scope::text, '')) as rollout_scope_md5
from private.collection_pipeline_flags
order by flag_name;

-- PGMQ: metadados agregados. Confirmar assinaturas na versão instalada.
select
  queue_name,
  queue_length,
  queue_visible_length,
  newest_msg_age_sec,
  oldest_msg_age_sec,
  total_messages,
  scrape_time
from pgmq.metrics_all()
order by queue_name;

select 'collection_live_v3' as queue_name, count(*) as archived_count
from pgmq.a_collection_live_v3
union all
select 'collection_replay_v3', count(*) from pgmq.a_collection_replay_v3
union all
select 'collection_projection_v3', count(*) from pgmq.a_collection_projection_v3
union all
select 'collection_dead_letter_v3', count(*) from pgmq.a_collection_dead_letter_v3
order by queue_name;

-- Reconciliação agregada. Não exporta IDs nem payloads.
select
  pipeline_version,
  status_sincronizacao,
  count(*) as receipts,
  count(*) filter (where attempt_count > 0) as with_retry,
  max(attempt_count) as max_attempt_count
from public.coletas_producao
group by pipeline_version, status_sincronizacao
order by pipeline_version, status_sincronizacao;

select
  c.pipeline_version,
  count(*) as synced_receipts,
  count(*) filter (where e.id is null) as without_event,
  count(*) filter (where r.id is null) as without_reading_by_client_event,
  count(*) filter (where e.id is null and r.id is null) as without_both
from public.coletas_producao c
left join public.production_collection_events e
  on e.client_event_id = c.client_event_id
left join public.production_stage_readings r
  on r.client_event_id = c.client_event_id
where c.status_sincronizacao = 'sincronizada'
group by c.pipeline_version
order by c.pipeline_version;

select
  coalesce(c.resultado ->> 'status', '<null>') as result_status,
  coalesce(c.resultado ->> 'decision', '<null>') as decision,
  count(*) as receipts,
  count(*) filter (
    where nullif(c.resultado ->> 'reading_id', '') is not null
      and not exists (
        select 1
        from public.production_stage_readings r
        where r.id::text = c.resultado ->> 'reading_id'
      )
  ) as referenced_reading_missing
from public.coletas_producao c
where c.pipeline_version = 3
group by 1, 2
order by 1, 2;

select count(*) as double_approval_groups
from (
  select
    piece_id,
    lower(pg_catalog.btrim(step_name)) as normalized_step_code,
    production_cycle
  from public.production_stage_readings
  where status = 'approved'
  group by piece_id, lower(pg_catalog.btrim(step_name)), production_cycle
  having count(*) > 1
) duplicates;

with event_pipelines as (
  select client_event_id, pipeline_version from public.coletas_producao
  where client_event_id is not null
  union all
  select client_event_id, pipeline_version from public.production_collection_events
  where client_event_id is not null
  union all
  select client_event_id, pipeline_version from public.production_stage_readings
  where client_event_id is not null
)
select count(*) as client_events_crossing_pipelines
from (
  select client_event_id
  from event_pipelines
  group by client_event_id
  having count(distinct pipeline_version) > 1
) conflicts;

select count(*) as approved_events_without_approved_ledger
from public.production_collection_events e
where e.result_status = 'approved'
  and not exists (
    select 1
    from public.production_stage_readings r
    where r.client_event_id = e.client_event_id
      and r.status = 'approved'
  );

select count(*) as orphan_outbox
from public.collection_projection_outbox o
where not exists (
  select 1 from public.coletas_producao c
  where c.client_event_id = o.client_event_id
)
or (
  o.reading_id is not null
  and not exists (
    select 1 from public.production_stage_readings r where r.id = o.reading_id
  )
);

select count(*) as duplicate_projection_groups
from (
  select
    o.client_event_id,
    o.projection_revision,
    a.projection_type
  from public.collection_projection_applied a
  join public.collection_projection_outbox o on o.id = a.outbox_id
  group by o.client_event_id, o.projection_revision, a.projection_type
  having count(*) > 1
) duplicates;

select count(*) as capacity_test_run_count
from public.capacity_test_runs;

-- Cron: não emitir nem hashear command; ele pode conter credencial ou funcionar
-- como oracle para segredo de baixa entropia.
select
  jobid,
  jobname,
  schedule,
  active
from cron.job
order by jobid;

-- Vault: somente nomes; jamais selecionar decrypted_secret/secret/ciphertext.
select name
from vault.secrets
order by name;

-- Estatística/tamanho das relações focais. n_live/n_dead são estimativas.
select
  s.schemaname,
  s.relname,
  pg_catalog.pg_total_relation_size(format('%I.%I', s.schemaname, s.relname)::regclass) as total_bytes,
  s.n_live_tup,
  s.n_dead_tup,
  round(100.0 * s.n_dead_tup / nullif(s.n_live_tup + s.n_dead_tup, 0), 2) as dead_tuple_ratio_pct_estimate,
  s.last_autovacuum,
  s.last_autoanalyze,
  s.n_tup_ins,
  s.n_tup_upd,
  s.n_tup_del,
  s.n_tup_hot_upd
from pg_catalog.pg_stat_user_tables s
where s.schemaname in ('public', 'private')
order by total_bytes desc, s.schemaname, s.relname;

-- Planos críticos sem execução de mutação. Substitua os UUID/textos abaixo por
-- valores inexistentes no ambiente; não use EXPLAIN ANALYZE em RPC mutável.
explain (analyze, buffers, format json)
select id from public.coletas_producao
where client_event_id = '00000000-0000-0000-0000-000000000000';

explain (analyze, buffers, format json)
select id from public.operator_sessions
where token_hash = '__nonexistent_sha256__';

explain (analyze, buffers, format json)
select id from public.production_pieces
where traceability_code = '__nonexistent_barcode__'
   or piece_uid = '__nonexistent_barcode__'
   or piece_code = '__nonexistent_barcode__'
limit 1;

explain (analyze, buffers, format json)
select id from public.collection_projection_outbox
where projected_at is null
  and dead_lettered_at is null
  and available_at <= clock_timestamp()
order by available_at, created_at
limit 25;

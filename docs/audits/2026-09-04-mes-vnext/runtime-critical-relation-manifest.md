# Manifesto das relações críticas existentes somente no runtime

Captura somente leitura do projeto `uozuzdfvnufsjsonswag`. As três relações não
possuem `CREATE TABLE` canônico nas migrations da `main` auditada. Este arquivo
preserva metadados de catálogo para fechar o drift; não é uma migration.

Corte UTC: `2026-09-04 16:15:41.22363+00`.

## `public.production_cell_active_contexts`

Owner: `postgres`. RLS: `true`. Force RLS: `false`.
ACL literal: `{postgres=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}`.

### Colunas

| # | Nome | Tipo | NOT NULL | Default | Identity | Generated |
|---:|---|---|---|---|---|---|
| 1 | `id` | `uuid` | true | `gen_random_uuid()` | `` | `` |
| 2 | `cell_id` | `uuid` | false | `—` | `` | `` |
| 3 | `cell_name` | `text` | true | `—` | `` | `` |
| 4 | `step_code` | `text` | true | `—` | `` | `` |
| 5 | `machine_id` | `uuid` | false | `—` | `` | `` |
| 6 | `active_lot_id` | `uuid` | false | `—` | `` | `` |
| 7 | `active_lot_code` | `text` | false | `—` | `` | `` |
| 8 | `active_pcp_import_batch_id` | `uuid` | false | `—` | `` | `` |
| 9 | `active_general_lot_code` | `text` | false | `—` | `` | `` |
| 10 | `source_client_event_id` | `text` | false | `—` | `` | `` |
| 11 | `activated_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |
| 12 | `last_event_occurred_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |
| 13 | `state_version` | `bigint` | true | `1` | `` | `` |
| 14 | `created_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |
| 15 | `updated_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |

### Constraints

| Nome | Tipo | Validada | Definição | SHA-256 |
|---|---|---|---|---|
| `production_cell_active_contexts_active_lot_id_fkey` | `f` | true | `FOREIGN KEY (active_lot_id) REFERENCES production_lots(id) ON DELETE SET NULL` | `f3ddf19af11cb36bb9da62e3ed56e0bce3c0d96a46235fcd35165ac8cf357aa7` |
| `production_cell_active_contexts_active_pcp_import_batch_id_fkey` | `f` | true | `FOREIGN KEY (active_pcp_import_batch_id) REFERENCES promob_import_batches(id) ON DELETE SET NULL` | `536e7ee28939b7e15dbed53730c831feca87b614dde423ad320f3d1e7dc78efa` |
| `production_cell_active_contexts_cell_id_fkey` | `f` | true | `FOREIGN KEY (cell_id) REFERENCES cells(id) ON DELETE SET NULL` | `b9ce92223d16e22a5f623d3833ea56e64e0a1b823f412508374d37128533d42e` |
| `production_cell_active_contexts_machine_id_fkey` | `f` | true | `FOREIGN KEY (machine_id) REFERENCES production_machines(id) ON DELETE SET NULL` | `8879ce5def4619a08ca21cf55b7c35494b6ebd4e7269fc89cc1610a228b988e8` |
| `production_cell_active_contexts_pkey` | `p` | true | `PRIMARY KEY (id)` | `8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5` |
| `production_cell_active_contexts_state_version_check` | `c` | true | `CHECK (state_version > 0)` | `5c4609d886344240ed7e6d564db3ce5659818beae283bb269fa85ba13a6c8f37` |

### Índices

| Nome | Válido/ready | Definição | SHA-256 |
|---|---|---|---|
| `idx_cell_active_contexts_active_lot_id` | true/true | `CREATE INDEX idx_cell_active_contexts_active_lot_id ON public.production_cell_active_contexts USING btree (active_lot_id) WHERE (active_lot_id IS NOT NULL)` | `8d187e22bc9b9164972d319ac0a6491c3df49f064b17558742b2ced1b0aea4fd` |
| `idx_cell_active_contexts_cell_id` | true/true | `CREATE INDEX idx_cell_active_contexts_cell_id ON public.production_cell_active_contexts USING btree (cell_id) WHERE (cell_id IS NOT NULL)` | `1cc9c6ccf6e7ca7c4bc70263db68f77a4cf0c49cdd4474aedb73268a6f55d7f7` |
| `idx_cell_active_contexts_machine_id` | true/true | `CREATE INDEX idx_cell_active_contexts_machine_id ON public.production_cell_active_contexts USING btree (machine_id) WHERE (machine_id IS NOT NULL)` | `7336231a781e910b0a4319c58ac15892b925a64fc2cab4b838eb1148b5e4312e` |
| `idx_production_cell_active_context_batch` | true/true | `CREATE INDEX idx_production_cell_active_context_batch ON public.production_cell_active_contexts USING btree (active_pcp_import_batch_id, updated_at DESC)` | `92c05877694a44f906b25ab24ddcc6136dd144b605b5d5f9cb28043a5aa8ba1d` |
| `production_cell_active_contexts_pkey` | true/true | `CREATE UNIQUE INDEX production_cell_active_contexts_pkey ON public.production_cell_active_contexts USING btree (id)` | `e8935d650e39b3d637d834b2db52a6aa422e960a59ce8521a621fa64cf6b3627` |
| `uq_production_cell_active_context_scope` | true/true | `CREATE UNIQUE INDEX uq_production_cell_active_context_scope ON public.production_cell_active_contexts USING btree (lower(btrim(cell_name)), lower(btrim(step_code)), COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid))` | `7887a76367c390f680e722aee9ac509cce54492f384a48ed27a3f1dd7ee2a6d5` |

### Policies

| Nome | Roles | Comando | Modo | USING | WITH CHECK |
|---|---|---|---|---|---|
| `production_cell_active_contexts_scoped_read` | `authenticated` | `SELECT` | `PERMISSIVE` | `(current_profile_has_global_cell_access() OR profile_can_access_cell(cell_name))` | `—` |

### Grants efetivos

| Grantee | Privilégio | Grantable |
|---|---|---|
| `authenticated` | `REFERENCES` | `NO` |
| `authenticated` | `SELECT` | `NO` |
| `authenticated` | `TRIGGER` | `NO` |
| `authenticated` | `TRUNCATE` | `NO` |
| `postgres` | `DELETE` | `YES` |
| `postgres` | `INSERT` | `YES` |
| `postgres` | `REFERENCES` | `YES` |
| `postgres` | `SELECT` | `YES` |
| `postgres` | `TRIGGER` | `YES` |
| `postgres` | `TRUNCATE` | `YES` |
| `postgres` | `UPDATE` | `YES` |
| `service_role` | `DELETE` | `NO` |
| `service_role` | `INSERT` | `NO` |
| `service_role` | `REFERENCES` | `NO` |
| `service_role` | `SELECT` | `NO` |
| `service_role` | `TRIGGER` | `NO` |
| `service_role` | `TRUNCATE` | `NO` |
| `service_role` | `UPDATE` | `NO` |

## `public.production_cell_lot_states`

Owner: `postgres`. RLS: `true`. Force RLS: `false`.
ACL literal: `{postgres=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=arwdDxtm/postgres}`.

### Colunas

| # | Nome | Tipo | NOT NULL | Default | Identity | Generated |
|---:|---|---|---|---|---|---|
| 1 | `id` | `uuid` | true | `gen_random_uuid()` | `` | `` |
| 2 | `pcp_import_batch_id` | `uuid` | false | `—` | `` | `` |
| 3 | `general_lot_code` | `text` | false | `—` | `` | `` |
| 4 | `lot_id` | `uuid` | true | `—` | `` | `` |
| 5 | `lot_code` | `text` | false | `—` | `` | `` |
| 6 | `cell_id` | `uuid` | false | `—` | `` | `` |
| 7 | `cell_name` | `text` | true | `—` | `` | `` |
| 8 | `step_code` | `text` | true | `—` | `` | `` |
| 9 | `machine_id` | `uuid` | false | `—` | `` | `` |
| 10 | `status` | `text` | true | `'active'::text` | `` | `` |
| 11 | `expected_count` | `bigint` | true | `0` | `` | `` |
| 12 | `approved_count` | `bigint` | true | `0` | `` | `` |
| 13 | `rejected_count` | `bigint` | true | `0` | `` | `` |
| 14 | `pending_count` | `bigint` | true | `0` | `` | `` |
| 15 | `rework_count` | `bigint` | true | `0` | `` | `` |
| 16 | `replacement_count` | `bigint` | true | `0` | `` | `` |
| 17 | `started_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |
| 18 | `activated_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |
| 19 | `paused_at` | `timestamp with time zone` | false | `—` | `` | `` |
| 20 | `closed_at` | `timestamp with time zone` | false | `—` | `` | `` |
| 21 | `last_event_occurred_at` | `timestamp with time zone` | false | `—` | `` | `` |
| 22 | `closed_by_operator_id` | `uuid` | false | `—` | `` | `` |
| 23 | `close_reason` | `text` | false | `—` | `` | `` |
| 24 | `state_version` | `bigint` | true | `1` | `` | `` |
| 25 | `metadata` | `jsonb` | true | `'{}'::jsonb` | `` | `` |
| 26 | `created_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |
| 27 | `updated_at` | `timestamp with time zone` | true | `clock_timestamp()` | `` | `` |

### Constraints

| Nome | Tipo | Validada | Definição | SHA-256 |
|---|---|---|---|---|
| `production_cell_lot_states_approved_count_check` | `c` | true | `CHECK (approved_count >= 0)` | `9ddefdee3731183ef2e12d89262894d437a5740b0a8c4459557ca9ecbff7c0fb` |
| `production_cell_lot_states_cell_id_fkey` | `f` | true | `FOREIGN KEY (cell_id) REFERENCES cells(id) ON DELETE SET NULL` | `b9ce92223d16e22a5f623d3833ea56e64e0a1b823f412508374d37128533d42e` |
| `production_cell_lot_states_closed_by_operator_id_fkey` | `f` | true | `FOREIGN KEY (closed_by_operator_id) REFERENCES operators(id) ON DELETE SET NULL` | `cf21a77781ca5c83534cf7335da85c4a25415e2e650588cff05bf5969647a3a9` |
| `production_cell_lot_states_expected_count_check` | `c` | true | `CHECK (expected_count >= 0)` | `e87095e207ff1fcb44404503514c5019cef37f9c1582001e3c400ee5a7f8bbd4` |
| `production_cell_lot_states_lot_id_fkey` | `f` | true | `FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE CASCADE` | `a86703a687918ca63ffc6aea4b583e19719d0d8e2cc46ee57da61cf3b5f00ced` |
| `production_cell_lot_states_machine_id_fkey` | `f` | true | `FOREIGN KEY (machine_id) REFERENCES production_machines(id) ON DELETE SET NULL` | `8879ce5def4619a08ca21cf55b7c35494b6ebd4e7269fc89cc1610a228b988e8` |
| `production_cell_lot_states_pcp_import_batch_id_fkey` | `f` | true | `FOREIGN KEY (pcp_import_batch_id) REFERENCES promob_import_batches(id) ON DELETE SET NULL` | `7800b74a2787d508b4da0e4a49ff1ccc59c9d56afcc798e70f38c86f68f15224` |
| `production_cell_lot_states_pending_count_check` | `c` | true | `CHECK (pending_count >= 0)` | `613cc811ff97a6dcf328d199179d0bbc53a04c061303beacaaf448c79a78fcd4` |
| `production_cell_lot_states_pkey` | `p` | true | `PRIMARY KEY (id)` | `8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5` |
| `production_cell_lot_states_rejected_count_check` | `c` | true | `CHECK (rejected_count >= 0)` | `8382df75e80da75ae0873abc648d8f680ecb414592a887f98d5dde5267f624b9` |
| `production_cell_lot_states_replacement_count_check` | `c` | true | `CHECK (replacement_count >= 0)` | `b3d566739ed351b32fe5de0a6f9b99263d4fd0681e06af095e4a51320c7d537a` |
| `production_cell_lot_states_rework_count_check` | `c` | true | `CHECK (rework_count >= 0)` | `f4508a5947bc065909af8bdffa1da0630f30c11e4c111c7503ea085feaa03616` |
| `production_cell_lot_states_state_version_check` | `c` | true | `CHECK (state_version > 0)` | `5c4609d886344240ed7e6d564db3ce5659818beae283bb269fa85ba13a6c8f37` |
| `production_cell_lot_states_status_check` | `c` | true | `CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'closed'::text, 'cancelled'::text]))` | `070bb82ffc843fcc5122a32e9cc9f2618a0d177cc78dca5af5c14e60dc8bc809` |

### Índices

| Nome | Válido/ready | Definição | SHA-256 |
|---|---|---|---|
| `idx_cell_lot_states_closed_by_operator_id` | true/true | `CREATE INDEX idx_cell_lot_states_closed_by_operator_id ON public.production_cell_lot_states USING btree (closed_by_operator_id) WHERE (closed_by_operator_id IS NOT NULL)` | `5423a621eae9b91927466e404081cdae657c22e06eeb33117eff011f92a84ad0` |
| `idx_cell_lot_states_machine_id` | true/true | `CREATE INDEX idx_cell_lot_states_machine_id ON public.production_cell_lot_states USING btree (machine_id) WHERE (machine_id IS NOT NULL)` | `23c8cbd90901c23f5f6097db81e56d05392ec10b212539df92343a034ced9c63` |
| `idx_cell_lot_states_status` | true/true | `CREATE INDEX idx_cell_lot_states_status ON public.production_cell_lot_states USING btree (cell_id, step_code, status, updated_at DESC)` | `a41c5f0bb83646304c11bee80b953eebde277803cc79869a766ce60218f2972e` |
| `idx_production_cell_lot_states_active` | true/true | `CREATE INDEX idx_production_cell_lot_states_active ON public.production_cell_lot_states USING btree (lower(btrim(cell_name)), lower(btrim(step_code)), status, updated_at DESC)` | `6e815df1694736c2043dfe9131a289cf2393c9bc33538ca3c49a8807dc7b6c08` |
| `idx_production_cell_lot_states_batch` | true/true | `CREATE INDEX idx_production_cell_lot_states_batch ON public.production_cell_lot_states USING btree (pcp_import_batch_id, status, updated_at DESC)` | `9bd2a83f0be4dccd1ef264e2feb356da2a44fd6fda39a867e0376f55fcea44df` |
| `production_cell_lot_states_pkey` | true/true | `CREATE UNIQUE INDEX production_cell_lot_states_pkey ON public.production_cell_lot_states USING btree (id)` | `6a1cb2020f4460920954e45bbe465c90ce2df8a9d27606c207a605d60ea193b6` |
| `uq_production_cell_lot_state_scope` | true/true | `CREATE UNIQUE INDEX uq_production_cell_lot_state_scope ON public.production_cell_lot_states USING btree (lot_id, lower(btrim(cell_name)), lower(btrim(step_code)), COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid))` | `2da905465b81c9b87ec241017acd70eebcce6154f5865c2263bb81c78736594c` |

### Policies

| Nome | Roles | Comando | Modo | USING | WITH CHECK |
|---|---|---|---|---|---|
| `production_cell_lot_states_scoped_read` | `authenticated` | `SELECT` | `PERMISSIVE` | `(current_profile_has_global_cell_access() OR profile_can_access_cell(cell_name))` | `—` |

### Grants efetivos

| Grantee | Privilégio | Grantable |
|---|---|---|
| `authenticated` | `REFERENCES` | `NO` |
| `authenticated` | `SELECT` | `NO` |
| `authenticated` | `TRIGGER` | `NO` |
| `authenticated` | `TRUNCATE` | `NO` |
| `postgres` | `DELETE` | `YES` |
| `postgres` | `INSERT` | `YES` |
| `postgres` | `REFERENCES` | `YES` |
| `postgres` | `SELECT` | `YES` |
| `postgres` | `TRIGGER` | `YES` |
| `postgres` | `TRUNCATE` | `YES` |
| `postgres` | `UPDATE` | `YES` |
| `service_role` | `DELETE` | `NO` |
| `service_role` | `INSERT` | `NO` |
| `service_role` | `REFERENCES` | `NO` |
| `service_role` | `SELECT` | `NO` |
| `service_role` | `TRIGGER` | `NO` |
| `service_role` | `TRUNCATE` | `NO` |
| `service_role` | `UPDATE` | `NO` |

## `public.production_lot_stage_aggregates`

Owner: `postgres`. RLS: `true`. Force RLS: `false`.
ACL literal: `{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`.

### Colunas

| # | Nome | Tipo | NOT NULL | Default | Identity | Generated |
|---:|---|---|---|---|---|---|
| 1 | `lot_id` | `uuid` | true | `—` | `` | `` |
| 2 | `step_code` | `text` | true | `—` | `` | `` |
| 3 | `approved_count` | `bigint` | true | `0` | `` | `` |
| 4 | `last_reading_id` | `uuid` | false | `—` | `` | `` |
| 5 | `last_event_at` | `timestamp with time zone` | false | `—` | `` | `` |
| 6 | `updated_at` | `timestamp with time zone` | true | `now()` | `` | `` |

### Constraints

| Nome | Tipo | Validada | Definição | SHA-256 |
|---|---|---|---|---|
| `production_lot_stage_aggregates_approved_nonnegative` | `c` | true | `CHECK (approved_count >= 0)` | `9ddefdee3731183ef2e12d89262894d437a5740b0a8c4459557ca9ecbff7c0fb` |
| `production_lot_stage_aggregates_last_reading_id_fkey` | `f` | true | `FOREIGN KEY (last_reading_id) REFERENCES production_stage_readings(id) ON DELETE SET NULL` | `65267ea9b83986b95fdd705746d93bfa2dde05c55b01d34a6486762315525a05` |
| `production_lot_stage_aggregates_lot_id_fkey` | `f` | true | `FOREIGN KEY (lot_id) REFERENCES production_lots(id) ON DELETE CASCADE` | `a86703a687918ca63ffc6aea4b583e19719d0d8e2cc46ee57da61cf3b5f00ced` |
| `production_lot_stage_aggregates_pkey` | `p` | true | `PRIMARY KEY (lot_id, step_code)` | `7b067b0361382af063c69d62487422de9d98a7e6d67afd668914b6357311e8ca` |

### Índices

| Nome | Válido/ready | Definição | SHA-256 |
|---|---|---|---|
| `idx_lot_stage_aggregates_last_reading_id` | true/true | `CREATE INDEX idx_lot_stage_aggregates_last_reading_id ON public.production_lot_stage_aggregates USING btree (last_reading_id) WHERE (last_reading_id IS NOT NULL)` | `926b5e7c44ee732f1261cc187fdaba7e94b7bb7b11272863f59d7a10764291b1` |
| `idx_lot_stage_aggregates_updated` | true/true | `CREATE INDEX idx_lot_stage_aggregates_updated ON public.production_lot_stage_aggregates USING btree (updated_at DESC)` | `db5c52aa1e4c1883e8748421ef18e79a23ad2e8073b82159b8c1b04ba3f82b86` |
| `production_lot_stage_aggregates_pkey` | true/true | `CREATE UNIQUE INDEX production_lot_stage_aggregates_pkey ON public.production_lot_stage_aggregates USING btree (lot_id, step_code)` | `29600968dec530ea15c1d42a472af2d8b337c9bf9f78b9109bbf9a18b2bc90e2` |

### Policies

| Nome | Roles | Comando | Modo | USING | WITH CHECK |
|---|---|---|---|---|---|
| `production_lot_stage_aggregates_read` | `authenticated` | `SELECT` | `PERMISSIVE` | `(EXISTS ( SELECT 1<br>   FROM profiles profile<br>  WHERE ((profile.id = ( SELECT auth.uid() AS uid)) AND (profile.active IS DISTINCT FROM false))))` | `—` |

### Grants efetivos

| Grantee | Privilégio | Grantable |
|---|---|---|
| `authenticated` | `DELETE` | `NO` |
| `authenticated` | `INSERT` | `NO` |
| `authenticated` | `REFERENCES` | `NO` |
| `authenticated` | `SELECT` | `NO` |
| `authenticated` | `TRIGGER` | `NO` |
| `authenticated` | `TRUNCATE` | `NO` |
| `authenticated` | `UPDATE` | `NO` |
| `postgres` | `DELETE` | `YES` |
| `postgres` | `INSERT` | `YES` |
| `postgres` | `REFERENCES` | `YES` |
| `postgres` | `SELECT` | `YES` |
| `postgres` | `TRIGGER` | `YES` |
| `postgres` | `TRUNCATE` | `YES` |
| `postgres` | `UPDATE` | `YES` |
| `service_role` | `DELETE` | `NO` |
| `service_role` | `INSERT` | `NO` |
| `service_role` | `REFERENCES` | `NO` |
| `service_role` | `SELECT` | `NO` |
| `service_role` | `TRIGGER` | `NO` |
| `service_role` | `TRUNCATE` | `NO` |
| `service_role` | `UPDATE` | `NO` |

## Interpretação

- `production_cell_lot_states` e `production_cell_active_contexts` concedem
  `SELECT`, mas também `REFERENCES`, `TRIGGER` e `TRUNCATE` a `authenticated`.
  A policy condiciona as linhas visíveis no `SELECT`; RLS não protege
  `TRUNCATE`. Portanto esses ACLs não são “somente leitura”.
- `production_lot_stage_aggregates` concede todas as operações de tabela a
  `authenticated`, inclusive `TRUNCATE`; RLS não protege `TRUNCATE`.
- As três relações misturam cache/projeção com contexto operacional. Nenhuma deve
  ser apagada ou reconstruída em bloco antes de classificar sua autoridade.
- Antes de criar desired state, comparar novamente este manifesto, os corpos em
  `runtime-critical-function-definitions.sql.txt` e os triggers capturados.

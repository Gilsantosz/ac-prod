# Baseline do runtime e catálogo Supabase

**Auditoria:** MES vNext de alta capacidade do AC-Prod2
**Projeto Supabase:** `uozuzdfvnufsjsonswag` (`ac-prod`)
**Região:** `sa-east-1`
**Estado do projeto:** `ACTIVE_HEALTHY`
**PostgreSQL:** 17.6 (`17.6.1.127` na plataforma)
**Referência Git:** `9174c796df4fa008507e727eb35cce63b3e4a08f`
**Branch de auditoria:** `codex/mes-vnext-audit-20260904`
**Decisão deste baseline:** **NO-GO**

## 1. Escopo, método e corte temporal

Esta inspeção foi executada pelo conector oficial do Supabase em modo somente leitura. Não houve DDL, escrita, deploy, teste de carga, alteração de flag ou leitura do valor de qualquer segredo.

O conjunto versionado para repetir os próximos cortes está em
[`runtime-read-only-probes.sql`](runtime-read-only-probes.sql). Ele preserva
consultas read-only e sanitizadas; não recria retroativamente a serialização dos
fingerprints históricos.

O arquivo completo foi executado com sucesso contra o projeto auditado depois
da inclusão do serializador canônico, sem DDL/DML. A resposta final do batch foi
um plano `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` sobre um sentinel
inexistente; isso valida sintaxe e resolução dos objetos, não mede capacidade.

Os resultados foram sanitizados: não incluem e-mail, matrícula, identificadores pessoais, JWT, refresh token, IP, conteúdo de segredo nem payload produtivo. Identificadores de eventos, operadores, sessões e dispositivos também não foram exportados.

Os principais cortes temporais em UTC foram:

| Evidência | Horário UTC |
|---|---:|
| Baseline principal de atividade e banco | `2026-09-04T14:55:56.608Z` |
| Advisors de segurança | `2026-09-04T15:12:46.423Z` |
| Advisors de desempenho | `2026-09-04T15:12:50.339Z` |
| Sessões operacionais | `2026-09-04T15:15:30.644Z` |
| Estatísticas e tamanhos das relações | `2026-09-04T15:16:20Z` |
| Manifesto de migrations | `2026-09-04T15:17:35.181Z` |
| Feature flags | `2026-09-04T15:18:12.948Z` |
| Filas PGMQ | `2026-09-04T15:18:39.907Z` |
| Revalidação SHA-256 das dez funções críticas | `2026-09-04T16:14:52Z` |
| Captura literal das três relações runtime-only críticas | `2026-09-04T16:15:41.223630Z` |
| Captura literal das três funções críticas de reposição | `2026-09-04T16:22Z` |
| Manifesto canônico por objeto (`public`/`private`) | `2026-09-04T17:00:15.842077Z`–`17:00:22.607320Z` |
| Execução integral dos probes versionados | `2026-09-04T17:01:43.978652Z` |
| Revalidação dos 222 hashes `SECURITY DEFINER` | `2026-09-04T17:05:35.669550Z` |

Os checksums MD5 abaixo são fingerprints determinísticos para comparação de drift, não mecanismos criptográficos de segurança. As entradas foram ordenadas antes do hash e incluíram, conforme o tipo de objeto:

- colunas: schema, relação, posição, nome, tipo, nulabilidade, default, identity e generated;
- constraints e FKs: nome, tipo e `pg_get_constraintdef`;
- índices: nome e `pg_get_indexdef`;
- triggers: nome e `pg_get_triggerdef`;
- funções: assinatura, owner, ACL, `proconfig` e `pg_get_functiondef`;
- views: nome e `pg_get_viewdef`;
- policies: schema, tabela, nome, modo, roles, comando, `USING` e `WITH CHECK`;
- relações: tipo, owner e ACL.

## 2. Resultado executivo

O runtime atual não está homologado para ativação da pipeline v3 e ainda não contém uma pipeline v4/vNext. Os bloqueadores comprovados são:

1. existem 58 mensagens históricas na DLQ, todas de projeção e sem `reason_code`;
2. `capacity_test_runs` está vazio, apesar de existirem fixtures e mensagens de ensaio;
3. grants permitem operações excessivas, inclusive `TRUNCATE`, em tabelas críticas;
4. `production_realtime_counters` admite leitura global para `anon` e `authenticated` por policy `USING (true)`;
5. o worker continua serializado por uma lease global por `worker_kind`;
6. os consumidores principais continuam sendo Edge Functions despertadas por HTTP/cron, sem pool persistente por slots;
7. os endpoints internos dos workers retornam CORS `*`;
8. não existe função canônica privada de decisão reutilizada pelos caminhos síncrono, fallback e replay;
9. há 471 recibos marcados como sincronizados sem evento produtivo atual correspondente, exigindo reconciliação;
10. nenhum ensaio atual, reproduzível e registrado comprova os SLOs de ACK, decisão, projeção, dashboard, Auth e conexão.

As quatro flags v3 permanecem corretamente desligadas. Este baseline não autoriza shadow, canário ou rollout.

## 3. Inventário do catálogo

### 3.1 Relações por schema

| Schema | Objetos | Contagem | Checksum do manifesto de relações |
|---|---|---:|---|
| `public` | 113 tabelas, 9 views, 2 sequences | 124 | `644c2e44e52cb42773e7844e59106b09` |
| `private` | 7 tabelas | 7 | `3ee8a3f153534779756740ac39fee981` |
| `auth` | 23 tabelas, 1 sequence | 24 | inventariado; gerenciado pela plataforma |
| `realtime` | 10 tabelas, 1 sequence | 11 | inventariado; gerenciado pela plataforma |
| `storage` | 8 tabelas | 8 | inventariado; gerenciado pela plataforma |
| `cron` | 2 tabelas, 2 sequences | 4 | inventariado; extensão |
| `net` | 2 tabelas, 1 sequence | 3 | inventariado; extensão |
| `vault` | 1 tabela, 1 view | 2 | inventariado; extensão |
| `supabase_migrations` | 1 tabela | 1 | inventariado; gerenciado pela plataforma |

Todas as relações de aplicação consultadas nos schemas `public` e `private` têm owner `postgres`. O schema `private` concede `USAGE/CREATE` apenas a `postgres`; os papéis de cliente não têm acesso direto. No schema `public`, `PUBLIC`, `anon` e `authenticated` possuem `USAGE`, mas apenas `pg_database_owner` possui `CREATE`.

As tabelas privadas são:

- `capacity_test_fixture_objects`;
- `coleta_producao_credentials`;
- `collection_pipeline_flags`;
- `collection_projection_recovery_audit`;
- `collection_projection_trigger_registry`;
- `collection_worker_heartbeats`;
- `collection_worker_leases_v3`.

### 3.2 Checksums globais do catálogo de aplicação

| Schema | Categoria | Contagem | Checksum |
|---|---|---:|---|
| `public` | colunas | 2.002 | `b9a0d97d60e38689483a9337b182bc4e` |
| `public` | constraints | 572 | `9b7fb020ed339e492f6a0833eba99f8d` |
| `public` | foreign keys | 261 | `6be77e87eaad6285f788b6da7f44e2f5` |
| `public` | índices | 429 | `36f70042e06cf0cc5b30b86faa76db00` |
| `public` | triggers de usuário | 89 | `1a62c64d99bce5f6e76244ff65df351c` |
| `public` | policies | 257 | `6dad7fc8c814a0b224a5d511fce79e09` |
| `public` | owner/ACL de relações | 124 | `3191048a241ea764d054c97900b04b9c` |
| `public` | funções | 251 | `ff7bd4705994a62ed40bc27b86ef5393` |
| `public` | view definitions | 9 | `8cfcd55d21ecc113c5468f5058d0575e` |
| `private` | colunas | 48 | `c95d42072b384dd08d031abbf4c8f3e7` |
| `private` | constraints | 14 | `e5e4cb40dd77f2cf414e279ff716bd94` |
| `private` | foreign keys | 2 | `b4fa367185405de2e4651587b058f827` |
| `private` | índices | 7 | `de3d33306669b8de405df5eb52309212` |
| `private` | owner/ACL de relações | 7 | `900e1f88bdcc5333b9cf06e0a27ccb5e` |
| `private` | funções | 21 | `f68b4c7007a4ce4d6c0a9c4276a9216c` |

Fingerprints complementares, recalculados sobre linhas ordenadas:

| Categoria e escopo | Contagem | Checksum MD5 |
|---|---:|---|
| grants de tabela em `public`, `private`, `realtime` e `pgmq` | 3.181 | `0c18a1be6d398d9ad5c36e81f7a60341` |
| grants de rotina em `public`, `private` e `pgmq` | 813 | `886223ab7a45ab56d780002e9452bdfe` |
| policies de `realtime.messages` | 5 | `9c2a6cc11be117b87d34f94d61619caf` |
| default ACLs globais ou dos quatro schemas | 11 | `ea48bc65a53ff301a617b37e1f949975` |

O arquivo
[`runtime-object-manifest.json`](runtime-object-manifest.json) registra, com o
serializador SQL v1 versionado nos probes, fingerprints SHA-256 individuais de
131 relações e 272 rotinas. Para cada relação há owner, estado RLS, hash de ACL
e contagem/hash de colunas, constraints, índices, triggers, policies e view;
para cada overload há owner, modo de segurança, linguagem, volatilidade e
hashes de ACL, `proconfig` e definição. A captura ocorreu em duas consultas
ordenadas, portanto não é snapshot transacional atômico.

Não existem policies nem triggers de usuário nas tabelas privadas. O isolamento depende do bloqueio de acesso ao schema e dos wrappers públicos/privados.

### 3.3 Extensões instaladas

| Extensão | Versão |
|---|---:|
| `pgcrypto` | 1.3 |
| `supabase_vault` | 0.3.1 |
| `pg_stat_statements` | 1.11 |
| `uuid-ossp` | 1.1 |
| `pg_cron` | 1.6.4 |
| `pg_net` | 0.20.3 |
| `pgmq` | 1.5.1 |
| `plpgsql` | 1.0 |

O advisor sinaliza `pg_net` instalado no schema `public`. Qualquer mudança de schema de extensão deve ser tratada separadamente, com compatibilidade e rollback comprovados.

### 3.4 Publicações Realtime

| Publicação | Relações | Checksum |
|---|---:|---|
| `supabase_realtime` | 34 | `e706d9d62f2210b86405d71ce64e0a2e` |
| `supabase_realtime_messages_publication` | 1 (`realtime.messages`) | `ab8e7bb1ca25b0791ce021242e726d7d` |

`supabase_realtime` inclui, entre outras, `coletas_producao`, `production_collection_events`, `production_stage_readings`, `production_realtime_counters`, peças, lotes, células, máquinas, operadores e perfis. Portanto coexistem superfícies de Postgres Changes e Broadcast.

## 4. Migrations, releases e flags

### 4.1 Migrations aplicadas

`supabase_migrations.schema_migrations` contém 154 versões:

- primeira: `20260601004505`;
- última: `20260903165317`;
- checksum de `version|name`: `72acc71f1bdae2842c3ab6ed3be50752`;
- checksum de `version|name|statements`: `76906f0f975f7cefb715049201fd5f09`.

As versões mais relevantes no final da cadeia são:

| Versão | Nome |
|---|---|
| `20260901120000` | `collection_fabric_v3_foundation` |
| `20260901121000` | filas/ingress v3 |
| `20260901122000` | guards de triggers de projeção |
| `20260901123000` | processador de decisão v3 |
| `20260901124000` | projetor v3 |
| `20260901125000` | Realtime/health/rollout v3 |
| `20260901130000` | compatibilidade do runtime do projetor |
| `20260902164000` | `auth_realtime_projection_capacity_hardening` |
| `20260902164500` | `projection_42703_recovery` |
| `20260902165000` | `capacity_test_control_plane` |
| `20260902165500` | `capacity_test_fixture` |
| `20260902170500` | `capacity_atomic_context_repair` |
| `20260903165317` | `enable_manual_volume_and_policy_realtime` |

O diff Git/runtime deve comparar as migrations da `main` e da PR #63 com esses dois checksums. Um nome presente na tabela de migrations não prova sozinho que o conteúdo do arquivo Git coincide com o SQL aplicado.

### 4.2 Releases de schema

`app_schema_releases` possui 31 registros:

- `ready=true`: 4;
- `ready=false`: 27;
- checksum do manifesto: `04745be0d90b1a00e7f631ec174c1cbe`.

Todos os registros v3, capacity e hardening inspecionados permanecem `ready=false`. Os quatro registros prontos pertencem a releases assíncronos anteriores. Isso preserva o NO-GO formal.

### 4.3 Feature flags

| Flag | Enabled | Atualizada em UTC |
|---|---|---:|
| `collection_pipeline_v3_broadcast` | `false` | `2026-09-02T17:02:11.432Z` |
| `collection_pipeline_v3_ingress` | `false` | `2026-09-02T17:02:11.438Z` |
| `collection_pipeline_v3_projection` | `false` | `2026-09-02T17:02:11.437Z` |
| `collection_pipeline_v3_worker` | `false` | `2026-09-02T17:02:11.437Z` |

Checksum conjunto das flags: `c67cec81ecce971f91354d3147c16fe6`. Cada `rollout_scope` contém apenas a chave `reason`; os valores não foram exportados. O checksum comum do escopo é `a3ba8e3d9fe3dfcc09b52b2d13d417bf`.

Não existe relação ou função com nome v4/vNext, tabela `collection_worker_slots` ou função nomeada `decide_collection_event*`.

## 5. Contrato, constraints e idempotência atuais

### 5.1 Recibos

`coletas_producao` possui 47 colunas e as barreiras:

- `UNIQUE (client_event_id)`;
- `UNIQUE (device_id, device_sequence)` parcial para valores não nulos;
- `CHECK pipeline_version IN (2, 3)`, atualmente `NOT VALID`;
- `CHECK source_mode IN ('live', 'offline_replay')`, atualmente `NOT VALID`;
- `CHECK device_sequence > 0`, atualmente `NOT VALID`.

Diferenças em relação ao contrato vNext solicitado:

- `client_event_id` é `text`, não UUID;
- não há `schema_version`, `trace_id`, `payload_hash` nem dimensões completas de site/setor;
- `source_mode` não contempla `retry` e `administrative`;
- pipeline v4 não é aceita pela constraint atual.

### 5.2 Evento e ledger

- `production_collection_events` possui 68 colunas e `UNIQUE (client_event_id)`.
- `production_stage_readings` possui 58 colunas e `UNIQUE` parcial em `client_event_id`.
- A barreira física de aprovação é `UNIQUE (piece_id, step_name, production_cycle) WHERE status = 'approved'`.

No estado observado há zero grupos de dupla aprovação literal e zero grupos após `lower(trim(step_name))`. Contudo, a constraint protege `step_name` literal, não um `normalized_step_code`; variações futuras de normalização ainda precisam de uma chave canônica explícita.

### 5.3 Projeção

- `collection_projection_outbox` tem unicidade em `(client_event_id, projection_revision)`.
- `collection_projection_applied` usa PK `(outbox_id, projection_type)`.
- A chave física não é diretamente `(client_event_id, projection_revision, projection_kind)`; a equivalência depende do vínculo estável com o outbox.
- `production_lot_stage_counter_shards` usa PK `(lot_id, step_code, shard_number)` e limita `shard_number` a `0..31`.

## 6. PGMQ, DLQ e execução dos workers

### 6.1 Filas

As quatro filas existem e são logged (`is_unlogged=false`):

| Fila | Depth atual | Oldest age atual | Archive |
|---|---:|---:|---:|
| `collection_live_v3` | 0 | n/a | 142 |
| `collection_replay_v3` | 0 | n/a | 0 |
| `collection_projection_v3` | 0 | n/a | 200 |
| `collection_dead_letter_v3` | 0 | n/a | 58 |

Fila atual vazia não significa DLQ tratada ou reconciliação concluída.

As 58 mensagens de DLQ arquivadas têm:

- origem: `collection_projection_v3`;
- SQLSTATE: `42703`;
- primeira ocorrência: `2026-09-02T15:00:04.201Z`;
- última ocorrência: `2026-09-02T15:05:59.329Z`;
- `reason_code` presente: 0 de 58.

`private.collection_projection_recovery_audit` registra as 58 como
`status='requeued'`, SQLSTATE original `42703`, todas com mensagem de recovery,
entre `2026-09-02T16:41:53.529885Z` e `16:41:53.604243Z`. No snapshot atual,
porém, zero dessas linhas aponta para um outbox ainda existente e zero possui
`projection_applied` correlacionado. Isso prova a tentativa de recuperação, não
o efeito final; `untreated_dlq = 0` permanece não comprovado.

### 6.2 Semântica de consumo

O runtime v3 usa:

- `pgmq.read`, não `pop`;
- visibility timeout de 45 segundos;
- archive após processamento;
- `set_vt` para reagendar retry;
- máximo de cinco leituras/tentativas;
- prioridade live:replay inicial de 4:1.

Não há renovação periódica da visibilidade. Hoje os statements são limitados a 5 segundos na decisão e 10 segundos na projeção, menores que o VT, mas uma operação futura longa precisará de heartbeat/renovação explícita.

A classificação de retry inclui classe `08`, `40001`, `40P01`, `55P03`, `57014`, `57P01` e `53300`. O tratamento genérico de `57014` não prova que toda operação cancelada é segura para retry; `53300` durante saturação pode amplificar pressão se não houver backoff e admission control.

### 6.3 Lease e heartbeat

`private.collection_worker_leases_v3` mantém PK apenas em `worker_kind`. Isso permite no máximo um lease para decisão e um para projeção, independentemente do número de instâncias.

`private.collection_worker_heartbeats` contém 142 registros:

- decisão: 89;
- projeção: 53;
- sem `finished_at`: 70;
- inacabados e stale há mais de um minuto: 70;
- `claimed_total`: 484;
- `finalized_total`: 342.

O histórico não comprova finalização limpa nem perda de lease segura.

### 6.4 Cron

Há três jobs de coleta a cada 15 segundos:

| Job | Execuções na janela observada | Sucesso | Falha |
|---|---:|---:|---:|
| inbox legado | 5.743 | 5.741 | 2 |
| decisão v3 | 5.744 | 5.741 | 3 |
| projeção v3 | 5.743 | 5.741 | 2 |

As flags desligadas fazem os jobs v3 retornarem sem processar, mas o cron continua acionando o control plane. Cron permanece adequado apenas como sweeper/fallback, não como mecanismo normal de latência.

## 7. Integridade e preservação de evidência

### 7.1 Contagens atuais

| Objeto | Estado observado |
|---|---:|
| Recibos totais | 703 |
| Recibos v2 | 561 |
| Recibos v3 | 142 |
| Recibos sincronizados | 554 |
| Recibos em erro | 149 |
| Recibos com retry | 587 |
| Maior `attempt_count` de recibo | 18 |
| Processing attempts | 176 |
| Attempts failed/retryable | 6, todos `55P03` |
| Maior attempt registrado | 4 |
| Eventos produtivos atuais | 83, todos v2 |
| Eventos aprovados | 80 |
| Eventos duplicados | 3 |
| Outbox atual | 0 |
| Projection applied atual | 0 |
| Counter shards atuais | 0 |

Há 471 recibos sincronizados sem `production_collection_event` atual correspondente: 329 v2 e 142 v3. O dado exige reconciliação, mas não deve ser rotulado automaticamente como perda porque parte pode ser fixture ou resultado terminal cuja semântica ainda precisa ser reconstruída.

Os 142 recibos v3 possuem resultado JSON final: 59 declaram
`status=approved/decision=approved` e 83 declaram
`status=duplicated/decision=duplicated`. Todos guardam um `reading_id` que não
resolve para uma linha atualmente existente. A ausência é especialmente crítica
para os 59 resultados aprovados: o receipt afirma uma decisão comprometida, mas o
fato referenciado não está presente no ledger atual. Isso reprova a reconciliação
do snapshot, embora ainda não prove em qual etapa histórica a linha desapareceu.

Os checks atuais retornam:

- grupos de dupla aprovação: 0;
- `client_event_id` presente em dois pipelines: 0;
- evento aprovado sem ledger aprovado: 0;
- orphan outbox: 0;
- projeções duplicadas: 0.

Os dois últimos zeros são vacuamente verdadeiros porque outbox e `projection_applied` estão vazios. Eles não constituem PASS de integridade.

### 7.2 Evidência de capacity tests

`capacity_test_runs` contém zero linhas. A tabela também não possui trigger de imutabilidade e `service_role` conserva `UPDATE`, `DELETE` e `TRUNCATE`.

Em contraste, `private.capacity_test_fixture_objects` contém 534 objetos de um único run:

| Tipo | Contagem |
|---|---:|
| `production_piece` | 500 |
| `operator` | 14 |
| `machine` | 3 |
| `production_lot` | 1 |
| `production_order` | 1 |
| `cell_reference` | 7 |
| `machine_reference` | 8 |

Os registros foram criados entre `2026-09-02T16:52:34.899Z` e `16:52:36.464Z`; 519 estão marcados como criados pelo teste. A ausência do registro pai e de artefatos imutáveis impede reproduzir ou homologar o ensaio.

### 7.3 Indício de limpeza/reset

As estatísticas cumulativas mostram:

- `collection_projection_applied`: 0 atual, 1.177 inserts, 0 deletes;
- `collection_projection_outbox`: 0 atual, 149 inserts, 744 updates, 0 deletes;
- `production_lot_stage_counter_shards`: 0 atual, 119 inserts, 118 updates, 0 deletes.

Esse padrão é compatível com `TRUNCATE` ou outro reset que não incrementa `n_tup_del`; não é prova conclusiva. Deve ser correlacionado com `system_audit_logs`, migrations, runbooks e ações administrativas antes de atribuir causa.

## 8. Segurança, RLS, grants e advisors

### 8.1 Advisors oficiais

O advisor de segurança retornou 119 itens:

| Regra | Nível | Contagem |
|---|---|---:|
| RLS habilitada sem policy | INFO | 4 |
| extensão em `public` | WARN | 1 |
| tipo `reg*` incompatível com upgrade | WARN | 1 |
| SECURITY DEFINER executável por `anon` | WARN | 5 |
| SECURITY DEFINER executável por `authenticated` | WARN | 108 |

As quatro tabelas com RLS sem policy são `collection_processing_attempts`, `collection_projection_applied`, `collection_projection_outbox` e `password_recovery_requests`. Nas três primeiras o comportamento fail-closed para clientes é coerente com uso interno, mas ainda precisa ser documentado e testado.

As cinco funções SECURITY DEFINER acessíveis a `anon` são:

- `get_public_collection_micro_batch_release()`;
- `get_public_collection_release()`;
- `get_public_collection_runtime_health()`;
- `get_public_collection_sync_release()`;
- `get_public_replacement_release()`.

O alerta não prova vulnerabilidade em todas as 108 funções acessíveis a usuários autenticados. Cada uma precisa de justificativa, validação interna de autorização, teste positivo/negativo e grant mínimo.

O advisor de desempenho retornou 342 itens:

| Regra | Nível predominante | Contagem |
|---|---|---:|
| foreign key sem índice de suporte | INFO | 152 |
| chamada Auth em RLS sem initplan | WARN | 39 |
| índice sem scan desde o reset estatístico | INFO | 86 |
| policies permissivas sobrepostas | WARN | 61 |
| índices fisicamente duplicados | WARN | 3 |
| Auth com orçamento absoluto de conexões | INFO | 1 |

Nos objetos MES focais, 42 FKs não têm índice de suporte: 3 em receipts, 6 em outbox, 2 em cell assignments, 2 em machine assignments, 3 em sessions, 9 em entries, 1 em lots, 7 em pieces e 9 em readings. Isso é uma fila de investigação, não autorização para criar todos os índices.

### 8.2 SECURITY DEFINER e search path

| Schema | Funções | SECURITY DEFINER | Com `search_path=''` |
|---|---:|---:|---:|
| `public` | 251 | 208 | 2 |
| `private` | 21 | 14 | 0 |

Todas as funções SECURITY DEFINER têm algum `proconfig`, mas quase todas usam caminhos não vazios, como `public`, `private`, `extensions` e/ou `pg_temp`. Isso não satisfaz o requisito explícito do vNext de `SET search_path = ''` com referências totalmente qualificadas.

O inventário por overload, com owner, grants efetivos, classificação de
`search_path`, sinais estáticos de Auth/role/setor e SHA-256, está em
[`runtime-security-definer-inventory.md`](runtime-security-definer-inventory.md).
O SHA-256 de cada linha é o de `pg_get_functiondef` e foi revalidado contra o
manifesto canônico por objeto.
As 222 linhas permanecem `REVIEW_REQUIRED`: o manifesto fecha a enumeração, não
substitui justificativa semântica nem testes positivos/negativos.

### 8.3 Grants excessivos

| Tabela | Papel | Privilégios relevantes |
|---|---|---|
| `coletas_producao` | `authenticated` | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| `production_collection_events` | `anon` | REFERENCES, SELECT, TRIGGER, TRUNCATE |
| `production_collection_events` | `authenticated` | INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| `production_stage_readings` | `anon`, `authenticated` | todos, inclusive DELETE e TRUNCATE |
| `production_realtime_counters` | `anon`, `authenticated` | todos, inclusive DELETE e TRUNCATE |
| `offline_event_queue` | `anon`, `authenticated` | todos, inclusive DELETE e TRUNCATE |
| `production_lot_stage_aggregates` | `authenticated` | todos, inclusive DELETE e TRUNCATE |

RLS não protege `TRUNCATE`. Mesmo quando a Data API não expõe esse verbo diretamente, manter o privilégio amplia o impacto de SQL privilegiado, função mal protegida ou futuro endpoint administrativo.

### 8.4 Policies críticas

- `production_realtime_counters`: `SELECT` para `{anon, authenticated}` com `USING (true)`;
- `production_lot_stage_counter_shards`: `SELECT` para `authenticated` com `USING (true)`;
- `production_stage_readings`: INSERT permitido quando o papel produtivo é admin/manager/operator, sem checagem explícita de célula/setor na policy;
- `coletas_producao`: INSERT e SELECT próprios usam `auth.uid()` diretamente, gerando dois avisos `auth_rls_initplan`;
- events e leitura de readings usam helpers de escopo por célula, mas precisam de testes de vazamento entre setores.

`production_realtime_counters` inclui dimensões de lote, pedido, cliente, célula e máquina. O catálogo estabelece um caminho de leitura global/anon; um teste REST com papel `anon` ainda deve confirmar a configuração efetiva dos schemas expostos, sem acessar dados produtivos fora de staging.

### 8.5 Realtime authorization

`realtime.messages` tem RLS e cinco policies de SELECT para `authenticated`:

- `collection:cell:%`;
- `collection:device:%`;
- `collection:event:%`;
- `production:cell:%`;
- `replacement:cell:%`.

As policies de coleta validam sessão, assignment ou propriedade do receipt. Contudo, o namespace não carrega setor e diverge do alvo `mes:<sector_id>:...`. Não foram encontradas policies de INSERT para clientes, o que é coerente com publicação interna por serviço.

## 9. Conexões e baseline PostgreSQL

### 9.1 Orçamento conhecido

| Configuração | Valor |
|---|---:|
| `max_connections` | 60 |
| `superuser_reserved_connections` | 3 |
| `reserved_connections` | 0 |
| orçamento máximo atual do Auth | 10, absoluto |

O advisor oficial confirma que o Auth usa no máximo dez conexões e recomenda estratégia percentual antes de escalar compute. O limite teórico restante após reserva de superuser e Auth é 47, mas isso ainda não desconta PostgREST, Realtime, manutenção, safety headroom ou conexões por worker. Portanto não há base para definir `worker_slots_max` neste momento.

### 9.2 Snapshot de atividade

No corte principal havia sete conexões, 11,7% de `max_connections`:

| `application_name` | Estado | Quantidade |
|---|---|---:|
| PostgREST | idle | 2 |
| management API | active | 1 |
| `pg_net` worker | idle | 1 |
| postgres exporter | idle | 1 |
| `pg_cron` scheduler | ativo | 1 |
| não informado | idle | 1 |

- `idle in transaction`: 0;
- locks não concedidos: 0;
- locks concedidos observados: 10 `AccessShareLock` em relação e 1 `ExclusiveLock` em virtual XID.

É apenas uma fotografia. Ela não prova uso sustentado abaixo de 70%, pico abaixo de 85% ou ausência de starvation de Auth/Realtime.

### 9.3 Settings relevantes

| Setting | Valor |
|---|---:|
| `shared_buffers` | aproximadamente 224 MiB |
| `effective_cache_size` | aproximadamente 384 MiB |
| `work_mem` | 2.184 kB |
| `maintenance_work_mem` | 32 MiB |
| `statement_timeout` global | 120 s |
| `lock_timeout` global | 0 |
| `idle_in_transaction_session_timeout` global | 0 |
| autovacuum | on, 3 workers |
| `max_worker_processes` | 6 |
| `max_parallel_workers` | 2 |
| `max_parallel_workers_per_gather` | 1 |
| `track_io_timing` | off |
| `track_functions` | none |

Configurações por papel:

- `anon`: `statement_timeout=3s`;
- `authenticated`: `statement_timeout=8s`;
- `authenticator`: `statement_timeout=8s`, `lock_timeout=8s`;
- `supabase_auth_admin`: `idle_in_transaction_session_timeout=60s`.

### 9.4 Estatísticas cumulativas do banco

`pg_stat_database` foi resetado em `2026-05-22T15:13:20.516Z`:

| Métrica acumulada | Valor |
|---|---:|
| `xact_commit` | 7.797.871 |
| `xact_rollback` | 211.694 |
| deadlocks | 218 |
| temp files | 161.172 |
| temp bytes | 565.529.263.975 |
| sessões | 336.055 |
| sessões killed | 6 |
| sessões abandoned | 161 |
| conflitos | 0 |

Esses números não pertencem ao smoke ou a qualquer ensaio isolado. Cada capacity run deve persistir snapshots antes/depois e calcular apenas deltas.

## 10. pg_stat_statements e EXPLAIN

### 10.1 Statements cumulativos

`pg_stat_statements` foi resetado em `2026-05-31T21:08:07Z`. A extensão expõe min/mean/max/desvio, não p95/p99.

| Operação | Calls | Mean ms | Max ms |
|---|---:|---:|---:|
| `process_collection_inbox_item` legado | 4.461 | 1.608,929 | 37.308,411 |
| snapshot de dashboard | 4.140 | 696,843 | 7.884,025 |
| ingest v3 | 75 | 823,258 | 5.662,532 |
| process decision v3 | 35 | 1.413,969 | 7.274,154 |
| claim decision v3 | 89 | 492,981 | 6.084,673 |
| process projection v3 | 37 | 1.977,046 | 7.588,570 |
| claim projection v3 | 53 | 193,465 | 2.885,516 |

O worker legado acumulou aproximadamente 7.177.434 ms de execução, 6.019.313 shared hits, 199.579 WAL records e 43.182.733 WAL bytes. Os dados corroboram gargalo, mas não substituem percentis por run.

### 10.2 EXPLAIN seguro

Foram executados apenas `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` de consultas SELECT com valores inexistentes. Nenhuma RPC mutável foi executada.

| Consulta | Plano | Execution time | Buffers |
|---|---|---:|---:|
| receipt por `client_event_id` | Index Scan em `coletas_producao_client_event_id_key` | 0,087 ms | 2 shared hits |
| sessão por `token_hash` | Index Scan em `idx_operator_sessions_token_hash` | 2,402 ms | 2 shared hits |
| outbox due | Index Scan em `idx_collection_projection_outbox_due` | 0,076 ms | 1 shared hit |
| peça por `traceability_code OR piece_uid` | Seq Scan em 40 linhas | 4,869 ms | 5 shared hits |

O Seq Scan de peça é plausível para uma tabela com apenas 40 linhas atuais. Ele não permite extrapolar o plano de staging com cardinalidade industrial. O planejamento dessa consulta consumiu 13,144 ms no corte observado.

O plano de sessão escolheu o índice não único `idx_operator_sessions_token_hash`, embora exista `operator_sessions_token_hash_key`. Os dois devem ser revisados como potencial duplicidade, sem remoção antes de medir.

O advisor também detectou três pares de índices duplicados:

- `production_lots`: `idx_lots_lot_code_context` e `idx_production_lots_lot_code`;
- `production_lots`: `idx_lots_production_order` e `idx_production_lots_production_order_id`;
- `quality_nonconformities`: `idx_qnc_piece_id` e `idx_quality_nonconformities_piece_id`.

`production_pieces` possui pares normal/UNIQUE em `piece_uid` e `traceability_code`; precisam de comparação de opclass, predicado e uso antes de qualquer alteração.

## 11. Estatísticas de relações, vacuum e tamanho

As porcentagens abaixo usam `n_live_tup`/`n_dead_tup`; são estimativas estatísticas, não medição de bloat por `pgstattuple`.

| Relação | Tamanho | Live | Dead | Dead estimado |
|---|---:|---:|---:|---:|
| `system_audit_logs` | 81,48 MB | 50.439 | 214 | 0,42% |
| `coletas_producao` | 4,84 MB | 703 | 150 | 17,58% |
| `production_collection_events` | 1,42 MB | 83 | 28 | 25,23% |
| `production_entries` | 0,54 MB | 80 | 21 | 20,79% |
| `production_stage_readings` | 0,41 MB | 83 | 56 | 40,29% |
| `operator_sessions` | 0,28 MB | 206 | 25 | 10,82% |
| `production_lots` | 0,27 MB | 4 | 23 | 85,19% |
| `production_pieces` | 0,25 MB | 40 | 29 | 42,03% |
| `production_realtime_counters` | 0,08 MB | 8 | 13 | 61,90% |
| `production_lot_stage_aggregates` | 0,10 MB | 8 | 39 | 82,98% |

O autovacuum está ativo e rodou recentemente nas tabelas quentes. Os percentuais altos em lotes, counters e aggregates ocorrem sobre tamanhos absolutos pequenos. Não há evidência atual que justifique particionamento.

`system_audit_logs` é a maior tabela do banco e teve último autoanalyze observado em `2026-07-27T03:20:42Z`; merece avaliação de analyze/planos, sem apagar histórico.

`operator_sessions` acumulou 90.856 updates, dos quais 90.594 foram HOT, sugerindo heartbeat muito frequente mas com boa taxa HOT no layout atual.

## 12. Auth, sessões e Realtime

### 12.1 Sessões operacionais

| Métrica sanitizada | Valor |
|---|---:|
| sessões históricas | 206 |
| abertas e não revogadas | 4 |
| abertas, não revogadas e ainda não expiradas | 2 |
| expiradas mas ainda abertas | 2 |
| revogadas | 30 |
| encerradas | 202 |
| ativas com `last_seen_at` anterior a 5 min | 2 |
| usuários com mais de uma sessão ativa | 1 |
| máximo de sessões ativas por usuário | 2 |
| usuários Auth distintos no histórico | 2 |
| device IDs distintos no histórico | 27 |

Nenhum identificador foi exportado. O estado reforça a necessidade de distinguir sessão Auth, sessão operacional, expiração e heartbeat degradado.

### 12.2 Logs de Auth

A amostra mais recente continha 40 linhas:

- 39 `info` e 1 `warning`;
- 29 respostas HTTP 200 e 1 resposta 400;
- 19 chamadas `/user` e 11 chamadas `/token`.

O campo bruto `duration` não teve unidade confirmada pela documentação recuperada. Para `/token`, p95 bruto foi `3.520.081.763` e máximo `7.590.684.253`. Se a unidade interna for nanossegundos, a inferência seria aproximadamente 3,52 s de p95; essa conversão não é usada como gate até haver confirmação oficial ou instrumentação explícita em milissegundos.

### 12.3 Logs de Realtime

Em 95 linhas recentes foram encontrados, por palavra-chave:

- connect: 36;
- disconnect: 10;
- timeout: 5;
- broadcast: 5;
- error: 1.

A amostra não fornece denominador, causa da desconexão, reconexão por cliente ou percentis de lag. Não é possível calcular `realtime_reconnect_total`, `realtime_stale_seconds` ou logout involuntário a partir dela.

## 13. Edge Functions e Vault

### 13.1 Inventário de versões

| Edge Function | Versão | `verify_jwt` |
|---|---:|---:|
| `sendDailyClosure` | 13 | true |
| `syncResendContact` | 5 | true |
| `promob-parse-order` | 10 | true |
| `promob-api-sync` | 3 | true |
| `send-scheduled-reports` | 17 | false |
| `promob-import-xml` | 9 | true |
| `generate-productive-backup` | 7 | true |
| `schedule-report-job` | 2 | true |
| `send-report-email` | 8 | true |
| `sync-google-drive-archive` | 5 | true |
| `admin-users` | 10 | true |
| `recover-password` | 4 | false |
| `archive-production-history` | 1 | false |
| `process-collection-inbox` | 4 | false |
| `process-collection-v3` | 2 | false |
| `project-collection-v3` | 2 | false |

Os três workers de coleta com `verify_jwt=false` validam um segredo compartilhado por header/RPC e criam cliente de serviço no runtime. Os valores não foram lidos. O código retornou `Access-Control-Allow-Origin: *` e não evidenciou nonce, proteção contra replay ou rate limit no endpoint interno.

`process-collection-inbox` continua chamando `process_collection_inbox_item` uma vez por evento, com concorrência máxima 2. Em 29 invocações recentes observadas, todas HTTP 200, o execution time foi:

- p50: 972 ms;
- p95: 55.701 ms;
- p99: 70.642 ms;
- máximo: 72.710 ms.

HTTP 200 apenas confirma resposta do wrapper; não prova decisão dentro do SLO.

### 13.2 Arquitetura observada nas funções v3

- `ingest_collection_batch_v3` resolve Auth uma vez e insere receipts set-based, mas depois itera por evento para `pgmq.send`, update do receipt e Broadcast. O ACK retorna após essas etapas.
- O batch máximo é 25 e o payload máximo é 262.144 bytes.
- `process_collection_batch_v3` contém a regra de domínio diretamente; não há uma função canônica privada por receipt compartilhada com um RPC síncrono.
- O projetor itera por item, faz upsert por evento e também executa atualizações legadas de counters, entries, events, lot items, progresso PCP e Broadcast.
- As Edge Functions adquirem a lease global por 45 segundos, processam até cinco rodadas e liberam; não renovam o lease nem interrompem escrita ao detectar perda do lease.

### 13.3 Nomes no Vault

Somente os nomes foram inventariados:

- `acprod_archive_cron_secret`;
- `acprod_archive_cron_url`;
- `acprod_collection_v3_decision_url`;
- `acprod_collection_v3_projection_url`;
- `acprod_collection_worker_secret`;
- `acprod_collection_worker_url`;
- `acprod_reports_cron_secret`;
- `acprod_reports_cron_url`.

Nenhum valor, versão material ou token foi consultado ou registrado.

## 14. Limitações e dados indisponíveis

O conector e a inspeção read-only não forneceram:

- tier e custo do compute;
- budgets máximos configurados de PostgREST, Realtime e manutenção;
- métricas históricas de Supavisor, inclusive `pool_wait_ms`;
- séries temporais de saturação de conexões;
- p95/p99 de `pg_stat_statements`;
- unidade oficial do campo `duration` dos logs Auth;
- causa de disconnect e identidade de reconnect no Realtime;
- métricas WAN, Wi-Fi/4G ou ACK local de IndexedDB;
- estado do frontend/PWA no navegador;
- evidência do deploy externo Cloudflare;
- bloat físico por `pgstattuple`;
- um staging representativo em cardinalidade e distribuição;
- artefatos e hashes de capacity runs, pois `capacity_test_runs` está vazio.

Por segurança, não foi executado `EXPLAIN ANALYZE` em RPCs mutáveis nem qualquer teste de carga. A ausência de dado foi marcada como não comprovada, nunca como zero ou PASS.

## 15. Regras para o próximo baseline

Antes de qualquer ensaio:

1. persistir `run_id`, commit, migrations, versões de Edge/worker, compute, pools, flags e thresholds;
2. capturar `pg_stat_database`, `pg_stat_statements`, locks, filas, sessões e conexões antes do run;
3. usar métricas próprias para percentis, porque `pg_stat_statements` não fornece p95/p99;
4. medir deltas de deadlock, timeout, rollback, temp bytes e WAL após o run;
5. reconciliar receipt, decisão, ledger, outbox, aplicação de projeção, snapshots, DLQ e archive;
6. finalizar o run de forma imutável e anexar hashes auditáveis;
7. nunca interpretar queue depth zero como sucesso isolado;
8. manter todas as flags v3/vNext desligadas enquanto qualquer gate crítico estiver pendente.

## 16. Referências oficiais

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase — Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase — PGMQ Extension](https://supabase.com/docs/guides/queues/pgmq)
- [Supabase — Connection management](https://supabase.com/docs/guides/database/connection-management)
- [Supabase — Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase — Database linter](https://supabase.com/docs/guides/database/database-linter)

## 17. Manifesto GO/NO-GO deste snapshot

| Gate | Resultado | Evidência |
|---|---|---|
| flags desligadas | PASS | 4/4 `false` |
| `lost_receipts = 0` | NÃO COMPROVADO | ausência de capacity run e 471 receipts sem evento atual |
| `double_approvals = 0` | PASS apenas para o estado atual | 0 grupos literais/normalizados nas linhas existentes |
| `duplicate_projections = 0` | NÃO COMPROVADO | tabela `projection_applied` vazia após histórico de inserts |
| `untreated_dlq = 0` | NÃO COMPROVADO | recovery audit registra 58 requeues, mas não há outbox/applied atual correlacionável |
| `cross_sector_leak = 0` | NÃO COMPROVADO; controle de catálogo reprovado | counter público/anon com `USING (true)`; teste de vazamento efetivo ainda pendente |
| deadlocks/timeouts do run = 0 | NÃO COMPROVADO | só existem contadores cumulativos |
| SLOs de ACK/decisão/projeção | NÃO COMPROVADO | sem run atual; médias cumulativas acima do alvo |
| Auth sem starvation/logout involuntário | NÃO COMPROVADO | pools e causalidade dos logs indisponíveis |
| worker horizontal | FAIL | lease global por `worker_kind`, sem slots |
| evidência imutável | FAIL | `capacity_test_runs=0`, sem trigger de imutabilidade |

**Conclusão:** manter **NO-GO**, preservar todas as evidências remanescentes e não habilitar nenhuma flag antes de corrigir os bloqueadores, executar ensaios reais em ambiente permitido e emitir um novo `run_id` reconciliado.

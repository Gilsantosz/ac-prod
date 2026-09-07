# AC-Prod2 MES vNext — manifesto de evidências

**Data da auditoria:** 2026-09-04

**Início da consolidação deste manifesto:** `2026-09-04T15:38:33Z`

**Repositório:** `Gilsantosz/ac-prod`

**Projeto Supabase:** `uozuzdfvnufsjsonswag`

**Base Git auditada:** `9174c796df4fa008507e727eb35cce63b3e4a08f`

**Branch de trabalho:** `codex/mes-vnext-audit-20260904`

**Classificação:** evidência de Fase Zero; não é homologação de capacidade e não autoriza merge, ativação de flag, shadow, canário ou rollout.

## 1. Finalidade e cadeia de custódia

Este manifesto identifica a origem, o corte temporal, o método de fingerprint e
as limitações das evidências usadas na auditoria MES vNext. Ele não contém
valores de secrets, credenciais, payload produtivo nem identificadores pessoais
ou operacionais sensíveis do MES. IDs públicos de PR, review, comentário e
check permanecem no snapshot GitHub para rastreabilidade.

As fontes foram mantidas separadas:

| Fonte | Método | Escopo | Mutação realizada |
|---|---|---|---|
| Git local | Worktree criada a partir de `origin/main`; inspeção de commits, árvore e arquivos | Código, migrations, Edge Functions e documentação | Nenhuma alteração em `main`; somente relatórios nesta branch |
| GitHub | Consulta read-only da PR #63, commits, reviews e checks | Estado da PR e URLs de checks | Nenhuma escrita, review, merge ou rerun |
| Supabase | Conector oficial em modo somente leitura | Catálogo, estatísticas, migrations, flags, filas, Edge Functions e nomes no Vault | Nenhum DDL/DML, deploy, teste, alteração de flag ou leitura de valor de secret |
| Documentação oficial | Páginas oficiais Supabase e PostgreSQL | Semântica atual da plataforma | Nenhuma alteração externa |

O checkout original do usuário, que continha mudanças não relacionadas, foi preservado. A inspeção Git usou a worktree isolada `/private/tmp/ac-prod-mes-vnext-audit`.

## 2. Cortes temporais

Os horários abaixo são os cortes efetivamente registrados no relatório de runtime. Todos estão em UTC.

| Evidência runtime | Corte UTC |
|---|---:|
| Baseline principal de atividade e banco | `2026-09-04T14:55:56.608Z` |
| Advisors de segurança | `2026-09-04T15:12:46.423Z` |
| Advisors de desempenho | `2026-09-04T15:12:50.339Z` |
| Sessões operacionais | `2026-09-04T15:15:30.644Z` |
| Estatísticas e tamanhos de relações | `2026-09-04T15:16:20Z` |
| Manifesto de migrations | `2026-09-04T15:17:35.181Z` |
| Feature flags | `2026-09-04T15:18:12.948Z` |
| Filas PGMQ | `2026-09-04T15:18:39.907Z` |
| Revalidação SHA-256 das dez funções críticas | `2026-09-04T16:14:52Z` |
| Captura literal das três relações runtime-only críticas | `2026-09-04T16:15:41.223630Z` |
| Captura literal das três funções críticas de reposição | `2026-09-04T16:22Z` |
| Manifesto canônico por objeto (`public`/`private`) | `2026-09-04T17:00:15.842077Z`–`17:00:22.607320Z` |
| Execução integral dos probes versionados | `2026-09-04T17:01:43.978652Z` |
| Revalidação dos 222 hashes `SECURITY DEFINER` | `2026-09-04T17:05:35.669550Z` |

Fonte: [baseline do runtime](02-runtime-baseline-and-catalog.md#1-escopo-método-e-corte-temporal).

O baseline runtime, portanto, não é atômico: sua janela principal vai de
`2026-09-04T14:55:56.608Z` a `2026-09-04T15:18:39.907Z`, com uma revalidação
pontual de funções às `16:14:52Z`, de relações às `16:15:41.223630Z` e dos
caminhos de reposição às `16:22Z`. Mudanças concorrentes entre cortes podem
gerar diferenças entre categorias. Nenhum contador cumulativo foi atribuído a
um ensaio isolado.

O manifesto por objeto foi capturado por duas consultas ordenadas no intervalo
de 6,8 segundos indicado acima. Ele não é um snapshot transacional único; essa
limitação está gravada no próprio artefato.

Depois da captura, o arquivo completo de probes foi executado com sucesso
contra o runtime. A validação comprova sintaxe/resolução no corte, mas os
`EXPLAIN ANALYZE` usam sentinels inexistentes e não são benchmark.

Para Git/GitHub:

| Evidência | Horário disponível |
|---|---:|
| Commit de `origin/main` auditado | commit em `2026-09-03T14:08:12-03:00` |
| Merge-base da PR #63 | commit em `2026-09-02T11:43:38-03:00` |
| Head auditado da PR #63 | commit em `2026-09-03T11:42:20-03:00` |
| Consulta do estado da PR/reviews/checks | snapshot registra `2026-09-04T16:30:00Z` com precisão declarada de minuto; instante exato da chamada não exportado |
| Consulta das fontes oficiais | 2026-09-04; horários individuais não exportados |

Os links de PR e checks são recursos vivos. Seu estado futuro pode divergir do
estado descrito nesta auditoria. Um snapshot REST sanitizado foi versionado em
[`github-pr63-snapshot.json`](github-pr63-snapshot.json); ele não é assinado e
omite conteúdo/identidade, mas preserva URLs, SHAs, posições e estados.
O snapshot preserva duas anomalias da fonte: os jobs skipped “Publicar GitHub
Pages” e “Gerar artefato do release comprovado” têm `completed_at` um segundo
anterior a `started_at`. Os valores não foram normalizados e não são usados
para calcular duração.

## 3. Identidade Git e GitHub

### 3.1 Referências imutáveis verificadas localmente

| Referência | SHA completo | URL |
|---|---|---|
| `origin/main` auditada | `9174c796df4fa008507e727eb35cce63b3e4a08f` | [commit](https://github.com/Gilsantosz/ac-prod/commit/9174c796df4fa008507e727eb35cce63b3e4a08f) |
| Merge-base da PR #63 | `111501f503cc6c2c61b1c768c5f1dcc8901ba120` | [commit](https://github.com/Gilsantosz/ac-prod/commit/111501f503cc6c2c61b1c768c5f1dcc8901ba120) |
| Head auditado da PR #63 | `95f95df7ff83c3f37d997c62ba64c55d374be23b` | [commit](https://github.com/Gilsantosz/ac-prod/commit/95f95df7ff83c3f37d997c62ba64c55d374be23b) |

O conjunto de 11 commits entre o merge-base e o head auditado, em ordem, é:

```text
95a5af375ff7f4ec6c3685cdcfce8a6835d32268
a98a487fadeac23ed5bbf3b0d1d4e85a4ff3e7be
f291524cb28cf9f3b4a955c3f740e9a67537ea3d
ac1a6d9f43ca5125b822ac5fcb71bd907f0bba49
bf44a33e9c28fc016b0192b91e264a5c10a21df2
33ec8822ba1f42ff36dc1a8a7127ed934b97aed7
3e477a2c3b367ce89257b50e5ff79ff45339b917
a685fdd3cb6a6fe2ee982058412df905261b351e
4f3a29de3ecc54d1747a5c190b9cd7a646f62352
5d901dc41d9af10aedce9c8953baafc5c70f4736
95f95df7ff83c3f37d997c62ba64c55d374be23b
```

### 3.2 PRs e checks

- [PR #63 — `fix/auth-realtime-capacity-20260902`](https://github.com/Gilsantosz/ac-prod/pull/63)
- [PR #64 — mudança posterior já presente na `main`](https://github.com/Gilsantosz/ac-prod/pull/64)
- [Check Security](https://github.com/Gilsantosz/ac-prod/actions/runs/33768438262)
- [Check Replacement validation](https://github.com/Gilsantosz/ac-prod/actions/runs/33768438153)
- [Check Deploy](https://github.com/Gilsantosz/ac-prod/actions/runs/33768438255)
- [Check externo Cloudflare Workers build](https://dash.cloudflare.com/ba7c0b12a6721edd8f4395e4b49da264/workers/services/view/ac-prod2/production/builds/a357b5d2-06d4-416b-8b92-a2b5aa745840)

No corte registrado, a PR #63 estava aberta, não-draft, não mesclada, com head `95f95df7ff83c3f37d997c62ba64c55d374be23b`, sem review aprovado e com o check externo Cloudflare em falha. O resultado detalhado está em [Git, PR #63 e drift](03-git-pr63-and-runtime-drift.md#estado-revalidado-da-pr-63).

## 4. Convenção de hashes

### 4.1 MD5 do runtime

Os valores MD5 do relatório de runtime são fingerprints de drift calculados sobre linhas ordenadas e serializadas a partir do catálogo PostgreSQL. Eles servem para detectar mudança acidental; não são assinatura criptográfica, prova de autoria ou mecanismo de proteção de segredo.

Conforme a categoria, a serialização incluiu:

- colunas: schema, relação, posição, nome, tipo, nulabilidade, default, identity e generated;
- constraints/FKs: nome, tipo e `pg_get_constraintdef`;
- índices: nome e `pg_get_indexdef`;
- triggers: nome e `pg_get_triggerdef`;
- funções: assinatura, owner, ACL, `proconfig` e `pg_get_functiondef`;
- views: nome e `pg_get_viewdef`;
- policies: schema, tabela, nome, modo, roles, comando, `USING` e `WITH CHECK`;
- relações: tipo, owner e ACL.

O SQL exato, incluindo separadores, escaping, normalização de `NULL` e encoding, não foi exportado como artefato. Assim, os MD5 históricos identificam o snapshot, mas não podem ser reproduzidos byte a byte apenas com esta descrição. Uma nova captura deve versionar a consulta/serializador antes de comparar digests.

### 4.2 SHA-256 agregado

Os SHA-256 registram agregados/exportações ou o corpo completo de uma definição específica. Eles não são diretamente comparáveis aos MD5 do catálogo, porque algoritmo, conjunto de campos e serialização são diferentes.

- **MD5 runtime:** fingerprint operacional compacto, calculado sobre uma categoria do catálogo no corte correspondente.
- **SHA-256 agregado:** fingerprint de um manifesto/exportação ordenada ou de uma definição literal.
- **SHA-256 abreviado com reticências:** somente referência visual; não é checksum verificável e não pode entrar em gate.

Hash não anonimiza dado de baixa entropia. E-mail, matrícula, token, identificador operacional ou secret não devem ser publicados nem mesmo como MD5/SHA sem uma análise específica; ataques por dicionário continuam possíveis.

## 5. Fingerprints conhecidos

### 5.1 Catálogo runtime — MD5

| Schema/conjunto | Categoria | Contagem | MD5 |
|---|---|---:|---|
| `public` | manifesto de relações | 124 | `644c2e44e52cb42773e7844e59106b09` |
| `private` | manifesto de relações | 7 | `3ee8a3f153534779756740ac39fee981` |
| `public` | colunas | 2.002 | `b9a0d97d60e38689483a9337b182bc4e` |
| `public` | constraints | 572 | `9b7fb020ed339e492f6a0833eba99f8d` |
| `public` | foreign keys | 261 | `6be77e87eaad6285f788b6da7f44e2f5` |
| `public` | índices | 429 | `36f70042e06cf0cc5b30b86faa76db00` |
| `public` | triggers de usuário | 89 | `1a62c64d99bce5f6e76244ff65df351c` |
| `public` | policies | 257 | `6dad7fc8c814a0b224a5d511fce79e09` |
| `public` | owner/ACL de relações | 124 | `3191048a241ea764d054c97900b04b9c` |
| `public` | funções | 251 | `ff7bd4705994a62ed40bc27b86ef5393` |
| `public` | views | 9 | `8cfcd55d21ecc113c5468f5058d0575e` |
| `private` | colunas | 48 | `c95d42072b384dd08d031abbf4c8f3e7` |
| `private` | constraints | 14 | `e5e4cb40dd77f2cf414e279ff716bd94` |
| `private` | foreign keys | 2 | `b4fa367185405de2e4651587b058f827` |
| `private` | índices | 7 | `de3d33306669b8de405df5eb52309212` |
| `private` | owner/ACL de relações | 7 | `900e1f88bdcc5333b9cf06e0a27ccb5e` |
| `private` | funções | 21 | `f68b4c7007a4ce4d6c0a9c4276a9216c` |
| Realtime | publicação `supabase_realtime`, 34 relações | 34 | `e706d9d62f2210b86405d71ce64e0a2e` |
| Realtime | publicação de `realtime.messages` | 1 | `ab8e7bb1ca25b0791ce021242e726d7d` |
| `public/private/realtime/pgmq` | grants de tabela | 3.181 | `0c18a1be6d398d9ad5c36e81f7a60341` |
| `public/private/pgmq` | grants de rotina | 813 | `886223ab7a45ab56d780002e9452bdfe` |
| `realtime` | policies | 5 | `9c2a6cc11be117b87d34f94d61619caf` |
| global + quatro schemas | default ACLs | 11 | `ea48bc65a53ff301a617b37e1f949975` |

### 5.2 Migrations, releases e flags

| Conjunto | Itens/corte | Algoritmo | Fingerprint |
|---|---|---|---|
| Runtime `version\|name` | 154 migrations; `20260601004505` a `20260903165317` | MD5 | `72acc71f1bdae2842c3ab6ed3be50752` |
| Runtime `version\|name\|statements` | mesmas 154 migrations | MD5 | `76906f0f975f7cefb715049201fd5f09` |
| `app_schema_releases` | 31 registros | MD5 | `04745be0d90b1a00e7f631ec174c1cbe` |
| Quatro flags v3 | todas `false` no corte `2026-09-04T15:18:12.948Z` | MD5 | `c67cec81ecce971f91354d3147c16fe6` |
| Escopo comum das flags | conteúdo não exportado; somente fingerprint | MD5 | `a3ba8e3d9fe3dfcc09b52b2d13d417bf` |
| Lista ordenada de migrations locais | 167 arquivos na `main` auditada | SHA-256 | `c80eff21d5ab4c69b583cec394ad49abe9386de6c3965c01e68be287b41cf7bf` |
| Ledger runtime exportado | version, nome, statements, autor e idempotência | SHA-256 | `1ade58c0db5575753e552c8055e2ddcfbdf02a0a114337f2b83cfb6039d3895b` |

Os dois SHA-256 agregados foram registrados no relatório de drift, mas o serializador/comando exato não foi anexado. Eles identificam a comparação já feita; uma recaptura deve gerar novo artefato canônico em vez de tentar reproduzir o digest por aproximação.

### 5.3 Definições runtime

| Objeto | SHA-256 integral | Estado da evidência |
|---|---|---|
| `public.process_production_reading_impl_v2(jsonb)` | `5f4913b9c65d1f771792eee1434cdbc4efd475bc2c87b530270bb4f9ba41304d` | Hash e corpo literal capturados |
| `public.finalize_collection_realtime(text,jsonb)` | `dea35ae9cda03a48fa865ef26f582dd7e8215a55cb7a30b8c91d71753a965332` | Hash e corpo literal capturados |
| `public.sync_production_lot_stage_aggregate()` | `36a3239efdf67f4123e7ca6893682870f0845e26eaaa595e327650e1010312b1` | Hash e corpo literal capturados |
| `public.sync_reading_to_event()` | `acf359419786cd589e318c488878d720c3d918b44ffc521978f862f65ffc0556` | Hash e corpo literal capturados |
| `public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)` | `794189465651570ecca58ce94b189a9e8134a06bddd9e8fa1a2e5df01f855f01` | Hash e corpo literal capturados |
| `public.refresh_collection_lot_state(uuid,uuid)` | `e0ed07c2513c4939650a0fb2c011cd5b446e51a24cc2a1ba10ead7d12e51e290` | Hash e corpo literal capturados |
| `public.resolve_production_stage_for_cell(uuid,text)` | `0b12c3c66e86f7fb2198f4362e7b97c789a44dcc5de3efb4e8819991e2917692` | Hash e corpo literal capturados |
| `public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid,timestamptz,text)` | `9582ae4b912b67bb3253338d35e3a49cb0aebcb66cdbab623f0f950cee857c95` | Hash e corpo literal capturados |
| `public.reset_production_data()` | `5c48ab503c2e62e0826282349913939675f0765c2da5b011749d84f6f0bda189` | Hash e corpo literal capturados |
| `public.reset_production_data_impl()` | `70325831ca824de351920169ab60deda636c61985503c44236ac712bcef69e25` | Hash e corpo literal capturados |
| `public.approve_piece_replacement(uuid,jsonb)` | `7eab3af5573ac3c6f0fb913307fd386cb963067ddb66c4660fd58f225d531516` | Hash e corpo literal capturados |
| `public.force_complete_piece_replacement(uuid,text,jsonb)` | `f2bc1f2948be690e5fa0de903acc253a7aac285c6cc81ecafe4b0aea12af0a1a` | Hash e corpo literal capturados |
| `public.force_complete_piece_replacement_impl(uuid,text,jsonb)` | `457dd6fd384ebfd140581346d0ec25845c8e2faea6bc89ebb5f240c1f7cc289a` | Hash e corpo literal capturados |

Os hashes foram recalculados em consultas read-only posteriores à primeira
consolidação, com owner e `proconfig` verificados. Os treze corpos literais foram
preservados em
[`runtime-critical-function-definitions.sql.txt`](runtime-critical-function-definitions.sql.txt),
após screening de strings sensíveis. Antes de alterar essas funções, revisar
assinatura, owner, ACL, `proconfig`, dependências e triggers; o arquivo é
evidência de drift, não migration de desired state.

Todas as 222 funções `SECURITY DEFINER` de `public`/`private` foram enumeradas
por overload em
[`runtime-security-definer-inventory.md`](runtime-security-definer-inventory.md).
Esse artefato registra metadados/hashes e prioridade de triagem, mas conserva
`REVIEW_REQUIRED` até a revisão semântica e os testes exigidos. Os hashes de
definição usam `pg_get_functiondef` e foram revalidados contra o manifesto
canônico por objeto.

O manifesto
[`runtime-object-manifest.json`](runtime-object-manifest.json) contém 131
relações e 272 rotinas de `public`/`private`, uma entrada por objeto/overload.
Seu serializador canônico v1 está integralmente versionado em
[`runtime-read-only-probes.sql`](runtime-read-only-probes.sql): usa SHA-256,
delimitadores explícitos e ordenação determinística. Ele registra somente
metadados e hashes; não substitui o inventário de grants efetivos nem a revisão
semântica de autorização.

## 6. Inventários por nome

Por solicitação de minimização, esta seção registra somente nomes. Versões, configuração, payloads, mensagens e valores não fazem parte deste manifesto.

### 6.1 Edge Functions

```text
admin-users
archive-production-history
generate-productive-backup
process-collection-inbox
process-collection-v3
project-collection-v3
promob-api-sync
promob-import-xml
promob-parse-order
recover-password
schedule-report-job
send-report-email
send-scheduled-reports
sendDailyClosure
sync-google-drive-archive
syncResendContact
```

### 6.2 Filas PGMQ

```text
collection_dead_letter_v3
collection_live_v3
collection_projection_v3
collection_replay_v3
```

Nenhum payload, `msg_id`, identificador de evento ou conteúdo de archive/DLQ foi exportado neste manifesto.

### 6.3 Entradas do Vault

```text
acprod_archive_cron_secret
acprod_archive_cron_url
acprod_collection_v3_decision_url
acprod_collection_v3_projection_url
acprod_collection_worker_secret
acprod_collection_worker_url
acprod_reports_cron_secret
acprod_reports_cron_url
```

Somente os nomes foram consultados. Valores, ciphertext, versões materiais, tokens e metadados capazes de revelar conteúdo não foram lidos nem registrados.

## 7. Regras de sanitização

Todo artefato desta auditoria deve obedecer às regras seguintes:

1. Não registrar e-mail, matrícula completa, nome pessoal desnecessário, UUID de operador/sessão/dispositivo/evento, IP, barcode/tag real ou payload produtivo.
2. Não registrar JWT, access token, refresh token, credencial/chave do papel
   `service_role`, senha, `x-cron-secret`, connection string, cookie, header
   de autorização ou conteúdo do Vault. O nome simbólico de um papel pode
   constar no catálogo de ACL/grants.
3. Não executar comandos que imprimam `.env`, variáveis de credencial, configuração completa de cliente ou logs HTTP com headers.
4. Consultas de inventário devem projetar somente nomes, contagens, timestamps, flags não sensíveis e digests calculados no servidor. Nunca usar `SELECT *` em Vault, Auth, filas, sessions ou payloads.
5. Mensagens de erro devem ser reduzidas a códigos/SQLSTATE sanitizados; não copiar parâmetros, tokens ou dados produtivos incorporados no texto.
6. Usar UTC em cortes temporais e declarar quando várias consultas formarem uma janela não atômica.
7. Tratar hashes como identificadores de artefato, não como anonimização. Não publicar hash não salgado de PII ou segredo de baixa entropia.
8. Antes de anexar stdout/stderr, revisar redaction e remover paths de usuário quando não forem necessários. Este manifesto mantém apenas o path da worktree isolada para reprodutibilidade local.
9. URLs de commits, PRs e checks podem ser registradas; URLs assinadas, temporárias, com query token ou credencial incorporada não podem.
10. Relatórios finais devem conter apenas métricas agregadas. Evidência detalhada sensível deve permanecer em armazenamento controlado, com acesso e retenção definidos fora do repositório.

## 8. Reprodução read-only e segura

Os comandos abaixo não alteram banco, PR, flags ou arquivos. Eles não imprimem credenciais quando executados em um ambiente já autenticado. A recaptura representa o estado no novo horário, não recria o snapshot histórico.

### 8.1 Git local

```bash
git status --short --branch
git rev-parse HEAD
git merge-base 9174c796df4fa008507e727eb35cce63b3e4a08f 95f95df7ff83c3f37d997c62ba64c55d374be23b
git rev-list --reverse 111501f503cc6c2c61b1c768c5f1dcc8901ba120..95f95df7ff83c3f37d997c62ba64c55d374be23b
git diff --name-status 111501f503cc6c2c61b1c768c5f1dcc8901ba120..95f95df7ff83c3f37d997c62ba64c55d374be23b
git ls-tree -r --name-only 9174c796df4fa008507e727eb35cce63b3e4a08f -- supabase/migrations | rg '\.sql$'
```

Não executar `git fetch`, checkout, reset ou merge como parte da verificação read-only. Se a referência remota precisar ser atualizada, isso deve ser uma etapa explícita anterior, registrada separadamente.

### 8.2 GitHub

```bash
gh pr view 63 --repo Gilsantosz/ac-prod --json url,state,isDraft,mergeable,mergeStateStatus,headRefOid,baseRefOid,commits,files,additions,deletions,statusCheckRollup
gh pr checks 63 --repo Gilsantosz/ac-prod
curl -sS 'https://api.github.com/repos/Gilsantosz/ac-prod/pulls/63/reviews?per_page=100' \
  | jq '[.[] | {id,state,commit_id,submitted_at,html_url}]'
curl -sS 'https://api.github.com/repos/Gilsantosz/ac-prod/pulls/63/comments?per_page=100' \
  | jq '[.[] | {id,path,line,side,commit_id,created_at,updated_at,html_url,in_reply_to_id}]'
curl -sS 'https://api.github.com/repos/Gilsantosz/ac-prod/issues/63/comments?per_page=100' \
  | jq '[.[] | {id,created_at,updated_at,html_url}]'
curl -sS 'https://api.github.com/repos/Gilsantosz/ac-prod/commits/95f95df7ff83c3f37d997c62ba64c55d374be23b/check-runs?per_page=100' \
  | jq '{total_count,check_runs:[.check_runs[]|{id,name,status,conclusion,started_at,completed_at,details_url,html_url}]}'
```

Não solicitar campos de autores, comentários ou logs completos quando eles não forem necessários ao gate. Não executar rerun, review, update, merge ou comentário.

### 8.3 SQL de catálogo

Executar em sessão/connector estritamente read-only. As consultas abaixo retornam metadados ou digests, nunca definição literal nem dados de negócio.

```sql
SELECT current_setting('server_version') AS server_version;

SELECT extname, extversion
FROM pg_catalog.pg_extension
ORDER BY extname;

SELECT count(*) AS migration_count,
       min(version) AS first_version,
       max(version) AS last_version
FROM supabase_migrations.schema_migrations;

SELECT flag_name, enabled, updated_at
FROM private.collection_pipeline_flags
ORDER BY flag_name;

SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public', 'private', 'realtime')
ORDER BY schemaname, tablename, policyname;

SELECT n.nspname AS schema_name,
       p.oid::regprocedure::text AS signature,
       md5(
         concat_ws(
           '|',
           pg_catalog.pg_get_userbyid(p.proowner),
           coalesce(p.proacl::text, ''),
           coalesce(p.proconfig::text, ''),
           pg_catalog.pg_get_functiondef(p.oid)
         )
       ) AS definition_md5
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
ORDER BY n.nspname, p.oid::regprocedure::text;
```

Essa consulta de funções retorna hash por objeto. Ela não reproduz o MD5 agregado histórico porque o serializador original não foi exportado; serve para construir um novo manifesto versionado. O arquivo
[`runtime-read-only-probes.sql`](runtime-read-only-probes.sql) preserva o conjunto
canônico de probes para as próximas capturas.

### 8.4 Inventários minimizados

SQL para retornar apenas nomes de filas e entradas do Vault:

```sql
SELECT queue_name
FROM pgmq.meta
WHERE queue_name LIKE 'collection_%'
ORDER BY queue_name;

SELECT name
FROM vault.secrets
WHERE name LIKE 'acprod_%'
ORDER BY name;
```

Comando para listar somente nomes de Edge Functions, usando autenticação já configurada e sem imprimir token:

```bash
supabase functions list --project-ref uozuzdfvnufsjsonswag --output json | jq -r '.[].name' | sort
```

Não usar modo verbose/debug, não imprimir environment e não consultar `vault.decrypted_secrets`.

### 8.5 Checksums dos relatórios

Enquanto os relatórios estiverem em composição, gerar hashes apenas para conferência local. No fechamento, congelar o conjunto e executar:

```bash
find docs/audits/2026-09-04-mes-vnext -maxdepth 1 -type f \
  ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 shasum -a 256
shasum -a 256 docs/README.md
```

O próprio `09-evidence-manifest.md` não deve tentar incorporar seu hash final no mesmo conteúdo, pois isso altera o arquivo. Registrar seu SHA-256 em um manifest externo imutável, release artifact ou attestation após o freeze.

## 9. SHA-256 dos relatórios

O fechamento gera um arquivo `SHA256SUMS` externo a este documento. Ele inclui o
SHA-256 de cada relatório, do probe SQL e do índice `docs/README.md`; o próprio
arquivo de checksums fica fora de sua lista para evitar autorreferência. Sempre
recalcular o conjunto depois da última mudança e antes do commit.

## 10. Artefatos não exportados

| Evidência | Estado |
|---|---|
| Export bruto literal de todo o catálogo | não exportado; manifesto SHA-256 por objeto e probes reproduzíveis foram versionados |
| Manifesto por objeto de relações e rotinas `public`/`private` | versionado em `runtime-object-manifest.json`; schemas gerenciados pela plataforma permanecem apenas agregados/minimizados |
| SQL/serializador exato dos MD5 históricos | não exportado |
| Serializador exato dos SHA-256 agregados de migrations/ledger | não exportado |
| Definições integrais das treze funções runtime-only/criticamente divergentes | versionadas como evidência que não deve ser executada; revisão de desired state ainda pendente |
| Owner/grants/search_path das funções SECURITY DEFINER | inventário por overload versionado; `proconfig` literal e dependências completas não exportados para evitar exposição e falsa completude |
| Colunas/defaults/constraints/índices/policies/owner/ACL/grants das três relações runtime-only críticas | versionados em `runtime-critical-relation-manifest.md` |
| Snapshot sanitizado da PR, reviews, comments e checks | versionado em `github-pr63-snapshot.json`; corpos/autores/logs deliberadamente omitidos |
| Logs completos e artefatos dos checks GitHub/Cloudflare | não exportado |
| Bundle implantado/hash de cada Edge Function | não exportado |
| Payloads, IDs e conteúdo de mensagens PGMQ/archive/DLQ | deliberadamente não exportado |
| Valores, ciphertext ou versões materiais do Vault | não lidos; não exportados |
| Artefatos/hashes de capacity runs | inexistentes no registro atual; `capacity_test_runs` estava vazio |
| Métricas WAN, IndexedDB e navegador/PWA | não capturadas |

“Não exportado” não significa inexistente ou zero. Significa apenas que o material não está presente no bundle auditável atual e não pode sustentar um gate até ser capturado de forma segura.

## 11. Limitações de reprodutibilidade

1. O runtime pode mudar depois dos cortes registrados; uma consulta atual não recria o estado histórico.
2. As consultas do catálogo ocorreram em horários diferentes e não formam um snapshot transacional único.
3. Os MD5 históricos não possuem o SQL/serializador byte a byte anexado.
4. Os SHA-256 agregados não possuem o comando/serializador exato anexado.
5. Hashes abreviados não são verificáveis e não podem ser usados para comparação ou rollback.
6. Links de PR e checks são vivos; não houve export assinado do JSON ou dos logs.
7. Não foi executado `EXPLAIN ANALYZE` em função mutável, teste de carga, deploy ou alteração de flags.
8. Não existe capacity run finalizado com configuração, métricas, artefatos e hashes imutáveis.
9. A ausência de mensagens nas filas ativas no corte não comprova tratamento da DLQ, projeção correta ou reconciliação.
10. A ausência de dado foi classificada como não comprovada, nunca convertida em zero ou PASS.

## 12. Critério de fechamento do bundle

Antes de chamar este conjunto de evidências de fechado:

1. congelar os relatórios e registrar horário UTC de fechamento;
2. gerar SHA-256 de cada relatório e um manifest externo assinado/imutável;
3. preservar e validar o SQL/serializador v1 já versionado antes de cada nova captura;
4. exportar integralmente, de forma sanitizada, as definições runtime-only que serão alteradas;
5. registrar owner, grants, policies, triggers, índices, dependências e versões de Edge/worker;
6. registrar `capacity_run_id`, commit, migrations, ambiente, flags, thresholds e hashes dos artefatos para cada ensaio;
7. preservar receipts, ledger, outbox, archive, DLQ e evidências durante deploy e rollback;
8. manter decisão **NO-GO** enquanto qualquer gate crítico ou evidência obrigatória estiver pendente.

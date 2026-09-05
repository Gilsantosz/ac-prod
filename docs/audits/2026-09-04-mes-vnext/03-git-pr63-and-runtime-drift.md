# Git, PR #63 e drift Git/runtime

## Escopo e método

A inspeção partiu de uma worktree limpa criada a partir de `origin/main`. O
checkout original do usuário continha mudanças não relacionadas e foi mantido
intacto. A referência remota foi atualizada antes da comparação.

| Referência | SHA |
| --- | --- |
| `origin/main` auditada | `9174c796df4fa008507e727eb35cce63b3e4a08f` |
| merge-base da PR #63 | `111501f503cc6c2c61b1c768c5f1dcc8901ba120` |
| head da PR #63 | `95f95df7ff83c3f37d997c62ba64c55d374be23b` |

A PR está 11 commits à frente e um commit atrás da `main`. O commit posterior é
a [PR #64](https://github.com/Gilsantosz/ac-prod/pull/64), que altera
`src/hooks/useProductionRealtimeSync.js` e adiciona a migration de baixas
manuais/Realtime. Portanto, a PR #63 não deve ser mesclada por integração cega.

## Estado revalidado da PR #63

PR: [#63 — fix/auth-realtime-capacity-20260902](https://github.com/Gilsantosz/ac-prod/pull/63)

- aberta, não-draft e não mesclada;
- `mergeable=true`, mas `mergeStateStatus=UNSTABLE` na inspeção;
- 11 commits, 56 arquivos, 6.933 adições e 326 remoções;
- 11 achados de review registrados como resolvidos, sendo cinco P1 e seis P2;
- 14 reviews com estado `COMMENTED`; nenhum review `APPROVED`;
- duas tentativas de review no head final falharam antes de produzir aprovação.

O snapshot sanitizado
[`github-pr63-snapshot.json`](github-pr63-snapshot.json) preserva 14 reviews,
22 comentários de review (11 threads iniciais + 11 respostas), oito comentários
gerais e oito check runs, com URLs/SHAs/timestamps e sem autores, e-mails, corpos
ou logs. O estado “resolved” foi observado na UI; a API REST pública usada no
snapshot não exporta esse campo, portanto ele deve ser revalidado na UI.

### Commits lidos

| SHA | Assunto |
|---|---|
| `95a5af3` | `chore(observability): instrument auth and operator sessions` |
| `a98a487` | `fix(auth): preserve valid sessions through transient failures` |
| `f291524` | `fix(realtime): refresh JWT, deduplicate channels and prompt PWA updates` |
| `ac1a6d9` | `fix(database): restore projection schema and recover 42703 outboxes` |
| `bf44a33` | `fix(workers): enforce distributed single-flight leases` |
| `33ec882` | `feat(capacity): add controlled test plane and reproducible fixtures` |
| `3e477a2` | `docs(capacity): record no-go smoke evidence` |
| `a685fdd` | `docs(runbook): diagnose Cloudflare worker build failure` |
| `4f3a29d` | `fix: make capacity homologation fail closed` |
| `5d901dc` | `fix: complete capacity fixtures and stale-run recovery` |
| `95f95df` | `fix: make capacity fixture lifecycle retry-safe` |

### Checks do head

| Check | Resultado | Interpretação |
| --- | --- | --- |
| [Security](https://github.com/Gilsantosz/ac-prod/actions/runs/33768438262) | success | Evidência válida apenas para o escopo automatizado do workflow. |
| [Replacement validation](https://github.com/Gilsantosz/ac-prod/actions/runs/33768438153) | success | Não cobre capacidade MES completa. |
| [Deploy](https://github.com/Gilsantosz/ac-prod/actions/runs/33768438255) | success com etapas ignoradas | Prova de release Supabase, artifact e Pages foram puladas; não é homologação de runtime. |
| [Cloudflare Workers build](https://dash.cloudflare.com/ba7c0b12a6721edd8f4395e4b49da264/workers/services/view/ac-prod2/production/builds/a357b5d2-06d4-416b-8b92-a2b5aa745840) | failure | Gate externo permanece vermelho. |

### Correções que continuam válidas como candidatos a port seletivo

| Commit(s) | Conteúdo aproveitável | Condição para portar |
| --- | --- | --- |
| `95a5af3` | telemetria sanitizada de Auth/sessão | Revalidar nomes, cardinalidade e ausência de PII. |
| `a98a487`, `4f3a29d` | preservar Auth em falha transitória; profile single-flight/cache; generation guard; impedir retry antigo de restaurar sessão após logout; remover logout no unmount | Integrar sobre a `main` atual e executar testes de corrida/múltiplas abas. |
| `f291524`, `4f3a29d` | propagar JWT renovado ao Realtime; jitter, deduplicação e teardown | Complementar com registry/refcount, resubscribe, snapshot e gap detection. |
| `ac1a6d9` | reparo de `production_entries.updated_at` e recuperação auditada dos 58 erros `42703` | Aplicar só depois de comparar a definição runtime capturada. Não portar a lease global. |
| `33ec882`, `5d901d`, `95f95df` | ideias de control plane fail-closed, heartbeat, emergency-stop, vínculo de fixture, hashes e cleanup | Remover limites artificiais e tornar runs finalizados imutáveis. |
| `3e477a2`, `a685fdd` | evidência NO-GO e diagnóstico de deploy | Preservar como histórico, sem tratá-los como resultado atual. |

### Bloqueios que não devem ser portados

1. `private.collection_worker_leases_v3` tem chave primária apenas por
   `worker_kind`; isso serializa cada tipo de worker em uma lease global.
2. Edge Functions acionadas por wakeup são o consumidor principal e cada evento
   legado ainda causa um RPC individual.
3. Os endpoints internos dos workers usam CORS `*`.
4. A autenticação de worker depende de segredo estático em `x-cron-secret`, sem
   expiração, nonce, proteção explícita contra replay ou rate limit.
5. O control plane limita 100 dispositivos e 60 minutos, permite configuração de
   produção e não representa a ladder até 1.000 dispositivos nem endurance.
6. Os thresholds k6 aceitam decisão p95/p99 de 800/2.000 ms, abaixo do contrato
   solicitado de 500/1.000 ms, e omitem cenários críticos.
7. Runs finalizados podem ter métricas sobrescritas e não há trilha auditável de
   anexos posterior à finalização.
8. A maioria das funções privilegiadas não usa `search_path = ''` e grants
   continuam amplos.
9. O frontend não tem registry central de canais, reference counting, detecção de
   gap por revision nem bloqueio de reload durante captura ativa.

Conclusão: **não recomendar merge da PR #63**. O caminho seguro é portar commits
ou trechos validados para a branch v4, com revisão de semântica e testes.

## Drift de migrations

O runtime registra 154 migrations, da versão `20260601004505` até
`20260903165317`. A `main` contém 167 arquivos de migration. Quantidade de
arquivos não é equivalência de catálogo; nomes, timestamps, statements e objetos
também precisam coincidir.

Drifts relevantes:

- as cinco primeiras migrations da PR #63 existem no runtime; as migrations
  posteriores de hardening/fixture/stale-executor não foram aplicadas;
- o runtime registra a migration manual/Realtime como `20260903165317`, enquanto
  a `main` possui `20260903164500_enable_manual_volume_and_policy_realtime.sql`;
- há objetos e definições no runtime sem DDL canônico reproduzível no Git;
- algumas migrations históricas de alinhamento são apenas `SELECT 1`, portanto
  atestam uma aplicação anterior, mas não recriam o objeto em banco vazio;
- `app_schema_releases` contém 31 registros, somente quatro `ready=true`; releases
  relevantes de v3/capacidade/hardening permanecem `ready=false`.

Checksums agregados da inspeção:

| Conjunto | SHA-256 |
| --- | --- |
| lista ordenada de arquivos locais de migration | `c80eff21d5ab4c69b583cec394ad49abe9386de6c3965c01e68be287b41cf7bf` |
| ledger runtime (`version`, nome, statements, autor, idempotência) | `1ade58c0db5575753e552c8055e2ddcfbdf02a0a114337f2b83cfb6039d3895b` |

Esses hashes identificam os snapshots comparados; eles não afirmam equivalência
semântica entre Git e runtime.

## Objetos runtime que exigem captura literal

As definições abaixo foram obtidas por introspecção, nunca reconstruídas de
memória. Antes de qualquer migration que as altere, o DDL integral, owner,
grants, dependências e trigger associado deve entrar em um artefato sanitizado e
receber revisão.

| Objeto | Evidência SHA-256 de `pg_get_functiondef` |
| --- | --- |
| `public.process_production_reading_impl_v2(jsonb)` | `5f4913b9c65d1f771792eee1434cdbc4efd475bc2c87b530270bb4f9ba41304d` |
| `public.finalize_collection_realtime(text,jsonb)` | `dea35ae9cda03a48fa865ef26f582dd7e8215a55cb7a30b8c91d71753a965332` |
| `public.sync_production_lot_stage_aggregate()` | `36a3239efdf67f4123e7ca6893682870f0845e26eaaa595e327650e1010312b1` |
| `public.sync_reading_to_event()` | `acf359419786cd589e318c488878d720c3d918b44ffc521978f862f65ffc0556` |
| `public.recalculate_cell_lot_state(uuid,text,text,uuid,uuid)` | `794189465651570ecca58ce94b189a9e8134a06bddd9e8fa1a2e5df01f855f01` |
| `public.refresh_collection_lot_state(uuid,uuid)` | `e0ed07c2513c4939650a0fb2c011cd5b446e51a24cc2a1ba10ead7d12e51e290` |
| `public.resolve_production_stage_for_cell(uuid,text)` | `0b12c3c66e86f7fb2198f4362e7b97c789a44dcc5de3efb4e8819991e2917692` |
| `public.switch_cell_active_lot_context(text,text,uuid,uuid,uuid,timestamptz,text)` | `9582ae4b912b67bb3253338d35e3a49cb0aebcb66cdbab623f0f950cee857c95` |
| `public.reset_production_data()` | `5c48ab503c2e62e0826282349913939675f0765c2da5b011749d84f6f0bda189` |
| `public.reset_production_data_impl()` | `70325831ca824de351920169ab60deda636c61985503c44236ac712bcef69e25` |
| `public.approve_piece_replacement(uuid,jsonb)` | `7eab3af5573ac3c6f0fb913307fd386cb963067ddb66c4660fd58f225d531516` |
| `public.force_complete_piece_replacement(uuid,text,jsonb)` | `f2bc1f2948be690e5fa0de903acc253a7aac285c6cc81ecafe4b0aea12af0a1a` |
| `public.force_complete_piece_replacement_impl(uuid,text,jsonb)` | `457dd6fd384ebfd140581346d0ec25845c8e2faea6bc89ebb5f240c1f7cc289a` |

Os hashes das dez funções inicialmente selecionadas foram recalculados
diretamente no runtime a partir de `pg_get_functiondef` em
`2026-09-04T16:14:52Z`; os três caminhos críticos de reposição foram capturados
às `16:22Z`. Os treze corpos literais estão no
artefato auditável
[`runtime-critical-function-definitions.sql.txt`](runtime-critical-function-definitions.sql.txt),
marcado como evidence-only e **DO NOT EXECUTE AS A MIGRATION**. O conteúdo é SQL
sintaticamente executável, portanto essa marcação é uma regra operacional, não
uma barreira técnica. Isso não é autorização para promover as funções a
desired state ou recriá-las sem revisão.

As três relações runtime-only críticas — `production_cell_active_contexts`,
`production_cell_lot_states` e `production_lot_stage_aggregates` — tiveram
colunas, defaults, constraints, índices, policies, owner, ACL e grants
capturados às `2026-09-04T16:15:41.223630Z` em
[`runtime-critical-relation-manifest.md`](runtime-critical-relation-manifest.md).

## Drift de semântica e configuração

| Área | Git/PR | Runtime | Risco |
| --- | --- | --- | --- |
| counter shards | projetor v3 usa `% 16` | constraint/runtime opera com 32 shards | contagem ou distribuição divergente |
| worker v3 | lease global proposta | tabela global por `worker_kind` aplicada | ausência de escala horizontal |
| migrations v3 | arquivos posteriores presentes na PR | apenas subconjunto aplicado | comportamento não reprodutível |
| capacity test | harness e hardening na PR | `capacity_test_runs = 0` | nenhuma capacidade homologada |
| staging | esperado para carga | branch `capacity-test` em `MIGRATIONS_FAILED`, só cinco migrations antigas | proibido extrapolar ou testar produção |
| Auth DB pool | intenção de percentual | orçamento fixo observado em 10 conexões | starvation possível ao mudar compute |
| Realtime | Broadcast privado pretendido | publicação ampla e tópicos sem setor | vazamento/storm e ressincronização frágil |

## Edge Functions, filas e Vault

- 16 Edge Functions ativas foram inventariadas. As funções principais da coleta
  são legacy v4, decision v2 e projector v2, todas com `verify_jwt=false`.
- Os nomes de secrets foram registrados sem acessar valores:
  `acprod_archive_cron_secret`, `acprod_archive_cron_url`,
  `acprod_collection_v3_decision_url`,
  `acprod_collection_v3_projection_url`,
  `acprod_collection_worker_secret`, `acprod_collection_worker_url`,
  `acprod_reports_cron_secret`, `acprod_reports_cron_url`.
- As filas PGMQ live, replay, projection e DLQ existem e estavam vazias no
  snapshot. Archives contêm 142, 0, 200 e 58 mensagens, respectivamente.
- Os crons legacy, decision e projector rodam a cada 15 segundos; o cron deve ser
  sweeper/fallback e não mecanismo normal de latência.

## Hipótese que permanece não provada

O catálogo contém `reset_production_data_impl()`, que executa `TRUNCATE ...
RESTART IDENTITY CASCADE` em várias tabelas produtivas, mas não em
`coletas_producao`. As estatísticas cumulativas e os recibos órfãos são
compatíveis com execução histórica dessa rotina, porém não foi encontrada prova
de invocação. Portanto:

- não atribuir os órfãos a essa função como fato;
- impedir seu uso no plano de segurança futuro;
- preservar logs e buscar auditoria adicional antes de reconciliar;
- jamais executar a função durante a investigação.

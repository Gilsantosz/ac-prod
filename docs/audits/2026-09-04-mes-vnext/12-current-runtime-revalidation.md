# Revalidação atual de GitHub e runtime

Data: 2026-09-04
Corte principal: 22:11–22:36 UTC

Este snapshot atualiza as contagens do bundle de Fase Zero. São observações de
runtime, não um capacity run. Contadores cumulativos não são apresentados como
resultado do ensaio atual.

## 1. GitHub

| Referência | Estado revalidado |
|---|---|
| `main` | `9174c796df4fa008507e727eb35cce63b3e4a08f`, PR #64 |
| PR #63 | aberta, head `95f95df7ff83c3f37d997c62ba64c55d374be23b`, NO-GO declarado |
| PR #65 | aberta/draft documental, head `a5c1b4e9c8c3c96643e1b6ebf21cebbd1eeb8be7`, NO-GO |
| PR #66 | nova PR draft de implementação, base na `main` acima |

Na PR #65, lint/tipos/testes/build, contrato estático, security e validate
passaram; o deploy externo Cloudflare permaneceu com falha. Isso não autoriza
release. A PR #63 contém correções válidas de Auth/Realtime/PWA, mas também a
lease global por `worker_kind`; o port deve ser seletivo.

A `main` limpa foi validada localmente:

- lint: PASS;
- typecheck: PASS;
- Vitest: 104 arquivos, 463 testes, PASS;
- build PWA: PASS, com warnings de chunks grandes;
- secretlint: PASS;
- `npm audit --omit=dev --audit-level=high`: PASS para o gate high, com uma
  vulnerabilidade moderada transitiva em `fflate` ainda aberta.

## 2. Produção — integridade e pipelines

| Indicador | Valor atual |
|---|---:|
| Migrations no ledger | 154 |
| Última migration efetiva | `20260903165317` |
| `app_schema_releases` | 31: 4 ready, 27 not-ready |
| Receipts (`coletas_producao`) | 703 |
| Ledger readings | 83 |
| Collection events | 83 |
| Processing attempts | 176 |
| Outbox atual | 0 |
| Projection applied atual | 0 |
| Receipts com retry | 587 |
| Receipts sincronizados sem event/reading atual | 471 |
| Receipts v3 com reading referenciada ausente | 142 |

Dos 142 receipts v3 sem reading referenciada, 59 registram resultado
`approved` e 83 `duplicated`. Isso não prova perda por si só — pode incluir
cleanup/reset histórico —, mas impede afirmar `lost_receipts = 0` antes da
classificação individual.

No estado presente foram encontrados zero grupos de dupla aprovação e zero
`client_event_id` cruzando pipelines. Outbox órfã e projeção duplicada também
resultaram zero, mas as tabelas de outbox/projection applied vazias tornam esses
dois resultados vacuamente verdadeiros, não homologação.

As quatro flags v3 continuam `false`. Não existe flag, tabela ou rotina de
pipeline v4/vNext no runtime. Há 142 registros de heartbeat de workers, dos quais
70 permanecem unfinished/stale. A tabela de lease global existe por drift de
runtime, sem lease ativa; tabela de slots horizontais não existe.

## 3. Produção — filas, cron e Edge Functions

As quatro filas PGMQ estão com depth atual zero. O archive preserva:

| Fila | Mensagens arquivadas |
|---|---:|
| live | 142 |
| replay | 0 |
| projection | 200 |
| DLQ | 58 |

As 58 mensagens de DLQ continuam sem `reason_code` suficiente para tratamento
auditável. Fila vazia não fecha esse gate.

Nas últimas 24 horas observadas:

- inbox legado: 5.744 execuções, 2 falhas;
- decisão v3: 5.745 execuções, 3 falhas;
- projeção v3: 5.744 execuções, 2 falhas.

O padrão confirma o sweeper de aproximadamente 15 segundos ainda ativo. Uma
amostra de 29 execuções do inbox legado teve HTTP 200, mas p50 de 972 ms, p95 de
55.701 ms e p99 de 70.642 ms; sucesso HTTP não equivale a cumprir SLO.

Produção possui 16 Edge Functions e staging 14, todas marcadas `ACTIVE`:

- somente produção: `process-collection-inbox`, `process-collection-v3` e
  `project-collection-v3`;
- somente staging: `capacity-test-control`;
- bundles comuns com divergência material: `admin-users` e
  `send-scheduled-reports`;
- outros bundles comuns diferem apenas no número de versão observado.

## 4. Staging

O staging permanece congelado e estruturalmente distante da produção:

- 113 relações de aplicação e 171 rotinas;
- 5 migrations no ledger;
- 10 runs de capacidade: 9 `cleaned`, 1 `preparing` sem runner/start;
- 498 amostras, 11 erros, 14 comandos, 599 agentes e 43.800 entidades
  sintéticas preservadas;
- zero ledger readings, collection events e operator sessions;
- ausência de `coletas_producao`, outbox, attempts, flags, PGMQ, `cron.job` e
  rotinas collection-v3/v4.

Detalhes do backup, preflight e decisão de recovery estão em
[`11-staging-revalidation-and-recovery-decision.md`](11-staging-revalidation-and-recovery-decision.md).

## 5. Advisors e privilégios

| Ambiente | Security | Performance |
|---|---:|---:|
| Produção | 119 | 342 |
| Staging | 94 | 364 |

Produção inclui 4 tabelas com RLS sem policy, 5 SECURITY DEFINER executáveis por
`anon`, 108 por `authenticated`, 152 FKs sem índice, 39 ocorrências de
`auth_rls_initplan`, 61 grupos de policies permissivas sobrepostas, 3 índices
duplicados e pool de Auth fixo em 10.

Staging inclui 13 SECURITY DEFINER executáveis por `anon`, 78 por
`authenticated` e o advisor crítico `Security Definer View` em
`public.collection_stage_facts`. A função
`resolve_production_context(text,text)` é executável por `anon` no staging e não
em produção, outro drift de segurança.

Esses números são inventário, não uma autorização para criar 152 índices. Cada
índice e policy precisa de consulta, EXPLAIN, custo de escrita e rollback.

## 6. Conexões e deltas cumulativos

Snapshot final:

| Ambiente | Uso instantâneo | Percentual | Realtime | Locks aguardando | Idle in transaction |
|---|---:|---:|---:|---:|---:|
| Produção | 14/60 | 23,33% | 7 | 0 | 0 |
| Staging | 7/60 | 11,67% | não aplicável no corte | 0 | 0 |

Ambos reservam 3 conexões de superuser. O snapshot não define orçamento
sustentado nem pico.

Desde o baseline cumulativo anterior, produção registrou `+32.463` commits,
`+3.108` rollbacks, `+801` temp files, `+3.508.680.674` temp bytes, `+6.832`
sessões, uma sessão abandoned e zero deadlock adicional. Esses deltas incluem
atividade produtiva normal e probes da auditoria; não pertencem a um run de
capacidade.

## 7. Decisão

**NO-GO.** Os fatos atuais revalidam, sem relaxar nenhum threshold:

- pipeline v2 permanece produtivo;
- v3/v4 permanecem desligados;
- staging/migrations ainda bloqueiam aplicação e testes reais;
- reconciliação histórica não foi concluída;
- segurança, conexão, Auth e capacidade não estão homologados;
- nenhum reset, rebase, deploy, DDL/DML ou load test foi executado neste corte.

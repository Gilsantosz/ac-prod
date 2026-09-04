# Auditoria MES vNext de alta capacidade — checkpoint da Fase Zero

Data de referência: 2026-09-04
Janela principal de inspeção: cortes entre 14:55:56 e 15:18:39 UTC; definições críticas e inventários foram revalidados até 17:05:35 UTC
Repositório: `Gilsantosz/ac-prod`
Base auditada: `main` em `9174c796df4fa008507e727eb35cce63b3e4a08f`
Branch documental de origem: `codex/mes-vnext-audit-20260904`
Branch atual de implementação: `fix/mes-v4-fastpath-horizontal-workers-20260904`
Supabase: projeto `uozuzdfvnufsjsonswag`, região `sa-east-1`, PostgreSQL 17.6.1.127
PR obrigatória revisada: [#63 — fix/auth-realtime-capacity-20260902](https://github.com/Gilsantosz/ac-prod/pull/63)

## Decisão executiva

**NO-GO para merge da PR #63, ativação do pipeline v3 e qualquer teste de carga
no projeto de produção.**

Essa decisão não decorre apenas dos percentis históricos acima dos SLOs. O
runtime atual contém recibos sincronizados sem os fatos produtivos
correspondentes, a trilha de migrations diverge do Git, o ambiente de teste de
capacidade está com `MIGRATIONS_FAILED`, e a lease global proposta pela PR #63
serializa cada `worker_kind`; a `main` ainda usa heartbeats por worker, mas não
possui slots configuráveis nem runtime persistente. Também há
privilégios incompatíveis com o princípio de menor acesso. A capacidade continua
**não homologada**.

Nenhuma flag foi alterada, nenhuma migration foi aplicada, nenhuma Edge Function
foi implantada e nenhum ensaio de carga foi executado nesta fase. Todas as
consultas ao runtime foram de leitura e os valores de secrets não foram lidos nem
registrados.

## Gates críticos revalidados

| Gate | Evidência atual | Estado |
| --- | --- | --- |
| `lost_receipts = 0` | 554 recibos em estado sincronizado; 471 não têm hoje evento nem leitura correlacionada. O histórico disponível não permite distinguir deleção/reset de perda no processamento. | **NÃO COMPROVADO** |
| `double_approvals = 0` | Nenhum grupo duplicado no ledger atual; a amostra atual é pequena e parcialmente órfã. | PASS apenas no estado presente |
| `conflicting_outcomes = 0` | Nenhum `client_event_id` atual cruza pipelines; existem 59 recibos v3 com resultado aprovado cuja leitura referenciada não existe hoje. | **NÃO COMPROVADO** |
| `duplicate_projections = 0` | Tabelas atuais de outbox aplicado e shards estão vazias. O resultado é vacuamente zero e não homologa o projetor. | **NÃO COMPROVADO** |
| `deadlocks_delta = 0` | Contador cumulativo do banco registra 218 deadlocks desde 2026-05-22; não houve run com baseline antes/depois nesta fase. | NÃO MEDIDO POR RUN |
| `statement_timeouts_delta = 0` | Não houve run isolado. Estatísticas acumuladas mostram chamadas muito acima dos SLOs. | NÃO MEDIDO POR RUN |
| `unauthorized_success = 0` | Há grants excessivos, cinco RPCs `SECURITY DEFINER` executáveis por `anon` e 108 por `authenticated`. | **NÃO COMPROVADO** |
| `cross_sector_leak = 0` | Policies e tópicos Realtime atuais não estabelecem isolamento por setor em todos os caminhos; counters têm leitura global autenticada. | **NÃO COMPROVADO** |
| `orphan_outbox = 0` | Outbox atual está vazio, apesar de histórico de inserções e archive de projeção. | **NÃO COMPROVADO** |
| `untreated_dlq = 0` | Os 58 itens `42703` foram registrados como `requeued` na recovery audit, mas nenhum dos outboxes existe hoje e não há `projection_applied` correlacionado no snapshot. | **NÃO COMPROVADO** |
| `reconciliation_difference = 0` | Recibos, eventos, ledger e projeções não fecham no snapshot. | **FAIL** |

## Performance observada

Os números abaixo são evidência histórica/runtime; não são uma rodada de
capacidade válida e não devem ser combinados como se viessem da mesma população.

| Métrica | Observação | SLO requerido | Estado |
| --- | ---: | ---: | --- |
| ACK banco p95, smoke anterior | 801,249 ms | <= 250 ms | FAIL |
| Decisão p95, smoke anterior | 2.634 ms | <= 500 ms | FAIL |
| Queue age p99, smoke anterior | 2.611,939 ms | dentro do SLO do fluxo | FAIL |
| Projeção p95, smoke anterior | 948,779 ms | <= 500 ms | FAIL |
| Login p95, smoke anterior | 1.720,196 ms | <= 1.500 ms | FAIL |
| `process_collection_inbox_item` legado, média acumulada | 1.608,929 ms em 4.461 chamadas | não comparável diretamente | RISCO |
| Dashboard, média acumulada | 696,843 ms em 4.140 chamadas | não comparável diretamente | RISCO |
| Conexões no snapshot | 7/60; sem `idle in transaction` | sustentado <70%, pico <85% | apenas baseline |

O tempo interno próximo de 110 ms observado no smoke anterior não elimina os
atrasos de ingresso, fila, projeção ou rede e, isoladamente, não satisfaz nenhum
gate fim a fim.

## Quadro ANTES/DEPOIS no fechamento da Fase Zero

Como nenhuma implementação ou rodada válida foi executada, a coluna DEPOIS
permanece deliberadamente “não medido”. Preenchê-la com estimativa seria uma
alegação de capacidade sem evidência.

| Dimensão | ANTES revalidado | DEPOIS | Situação |
|---|---|---|---|
| ACK | smoke histórico p95 801,249 ms | não implementado/não medido | FAIL histórico |
| Decisão | smoke histórico p95 2.634 ms | não implementado/não medido | FAIL histórico |
| Fila | smoke histórico p99 2.611,939 ms; depth atual 0 | não implementado/não medido | fila vazia não é PASS |
| Projeção | smoke histórico p95 948,779 ms | não implementado/não medido | FAIL histórico |
| Dashboard | média acumulada 696,843 ms; sem percentis do run | não implementado/não medido | sem gate atual |
| Login | smoke histórico p95 1.720,196 ms; logs atuais sem unidade confirmada | não implementado/não medido | FAIL histórico |
| Sessões | 206 históricas; 2 ativas válidas; 2 expiradas ainda abertas | não implementado/não medido | baseline apenas |
| Conexões | 7/60 no snapshot; Auth com budget absoluto 10 | não implementado/não medido | pico/sustentado ausentes |
| Retries | 587 receipts com retry; máximo 18 | não implementado/não medido | população histórica |
| Deadlocks | 218 acumulados desde 2026-05-22 | não implementado/não medido | delta do run ausente |
| Timeouts | sem delta isolado; statements acumulados excedem o alvo | não implementado/não medido | delta do run ausente |
| DLQ | 58 itens arquivados e refileirados, sem prova atual de aplicação final | não implementado/não medido | NÃO COMPROVADO |
| Integridade | 471 receipts sincronizados sem fato atual; 59 resultados v3 aprovados sem reading referenciado | não implementado/não medido | FAIL/NÃO COMPROVADO |
| Throughput/saturação/margem/custo | não homologados; compute/custo indisponíveis | não implementado/não medido | NO-GO |

## Conclusões arquiteturais da Fase Zero

1. O desenho v3 tem componentes aproveitáveis — recibo idempotente, PGMQ,
   ledger, outbox, shards, flags e reconciliação —, mas sua semântica não deve ser
   alterada silenciosamente.
2. A próxima implementação deve ser `pipeline_version = 4`, com flags próprias,
   função canônica única de decisão e compatibilidade explícita por fluxo.
3. O caminho síncrono deve concluir a decisão mínima por peça quando couber no
   orçamento; PGMQ permanece como fallback durável, replay, recuperação,
   projeção e DLQ.
4. A lease global por `worker_kind` deve ser substituída por slots configuráveis,
   limitados pelo orçamento real de conexões.
5. O ledger `production_stage_readings` permanece o fato produtivo canônico. As
   projeções devem ser reconstruíveis, em batches e idempotentes.
6. Auth, Realtime e IndexedDB têm correções válidas na PR #63, mas devem ser
   portadas seletivamente sobre a `main` atual, acompanhadas de testes e sem levar
   junto os bloqueios arquiteturais.
7. Não há evidência que justifique Redis, Kafka, RabbitMQ, particionamento ou
   gateway industrial local nesta fase.

## Índice de evidências

- [AS-IS, dependências e fontes de verdade](01-as-is-and-dependencies.md)
- [Catálogo e baseline do runtime](02-runtime-baseline-and-catalog.md)
- [PR #63 e drift Git/runtime](03-git-pr63-and-runtime-drift.md)
- [Matriz de riscos](04-risk-register.md)
- [Plano de alteração, validação e rollback](05-change-and-rollback-plan.md)
- [ADR proposta para o MES Collection Fabric v4](06-adr-mes-collection-v4.md)
- [Evidência oficial da plataforma](07-official-platform-evidence.md)
- [Matriz de compatibilidade por fluxo](08-flow-compatibility-matrix.md)
- [Manifesto de evidências e checksums](09-evidence-manifest.md)
- [Gate de recuperação da branch de staging](10-staging-recovery-gate.md)
- [Revalidação do staging, backups e decisão de recuperação](11-staging-revalidation-and-recovery-decision.md)
- [Manifesto sanitizado do staging antes do reset](staging-pre-reset-manifest.json)
- [Exportação sanitizada e restaurável das evidências de capacidade](staging-capacity-evidence-sanitized.json)
- [Migration exclusiva da branch, captura literal — evidência, não desired state](staging-branch-only-migration.sql.txt)
- [Snapshot sanitizado da PR #63: reviews, comentários e checks](github-pr63-snapshot.json)
- [Definições literais das funções críticas do runtime — evidência, não migration](runtime-critical-function-definitions.sql.txt)
- [Manifesto literal das relações críticas existentes somente no runtime](runtime-critical-relation-manifest.md)
- [Manifesto canônico por objeto: 131 relações e 272 rotinas](runtime-object-manifest.json)
- [Inventário por overload das 222 funções SECURITY DEFINER](runtime-security-definer-inventory.md)
- [Probes canônicos somente leitura](runtime-read-only-probes.sql)

## Limites deste checkpoint

Este é um checkpoint auditável da entrega obrigatória anterior à codificação;
a Fase Zero ainda não está encerrada. Ele não declara correção, capacidade,
merge ou GO. A implementação só pode avançar depois de:

- tornar o schema runtime reproduzível sem inventar definições;
- provisionar ou reparar um ambiente de staging representativo;
- decidir o tratamento auditável dos 471 recibos órfãos e dos 58 itens de DLQ;
- aprovar o plano de port seletivo das correções válidas da PR #63;
- concluir a revisão semântica por overload das funções `SECURITY DEFINER` e
  o controle server-side dos fluxos destrutivos de reset/delete;
- preservar todas as evidências e manter as flags v3/v4 desligadas.

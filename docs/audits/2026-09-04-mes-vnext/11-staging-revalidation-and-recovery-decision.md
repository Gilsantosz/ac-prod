# Revalidação do staging e decisão de recuperação

Data: 2026-09-04
Janela desta revalidação: 22:22–22:31 UTC
Branch Git de trabalho: `fix/mes-v4-fastpath-horizontal-workers-20260904`
Base Git: `main@9174c796df4fa008507e727eb35cce63b3e4a08f`

Este adendo registra fatos observados depois do checkpoint
[`10-staging-recovery-gate.md`](10-staging-recovery-gate.md). Quando houver
divergência, este documento mais recente prevalece. A autorização do
proprietário para recuperação/reset controlado permanece válida, mas não altera
os critérios de parada: o reset deve recuperar o ambiente, não apenas destruí-lo
e repetir uma falha conhecida.

## 1. Alvo e estado atuais

| Campo | Valor observado |
|---|---|
| Branch Supabase | `capacity-test` |
| Branch ID | `cf279f17-5cdd-4ec5-b0e4-467f87215ed9` |
| Project ref | `smnsihksrhzbkhcbdjfu` |
| Parent | `uozuzdfvnufsjsonswag` |
| Persistente/default/with_data | `true` / `false` / `false` |
| Estado do deployment | `MIGRATIONS_FAILED` |
| Estado do preview database pela API | `ACTIVE_HEALTHY` |
| Estado agregado no Dashboard | `Unhealthy` |
| Compute/região | `micro` (`t3a.micro`) / `sa-east-1` |
| PostgreSQL | `17.6` |

O Dashboard não possui integração GitHub conectada para esse projeto. A última
migration mostrada é `capacity_test_reusable_cleaned_prefix`.

## 2. Backup físico comprovado

A limitação descrita no checkpoint anterior foi parcialmente superada. A tela
**Database Backups** do próprio projeto `smnsihksrhzbkhcbdjfu` comprova backups
físicos diários concluídos e oferece **Restore** in place:

- 04 Sep 2026 06:24:17 UTC;
- 03 Sep 2026 06:27:31 UTC;
- 02 Sep 2026 06:32:16 UTC;
- 01 Sep 2026 06:31:28 UTC;
- 31 Aug 2026 06:25:21 UTC;
- 30 Aug 2026 14:57:38 UTC;
- 30 Aug 2026 14:26:34 UTC.

Nenhum restore foi iniciado. O fluxo **Restore to new project (Beta)** estimou
US$ 9,68/mês de compute adicional no Dashboard; a API de custo retornou
US$ 10/mês para um projeto novo. Como isso cria cobrança recorrente, o restore
drill isolado exige confirmação de custo específica antes de ser executado.

O backup físico reduz o risco de perda irreversível do staging, mas não torna a
lineage atual reproduzível. Também não substitui o ensaio de restauração: até o
momento existe um ponto restaurável exibido, não uma restauração validada.

## 3. Preflight operacional somente leitura

Snapshot às `2026-09-04T22:25:40.288836Z`:

| Indicador | Valor |
|---|---:|
| `max_connections` | 60 |
| `superuser_reserved_connections` | 3 |
| Backends observados | 9 |
| `idle in transaction` | 0 |
| Locks não concedidos | 0 |
| Runs de capacidade | 10 |
| Amostras métricas | 498 |
| Erros preservados | 11 |
| Comandos preservados | 14 |
| Agentes preservados | 599 |

Os contadores `xact_commit`, `xact_rollback`, `temp_files`, `temp_bytes` e
`deadlocks` são cumulativos desde `2026-08-25T20:33:23.891825Z`; não foram
atribuídos a esta auditoria nem tratados como resultado de ensaio.

Não há executor ativo. Nove runs estão `cleaned`. Um run sintético permanece
órfão em `preparing` desde 31 de agosto: não foi iniciado, não possui runner,
heartbeat ou eventos enviados/recebidos/processados. Esse registro foi
preservado no bundle sanitizado; não foi cancelado nem apagado.

As extensões observadas incluem `pg_net 0.20.4` e
`pg_stat_statements 1.11`. `pgmq` e `pg_cron` não estão instaladas no staging;
o schema/tabela `cron.job` não existe.

## 4. Drift de migrations revalidado

- staging: 5 migrations, sem alteração no checksum canônico já preservado;
- produção: 154 migrations, última versão efetiva `20260903165317`;
- interseção: 4 versões;
- somente produção: 150 versões;
- somente staging: 1 versão;
- Git `main`: 167 arquivos para 164 prefixos de versão únicos;
- colisões: `040`, `041` e `20260726180000`;
- a migration funcional final do Git usa `20260903164500`, enquanto o ledger
  produtivo registra `20260903165317`.

Nenhuma das cinco versões do ledger de staging existe hoje com o mesmo nome de
arquivo no diretório `supabase/migrations`. A branch não tem commit/lineage Git
associado no metadata disponível.

## 5. Por que reset e rebase continuam em HOLD

O cold replay da `main` atual tem bloqueios determinísticos:

1. `033_mes_alert_lifecycle.sql` e `036_customer_cover_multi_lot.sql` contêm
   corpos PL/pgSQL inválidos (`DECLARE` sem `BEGIN`);
2. 32 migrations são apenas `SELECT 1` e alegam alinhar objetos criados
   diretamente no runtime;
3. relações críticas como `production_cell_lot_states`,
   `production_cell_active_contexts` e `production_lot_stage_aggregates` não
   possuem DDL canônico local;
4. o gate `20260831052721_finalize_collection_rollout_v6.sql` falha fechado
   quando esses objetos/funções não existem;
5. migrations posteriores dependem de definições capturadas do runtime que não
   são recriadas no banco vazio;
6. PGMQ/pg_cron são usados sem provisionamento cold-start completo;
7. migrations históricas possuem `TRUNCATE`, limpeza de fatos/importações e
   outras operações não neutras;
8. há cron/Vault/`pg_net` com URL literal do parent produtivo. Em staging, o
   replay pode gravar configuração ou originar tráfego cross-environment.

As documentações atuais do Supabase confirmam que uma branch em
`MIGRATIONS_FAILED` normalmente representa replay parcial de uma história que
diverge do schema real, e que reset/recriação reaplica migrations em sequência
contra banco limpo. Logo, repetir essa sequência conhecida não é uma operação de
recuperação.

Fontes oficiais:

- [Troubleshooting de `MIGRATIONS_FAILED`](https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status)
- [Working with branches](https://supabase.com/docs/guides/deployment/branching/working-with-branches)
- [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Management API: reset de branch](https://supabase.com/docs/reference/api/v1-reset-a-branch)

## 6. Estratégia liberada

1. manter a branch e os backups físicos intactos;
2. materializar uma baseline canônica, staging-only, a partir das definições
   literais do runtime — schema, overloads, triggers, owners, grants, RLS,
   policies e publicações;
3. separar schema, extensões, catálogo sintético, bootstrap Auth e configuração
   ambiental;
4. fazer flags, cron, wakeups, workers e endpoints nascerem desligados;
5. bloquear qualquer URL/ref do parent em lint e preflight;
6. validar duas execuções frias em PostgreSQL 17 descartável e exigir o mesmo
   checksum de catálogo/ledger;
7. executar restore drill isolado depois de confirmação explícita do custo, ou
   um restore drill equivalente sem cobrança adicional;
8. somente então resetar pelo Branch ID explícito e capturar o workflow completo;
9. parar na primeira falha, restaurar o backup e preservar o SQLSTATE/statement;
10. não usar `migration repair --status applied` para esconder objetos ausentes.

## 7. Decisão e ausência de mutação

**NO-GO/HOLD para reset ou rebase neste estado.** A autorização foi registrada;
o gate técnico ainda não foi satisfeito.

- produção: não alterada;
- staging: somente leituras;
- reset/rebase/merge/restore/deploy: não executados;
- flags: não alteradas;
- teste de carga: não executado;
- fatos, filas, archive, ledger, outbox, DLQ e evidências: preservados.

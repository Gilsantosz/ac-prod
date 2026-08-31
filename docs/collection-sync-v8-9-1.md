# AC.Prod2 — correção do sincronismo de coleta v8.9.1

## Incidente

Durante o teste real de coleta, o navegador exibiu `canceling statement due to statement timeout`, acumulou eventos locais e permaneceu em sincronização por mais de 60 segundos.

## Causa raiz

O fluxo anterior ainda confundia o ACK de entrada no inbox com a decisão produtiva final. Em paralelo, transições individuais no IndexedDB, atualizações de interface, invalidações do React Query, polling e Realtime podiam gerar uma tempestade de trabalho concorrente. O KPI de turno e a resolução da janela de horário também executavam consultas mais caras do que o necessário.

## Correções

- ACK do inbox separado do resultado final `sincronizada` ou `erro`.
- Reconciliação por Realtime com polling de segurança.
- Proteção contra ACK atrasado sobrescrever uma decisão final.
- Operações em lote no IndexedDB.
- Estados locais explícitos: `pending`, `processing`, `accepted`, `synced` e `error`.
- Flush de 500 ms e recuperação de eventos parados.
- Coalescência das atualizações visuais e das invalidações de cache.
- KPI de turno pelo ledger canônico `production_collection_events`.
- Resolução de turno sem varredura do catálogo `pg_timezone_names`.
- Worker com concorrência 8, até cinco rodadas e fallback de cinco segundos.
- Gate de deploy exigindo o release Supabase v8.9.1.

## Teste seguro de carga

Foram enviados 300 códigos deliberadamente inválidos de sete dígitos. Assim, o teste percorreu recepção, inbox, worker, decisão individual, Realtime e limpeza sem aprovar ou movimentar peças reais.

| Medida | Antes | Depois |
|---|---:|---:|
| Ingresso de 300 eventos | 142,519 ms | 78,776 ms |
| Drenagem total | 4,884 s | 2,599 s |
| Maior espera na fila | 4.741,510 ms | 2.519,782 ms |
| Eventos finalizados | 300/300 | 300/300 |
| Pendentes ao final | 0 | 0 |
| Erros de transporte | 0 | 0 |

Após o teste, foi confirmado que não existiam registros correspondentes em `production_collection_events`, `production_stage_readings` ou `production_entries`, e todas as linhas artificiais do inbox foram removidas.

## Banco e worker

- `20260831225902_collection_sync_reconciliation_v8_9.sql`
- `20260831230439_optimize_operator_shift_window_v8_9_1.sql`
- release `20260831_acprod_collection_sync_v8_9_1`
- Edge Function `process-collection-inbox`, versão 3

## Materialized view sugerida

A proposta baseada em `eventos_brutos_coleta` e `vw_dashboard_producao` não foi aplicada porque essas relações não existem no schema do AC.Prod2. Além disso, uma fotografia atualizada a cada minuto não reduz a latência do ACK do scanner nem resolve o processamento da fila. O `pg_cron` existente foi usado somente como fallback do worker assíncrono em intervalo de cinco segundos.

# Inventário — Collection Fabric v3

Data da inspeção: 2026-09-01. Base: `main` no commit `aeee58f`. Nenhuma consulta deste inventário alterou o banco.

## Cadeia v2 atual

1. O frontend grava o evento no IndexedDB e faz `INSERT[]` em `coletas_producao`.
2. `trg_process_coleta_producao_ingress` valida o usuário, extrai o token operacional, grava-o temporariamente em `private.coleta_producao_credentials` e remove o token do payload público.
3. `trg_wake_collection_inbox_worker` faz wakeup HTTP por statement; cron a cada 15 s é fallback.
4. `claim_collection_inbox` usa `FOR UPDATE SKIP LOCKED`, lease de 45 s e incrementa a tentativa.
5. A Edge Function limita cada invocação a duas chamadas concorrentes, mas executa um `process_collection_inbox_item` por evento.
6. Cada item chama `process_production_reading_v2`, que valida oito dígitos e delega ao `process_production_reading_impl_v2`.
7. O hotpath trava a peça, grava o fato e atualiza/aciona projeções compartilhadas antes de terminar.

## Hot rows e trabalho repetido

| Origem | Chave compartilhada | Efeito |
| --- | --- | --- |
| `adjust_production_realtime_counter` | data + lote + célula + máquina | `INSERT ... ON CONFLICT DO UPDATE` serializa leituras diferentes. |
| `trg_sync_production_lot_stage_aggregate` | lote + etapa | Tabela existe no runtime, mas DDL não está no Git; causa validada pelo diagnóstico. |
| `recalculate_cell_lot_state` | lote + célula + etapa + máquina | Varre peças/readings e atualiza estado compartilhado por leitura. |
| progresso de `production_lots` | lote | Counts/cardinalidades e update da mesma linha por peça. |
| `refresh_pcp_batch_progress` | batch PCP | Varre peças e atualiza a mesma linha; também pode ser disparado pelo update da peça. |
| `trg_sync_reading_to_event` | por evento, sem hot row | Duplica escrita do ledger em `production_events`. |

## Triggers de `production_stage_readings`

| Trigger | Classe | Tratamento v3 |
| --- | --- | --- |
| `trg_enrich_stage_reading_context` | B — validação/enriquecimento | Manter. |
| `trg_enrich_rejected_reading_context` | B/C — regra de rejeição | Manter e testar reposição/rejeição. |
| `trg_snapshot_operator_name` | C — snapshot | Manter. |
| `trg_reverse_production_entry_after_rejection` | A/E — compensação crítica legada | Manter até teste específico provar separação segura. |
| `trg_sync_production_lot_stage_aggregate` | D — projeção | Guard por `pipeline_version`; capturar definição runtime antes. |
| `trg_sync_realtime_counter_stage_readings` | D — projeção | Guard por `pipeline_version`; projetor aplica delta. |
| `trg_sync_reading_to_event` | E — espelho legado | Guard por `pipeline_version`; projetor espelha idempotentemente. |

## Triggers de `production_collection_events`

| Trigger | Classe | Tratamento v3 |
| --- | --- | --- |
| `trg_collection_events_updated_at` | C | Manter. |
| `trg_snapshot_operator_name` | C | Manter. |
| `trg_sanitize_collection_event_payload` | C/segurança | Manter; defesa adicional contra tokens. |

## Consumidores relevantes

- `production_realtime_counters`: `traceabilityService`, `RealtimeCellProgressPanel` e invalidações do sync global.
- `production_collection_events`: histórico/KPI, Integridade, alertas, relatórios e logs.
- `production_stage_readings`: histórico, KPI, timeline de lote, qualidade e relatórios.
- `production_events`: timeline de peça, integridade fora do fluxo, packing e shipping legados.
- `production_lot_stage_aggregates`: nenhum consumidor existe no Git; a tabela está presente no runtime e exige captura do catálogo antes de qualquer remoção.

## Frontend atual

- estados locais limitados a `pending/processing/synced/error`;
- token operacional duplicado no IndexedDB e no payload de cada evento;
- micro-lote padrão 50, máximo 100;
- polling por lote até 15 s, sem ACK de banco visível;
- backlog inteiro é drenado sob um único lock, sem prioridade live/replay;
- fallback visual desconhecido é verde e pode mostrar “PEÇA LIBERADA — OK” para leitura apenas offline;
- `invalidateAllMesQueries` invalida 32 prefixos depois de uma leitura;
- não existem canais Broadcast privados por equipamento/célula.

## Lacunas de reprodutibilidade

As migrations `20260831042917` e outras de alinhamento são `SELECT 1`; elas registram objetos aplicados por canal controlado, mas não restauram o schema em banco vazio. As definições runtime de `process_production_reading_impl_v2`, `finalize_collection_realtime` e do agregado lote/etapa precisam ser exportadas read-only, receber checksum e entrar numa baseline separada. O Collection Fabric v3 não declara essa lacuna resolvida.

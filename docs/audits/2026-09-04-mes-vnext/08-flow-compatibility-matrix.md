# Matriz de compatibilidade por fluxo

Esta matriz define a fronteira de migração. Ela não autoriza converter todos os
fluxos em uma única operação genérica: cada tipo de evento conserva suas regras
de domínio, mas uma aprovação rastreável deve convergir para a mesma função
canônica e para as mesmas barreiras físicas.

Status utilizados:

- **BLOQUEADO:** não pode entrar em shadow/canário sem correção prévia;
- **SHADOW ELEGÍVEL:** pode comparar decisões sem efeito produtivo v4;
- **FORA DO PRIMEIRO CANÁRIO:** permanece no comportamento atual até a matriz
  funcional correspondente passar;
- **NÃO DESTRUTIVO:** somente leitura/projeção; não é produtor de aprovação.

## Matriz

| Fluxo | Autoridade/fatos atuais | Lacuna de compatibilidade | Tratamento v4 proposto | Prova mínima antes de canário | Estado inicial |
| --- | --- | --- | --- | --- | --- |
| Leitura rastreável online | receipt v2/v3, `production_stage_readings`, collection event | múltiplos entrypoints, v2 não reproduzível integralmente, v3 só assíncrono | envelope v4 fixado no IndexedDB; `collect_and_decide_v4` chama decisão canônica; fallback recebe apenas `receipt_id` | ACK/decisão SLO; mesmo ID 100x; mesmo código em 2/20/100/500 devices; ledger/outbox únicos | SHADOW ELEGÍVEL após schema/segurança |
| Replay offline rastreável | fila local + receipt, PGMQ replay | source modes incompletos; replay pode competir com live | mesma pipeline fixada; microbatches com backpressure; filas separadas e prioridade live:replay 4:1 medida | evento antigo após online; backlog + live; resposta perdida; fila retorna ao baseline | BLOQUEADO |
| Entrada manual legacy | `production_entries`, fila `localStorage` | sem receipt forte, hash, sequence, ledger ou outbox; correção CRUD | preservar fatos existentes; novo comando idempotente próprio com receipt v4 e outbox, sem inventar peça física | criação/retry/resposta perdida/correção; histórico e KPI reconciliados | FORA DO PRIMEIRO CANÁRIO |
| Quantidade não rastreável | `production_entries` + `manual_production_records` | cálculo amplo e lifecycle na transação; não representa uma peça | comando quantitativo v4 distinto; fato manual canônico + outbox/deltas; nunca forçar unique por peça | retries, virada de turno/lote, metas e delta compensatório | FORA DO PRIMEIRO CANÁRIO |
| Reposição | reading/event/audit + replacement order | processador próprio, recálculo síncrono e wrapper v3→v2 | adapter de evento `replacement_stage`; mesma barreira peça/etapa/ciclo; efeitos de ordem explícitos no domínio | duas estações, rota, encerramento, retry após commit, zero dupla aprovação | BLOQUEADO |
| Aprovar/liberar reposição | replacement order + nova peça; sem reading/event nesse passo no runtime atual | autoridade administrativa separada cria/libera peça e pode correr com estação | manter comando administrativo idempotente distinto; nunca tratá-lo como aprovação física; vincular versão/audit à peça substituta | aprovação simultânea, liberação repetida, permissão negativa e peça única | BLOQUEADO |
| Conclusão forçada de reposição | readings `approved` de ajuste + estado de peça/order + audit | impl privilegiado cria várias aprovações sem receipt/outbox canônico | operação administrativa versionada, chave idempotente, motivo e delta compensatório; usar a mesma barreira física e resultado auditável | retry pós-commit, duas chamadas simultâneas, rota parcial e autorização negativa | BLOQUEADO |
| Retrabalho | `rework_orders`, nova peça, eventos | nome de argumento JS/SQL diverge; índices antigos podem impedir novo ciclo | corrigir contrato; ciclo novo explícito; aprovação posterior usa função canônica e unique normalizada por ciclo | ciclos 1/2, original bloqueada, rota completa, compensação | BLOQUEADO |
| Rejeição | reading rejected + qualidade/reposição; fallback direto | contexto cliente confiado em parte; fallback pode retornar sucesso parcial | comando server-side resolve contexto e registra resultado terminal; reposição via outbox/saga idempotente | usuário sem célula, setor distinto, retry, falha entre quality e replacement | BLOQUEADO |
| Correção/reversão | CRUD entry, special release, eventual update de reading | mutação sem revision/outbox uniforme; mistura correção de fato e override | revisão append-only/autorizada, reason code e delta compensatório; nunca sobrescrever/apagar fato | aprovação→reversão→reprojeção; auditoria; permissão negativa | BLOQUEADO |
| Encerramento de lote | vários updates/RPCs sobre lote/order | múltiplas autoridades e scans no hotpath | comando de lifecycle idempotente separado da coleta; projeção pode sugerir elegibilidade, servidor decide | corrida última peça/fechamento; novo lote/contexto; rollback sem reabrir fatos | BLOQUEADO |
| Embalagem | packing volume/items/scans, peça/evento, lote `packed` | sequência multichamada, sem receipt/outbox, updates diretos | manter fatos próprios; criar comando transacional/idempotente antes de migrar; publicar delta após commit | scan duplicado, remover/reabrir volume, falha intermediária, lote completo | FORA DO PRIMEIRO CANÁRIO |
| Expedição | shipment/items/scans/exceptions + lot/order/pieces | release multichamada e update em massa não idempotente | comando administrativo versionado com chave de operação e log; outbox para projeções | retry cego, release parcial, permissão/setor, lote já expedido | FORA DO PRIMEIRO CANÁRIO |
| Marcenaria moderna | RPC direto de produção | bypass do receipt/pipeline | adaptar ao envelope v4 e à decisão canônica | peça moderna, duplicidade cross-device, rota anterior | BLOQUEADO |
| Marcenaria legacy | `lot_step_events` | ledger paralelo considera `finish` conclusão | preservar histórico; mapear regra e migrar somente com reconciliação formal | comparação dos dois ledgers e aceite de domínio | FORA DO PRIMEIRO CANÁRIO |
| Histórico | readings + lot step events + events + estado atual da peça | mistura fato e estado mutável na apresentação | snapshot/versioned query com origem explícita; nunca reclassificar passado pelo estado atual | resultados v2/v3/v4, correções e paginação sem PII | NÃO DESTRUTIVO |
| Importação PCP padrão | batches/chunks/rows + cadastros produtivos | chunks fazem scans/recalculo e podem criar estado parcial | manter fora do hotpath; manifest idempotente, commit/recovery auditáveis e outbox de cadastro | chunk duplicado, falha/restart, hash do arquivo, isolamento por setor | FORA DO PRIMEIRO CANÁRIO |
| XML/Promob | arquivo + batch/order/lot/items/tags/logs | várias chamadas de serviço; transação distribuída incompleta | tratar como workflow durável com passos idempotentes e compensação; sem credencial/chave de `service_role` no cliente | falha em cada boundary, resume pelo mesmo batch, reconciliação exata | FORA DO PRIMEIRO CANÁRIO |
| Delete Promob | remoção de storage + RPC; fallback browser apaga fatos/cadastros em cascata | storage antes do banco, chamadas independentes, apaga ledger/eventos/evidência | desabilitar fallback; comando administrativo server-side idempotente com autorização, retenção/tombstone e trilha append-only | falha antes/depois de cada boundary, retry, acesso negado, zero deleção de fatos protegidos | BLOQUEADO |
| Reset produtivo | remoção em lote do storage + `reset_production_data`/TRUNCATE | controle admin na UI, janela parcial e destruição incompatível com preservação | retirar de papéis comuns; fluxo de manutenção separado com change control; vNext nunca o usa em cleanup/capacity | autorização server-side, simulação em staging vazio, recovery e prova de preservação | BLOQUEADO |
| Dashboard/KPIs | counters, shards, aggregates, lot/cell state, queries diretas | fontes sobrepostas, refetch amplo e shard 16/32 divergente | snapshot v4 por `revision/context_id`; deltas agrupados e shards fixos; Broadcast apenas invalida | ledger=projeção; lote/turno separados; gap/resync; p95/p99 | NÃO DESTRUTIVO |
| Auth/sessão operacional | Supabase Auth + profile + operator session | falhas transitórias e unmount podem encerrar sessão | state machine, session epoch, single-flight, cache, heartbeat DEGRADED e refresh propagado | 100 devices, 2 sessões permitidas, storm, offline, logout durante retry | BLOQUEADO |
| Realtime | Postgres Changes global + canais locais v3 | sem registry/refcount/setor/revision; canais sobrepostos | cliente singleton, registry, tópicos privados `mes:<sector>:...`, coalesce e snapshot | authz positiva/negativa, token refresh, Broadcast perdido, stale/poll fallback | BLOQUEADO |

## Invariantes transversais

1. O mesmo `client_event_id` não pode ganhar efeito produtivo em v2/v3/v4.
2. Uma resposta incerta é reconciliada no pipeline já fixado; não cria novo ID.
3. Somente `APPROVED` confirmado pelo banco produz feedback positivo.
4. `operator_id`, célula, máquina, setor, lote, turno, permissão e resultado são
   resolvidos no servidor.
5. Aprovação rastreável produz ledger, resultado e outbox na mesma transação.
6. Operação terminal não entra em retry infinito; falha desconhecida não vira
   aprovação ou retry genérico.
7. Correção/reversão preserva o fato original e aplica revisão/delta
   compensatório.
8. Projeção e Broadcast nunca são a autoridade da aprovação.
9. Rollback impede capturas/claims novos, mas preserva receipts, ledger, outbox,
   filas, archive e DLQ.
10. Um fluxo só avança de “bloqueado” após testes positivos, negativos, de corrida
    e reconciliação ligados a um run imutável.

## Escopo recomendado do primeiro shadow

Somente leitura rastreável online, limitada a uma cópia sanitizada do comando. O
shadow v4 pode resolver e comparar a decisão, mas não pode inserir reading
canônico, alterar peça/lote, gerar outbox produtivo nem publicar feedback ao
dispositivo. Divergências devem ser registradas com hash do input, reason code e
versões, sem payload sensível.

O shadow fica bloqueado enquanto o schema runtime não for reproduzível e os
grants/RPCs críticos não forem endurecidos. O primeiro canário só é considerado
após testes reais de concorrência, rota completa, Auth/Realtime e rollback em
staging representativo.

## Rollback por classe de fluxo

| Classe | Ação de rollback | Preservação obrigatória |
| --- | --- | --- |
| v4 rastreável | desligar ingresso por escopo, parar claims com fencing, manter decisões commitadas e pausar/drainar projetor conforme causa | receipt, reading, event, outbox, PGMQ/archive/DLQ e pipeline fixada |
| fluxo legacy ainda não migrado | manter comportamento anterior; não receber automaticamente eventos v4 | fatos legacy e chaves de idempotência existentes |
| projeção/dashboard | pausar publicação/snapshot afetado e reconstruir somente a projeção identificada | ledger, facts manuais, contexts e revisions |
| Auth/Realtime frontend | desabilitar feature flag cliente e voltar ao snapshot/poll controlado | sessão Auth válida, sessão operacional e fila IndexedDB |
| correção administrativa | interromper novas revisões; nunca desfazer por delete | revisão original, delta, ator autorizado e reason code |

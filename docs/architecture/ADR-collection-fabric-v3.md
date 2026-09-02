# ADR — AC.Prod Collection Fabric v3

## Status

Proposto. A implementação permanece desabilitada por padrão e não está autorizada para produção antes dos testes de concorrência e do piloto descritos neste documento.

## Contexto

O pipeline v8.7–v9.2.3 já separa o `INSERT` no inbox `coletas_producao` da decisão produtiva, mas o worker ainda chama um RPC por evento. A decisão escreve projeções compartilhadas no mesmo limite transacional do fato da peça. Na amostra validada pelo diagnóstico técnico, 478 leituras produziram 149 erros, 260 tentativas adicionais, 111 `statement timeout` e 24 deadlocks. Uma amostra versionada posterior apresentou `queue age` p50 de 8,5 s, p95 de 110,9 s e p99 de 141,7 s.

O sistema está em produção, usa PostgreSQL 17/Supabase, React/Vite, IndexedDB e código produtivo com exatamente oito dígitos. Perda de recibos, dupla aprovação, parada para migração e exposição de credenciais são inaceitáveis.

O inventário também encontrou drift crítico entre Git e runtime: `process_production_reading_impl_v2`, `finalize_collection_realtime`, `production_lot_stage_aggregates` e seu trigger existem no banco, mas não possuem DDL canônico nas migrations ativas. Portanto, nenhuma migration v3 pode presumir suas definições.

## Decisão

Adotar três limites transacionais independentes, mantendo o PostgreSQL como sistema de registro:

1. **Ingresso:** valida uma sessão operacional por micro-lote, persiste recibos set-based, aplica idempotência e publica referências em PGMQ. Retorna ACK sem executar regra produtiva.
2. **Decisão:** consome mini-lotes, resolve peças antes das escritas, ordena e trava somente IDs de peça, valida rota/etapa e grava o ledger `production_stage_readings`, o resultado auditável e o outbox na mesma transação.
3. **Projeção:** consome o outbox, aplica deltas idempotentes em shards e atualiza contadores, dashboards e espelhos legados fora da decisão.

O rollout é controlado pelas flags `collection_pipeline_v3_ingress`, `collection_pipeline_v3_worker`, `collection_pipeline_v3_projection` e `collection_pipeline_v3_broadcast`. Todas começam desligadas. O mesmo recibo nunca pode ser roteado produtivamente para v2 e v3.

Antes da primeira tentativa de rede, o frontend fixa `pipeline_version` no
IndexedDB. Uma resposta incerta continua sendo reconciliada no mesmo pipeline;
uma mudança de flag nunca move automaticamente o mesmo `client_event_id` entre
v2 e v3. A única exceção é uma primeira tentativa que recebe o erro definitivo
`COLLECTION_PIPELINE_V3_INGRESS_DISABLED`: o RPC verifica essa flag antes de
qualquer escrita, então a captura ainda sem recibo pode ser reatribuída ao v2.

### Fontes de verdade

| Objeto | Classe | Papel v3 |
| --- | --- | --- |
| `coletas_producao` | C — auditoria crítica | Recibo físico imutável, ACK, contexto confiável e estado do transporte. |
| `production_stage_readings` | A — fato produtivo crítico | Ledger canônico da decisão. A unicidade peça + etapa + ciclo continua sendo a barreira física contra dupla aprovação. |
| `production_pieces` | A/B — fato e validação | Estado exclusivo da peça; único agregado mutável travado na decisão. |
| `operator_sessions` e assignments | B — validação crítica | Origem server-side de operador, célula e máquina; o cliente não é confiável para esses IDs. |
| `production_collection_events` | C — auditoria crítica | Resultado e compatibilidade de histórico por `client_event_id`. |
| `collection_processing_attempts` | C — auditoria crítica | Tentativas append-only com SQLSTATE e tempos, sem sobrescrita. |
| `collection_projection_outbox` | C/D — ponte durável | Comprometido junto com o fato; origem de todas as projeções. |
| `production_lot_stage_counter_shards` | D — projeção | Contagem fragmentada e reconstruível por lote/etapa. |
| `production_realtime_counters` | D — projeção | Cache legado por célula/máquina, atualizado apenas pelo projetor. |
| `production_lot_stage_aggregates` | D — projeção runtime | Compatibilidade legada; definição deve ser capturada do catálogo antes do piloto. |
| `production_cell_lot_states`, `production_cell_active_contexts` | D — projeção | Cache de dashboards e contexto operacional. |
| `production_events`, `production_entries` | E — compatibilidade legada | Espelhos idempotentes criados pelo projetor; não participam da decisão. |
| progresso em lote/pedido/batch | D/E — projeção | Reconciliado em lote a partir do ledger, fora do caminho crítico. |

### Triggers

Regras críticas de enriquecimento, rejeição/reposição e snapshots permanecem ativas. Os triggers de projeção `trg_sync_production_lot_stage_aggregate`, `trg_sync_realtime_counter_stage_readings` e `trg_sync_reading_to_event` devem continuar funcionando para linhas v2 e ser ignorados apenas quando `production_stage_readings.pipeline_version = 3`.

Como uma das definições só existe no runtime, a migration não a reescreve por memória. Ela captura `pg_get_triggerdef`, função, eventos, condição e checksum em um registry privado; recria guards equivalentes por operação; e mantém rotina de restauração. Se qualquer trigger obrigatório estiver ausente ou a reconstrução não puder ser provada, a flag do worker não pode ser habilitada e o health retorna `ready=false`.

## Alternativas consideradas

| Alternativa | Benefícios | Custos/riscos | Decisão |
| --- | --- | --- | --- |
| Aumentar timeout ou manter concorrência 2 | Mudança pequena | Mascara hot rows, mantém atraso e não resolve deadlocks | Rejeitada |
| Aumentar concorrência no worker atual | Mais paralelismo aparente | Amplifica contenção em lote/célula e retries | Rejeitada |
| Kafka/RabbitMQ externo | Isolamento e escala | Nova infraestrutura, operação e superfície de falha desnecessárias para a escala alvo | Adiada |
| PGMQ + outbox no PostgreSQL | Durabilidade transacional, visibility timeout, archive e operação já integrada ao Supabase | Consistência eventual e necessidade de projetor/reconciliação | Escolhida |
| Event sourcing completo | Reconstrução total | Complexidade desproporcional e migração de domínio ampla | Rejeitada; ledger append-only + outbox é suficiente |
| Reutilizar `process_production_reading_impl_v2` no worker v3 | Preserva regras atuais | Mantém hot rows e o DDL da função não é reprodutível | Rejeitada para decisão v3 |
| Desabilitar todos os triggers na sessão | Simples | Pode suprimir FKs e regras críticas; inseguro | Rejeitada |

## Contrato do evento

`client_event_id` é imutável e idempotente. `device_sequence` é monotônico por equipamento e possui unicidade parcial com `device_id`. O IndexedDB armazena apenas IDs e snapshots não sensíveis; nunca armazena JWT ou token operacional em cada evento. O RPC resolve `operator_id`, `cell_id` e `machine_id` a partir de `operator_session_id`, `auth.uid()` e `device_id`.

Os estados locais são: `CAPTURED_LOCAL`, `PENDING_DATABASE`, `DATABASE_ACKNOWLEDGED`, `PROCESSING`, `APPROVED`, `REJECTED`, `BLOCKED`, `DUPLICATED`, `PENDING_REVIEW`, `RETRYING` e `DEAD_LETTERED`. Somente `APPROVED` autoriza cor/som de aprovação.

## Concorrência e idempotência

- ingresso máximo inicial: 25 eventos por chamada;
- consumo inicial: mini-lotes de 5–25, live:replay em 4:1;
- locks adquiridos em ordem de `piece_id`, nunca por lote/célula/máquina/operador;
- `pg_advisory_xact_lock` e `FOR UPDATE` continuam por peça;
- `lock_timeout` inicial de 500 ms e `statement_timeout` de 5 s apenas em staging;
- máximo de cinco tentativas transitórias, com backoff exponencial e jitter determinístico;
- falhas de validação/autorização são terminais;
- outbox e projections possuem chaves idempotentes; redelivery não duplica contagem;
- revisões posteriores do ledger geram uma nova `projection_revision`, com
  `previous_decision` e deltas compensatórios; uma aprovação revertida não deixa
  contadores ou espelhos legados divergentes;
- a aprovação quantitativa entra no realtime somente pelo trigger de
  `production_entries`; o projetor não soma a mesma aprovação diretamente;
- PGMQ live/replay/projection/DLQ usa tabelas logged e archive, nunca `pop()`.

O catálogo ainda pode conter os índices legados `uq_approved_item_step` e
`uq_stage_readings_item_step_approved`, mais restritivos que a unicidade canônica
por `piece_id + step_name + production_cycle`. Eles não são removidos nesta
mudança. Retrabalho com novo ciclo e `item_id` preenchido é um gate explícito de
compatibilidade em staging; qualquer remoção futura exige janela de observação e
`EXPLAIN (ANALYZE, BUFFERS)` documentado.

## Realtime

Broadcast privado acelera a UI, mas o recibo persistido é a fonte de verdade. Existem no máximo um canal por equipamento e um por célula. A reconexão consulta os `client_event_id` ainda não finais. As policies em `realtime.messages` autorizam somente o equipamento, a célula atribuída ou um evento pertencente ao usuário autenticado. Payloads não contêm token, matrícula completa ou segredo.

## Consequências e mitigação

Positivas:

- o ACK deixa de depender de KPIs e dashboards;
- contenção de projeções deixa a transação da peça;
- o ledger permite reconstrução e auditoria;
- live não fica atrás do replay offline;
- cada tentativa e atraso passa a ser mensurável.

Negativas:

- dashboards tornam-se eventualmente consistentes;
- há dois workers, quatro filas e runbooks adicionais;
- durante o rollout coexistem caminhos v2 e v3, aumentando a necessidade de gates;
- o drift do runtime impede declarar o schema integralmente reproduzível nesta mudança.

Mitigações:

- flags desligadas e habilitação progressiva;
- outbox, DLQ, health fail-closed e reconciliação;
- captura/checksum/restauração de triggers antes de qualquer piloto;
- endpoints dos workers derivados e validados contra o próprio ambiente, nunca
  fixados no project ref de produção;
- polling leve apenas quando Broadcast estiver desconectado ou envelhecido;
- staging com o mesmo plano/compute antes de afirmar capacidade.

## Critérios de habilitação

O worker v3 não pode ser ligado enquanto qualquer condição for falsa:

- todos os objetos e privilégios esperados existem;
- os três triggers de projeção foram capturados e protegidos para `pipeline_version=3`;
- nenhuma mensagem v3 está sendo processada pelo v2;
- SQL, Vitest e Playwright passaram;
- k6 em staging demonstrou zero perda/dupla aprovação/deadlock/timeout e cumpriu os percentis definidos;
- DLQ está vazia ou cada item possui decisão operacional;
- worker e projetor possuem heartbeat recente;
- runbooks de deploy e rollback foram ensaiados.

## Rollback

Desligar primeiro o worker e logo depois o ingresso v3, para parar claims e
redirecionar somente capturas novas. Broadcast pode ser desligado em seguida;
o projetor pode drenar decisões íntegras ou ser pausado se ele próprio for a
causa. Recibos, filas, archive, outbox e ledger v3 são preservados. Mensagens já
decididas não são reenviadas ao v2. O registry restaura os triggers originais
somente após o pipeline v3 parar e não haver decisão em andamento. Nenhum
rollback apaga fato ou fila.

## Gatilhos para revisitar a decisão

- `queue age` p99 acima de 2 s após ajuste comprovado do compute;
- shards com contenção mensurável (avaliar módulo 32);
- throughput sustentado incompatível com PGMQ/PostgreSQL;
- necessidade regulatória de retenção/replay superior ao archive atual;
- time de operação capaz de sustentar broker externo com benefício comprovado.

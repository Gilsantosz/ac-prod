# Relatório de capacidade — Collection Fabric v3

Status: **CAPACIDADE NÃO VALIDADA**.

Nenhum teste k6 do v3 foi executado como parte desta alteração. Não existe neste
documento uma alegação de throughput sustentável, quantidade suportada de
equipamentos ou SLO atingido. Preencha o relatório somente com artefatos medidos
no compute real/representativo do alvo. Um smoke, revisão de código ou resultado
do pipeline v2 não valida a capacidade v3.

## Identificação da rodada

| Campo | Valor |
| --- | --- |
| Ambiente/projeto | a preencher |
| Região | a preencher |
| PostgreSQL/compute | a preencher |
| Pooler/conexões | a preencher |
| Commit | a preencher |
| Migrations/releases | a preencher |
| Edge runtime/versão | a preencher |
| Frontend/app version | a preencher |
| Flags e rollout scope | a preencher |
| Massa/fixture checksum sanitizado | a preencher |
| Janela e responsáveis | a preencher |

Registre CPU, memória, I/O, WAL, conexões e limites do ambiente. Se staging não
for equivalente ao alvo, documente a diferença e não extrapole linearmente.

## Baseline disponível

A baseline histórica versionada está em
[collection-fabric-v3-baseline.md](collection-fabric-v3-baseline.md). Ela descreve
o pipeline anterior e serve para comparação, não como evidência de capacidade do
v3. Registre aqui um health v3 imediatamente antes da rodada, com filas vazias,
DLQ vazia e sem tráfego concorrente não controlado.

| Métrica pré-teste | Valor | Artefato |
| --- | --- | --- |
| receipts/estado | a preencher | a preencher |
| live/replay/projection queue | a preencher | a preencher |
| DLQ | a preencher | a preencher |
| workers/heartbeats | a preencher | a preencher |
| retries/SQLSTATE | a preencher | a preencher |
| CPU/memória/I/O/conexões | a preencher | a preencher |

## Método reproduzível

Use [tests/load/collection-fabric-v3.js](../../tests/load/collection-fabric-v3.js)
conforme o [runbook de implantação](../runbooks/collection-fabric-v3-deploy.md).
Cada rodada usa `K6_RUN_ID` e faixa `K6_SEQUENCE_BASE` próprios, fixture fora do
Git e 100 sessões/dispositivos reais de staging. Todos os códigos devem ter oito
dígitos, ser exclusivos na rodada e representar peças válidas na etapa/rota.

O gerador faz polling em lote dos receipts para medir fim a fim. Inclua essa carga
de leitura na descrição; não subtraia seus efeitos. Os workers, wakeups e cron
devem usar exatamente a configuração candidata, sem aumento de timeout ou redução
da carga após uma falha.

| Perfil | Workload exato | Massa mínima | Execuções mínimas |
| --- | --- | --- | --- |
| smoke | 1 evento live | 1 código/dispositivo | 1 por deploy |
| idempotency | 20 eventos, cada um entregue 5 vezes | 20 códigos/dispositivos | 1 + teste SQL concorrente |
| microbatch | 5 clientes × 25 eventos em paralelo | 125 códigos, 5 dispositivos | 3 |
| priority | seed replay 5 × 25; depois 20 live/s e 5 replay/s por 60 s | 1.625 códigos, 100 dispositivos | 3 |
| contention_piece | 20 dispositivos lançam a mesma peça dentro de 100 ms | 1 código, 20 dispositivos | 3 |
| contention_cell_lot | 50 dispositivos, mesma célula/lote, peças distintas dentro de 100 ms | 50 códigos, 50 dispositivos | 3 |
| nominal | 100 canais privados + 100 identidades, 30 eventos/s por 10 min | 18.000 códigos | 3 após aquecimento |
| burst | 100 eventos/s por 60 s | 6.000 códigos, 100 dispositivos | 3 |

As falhas após claim e do projetor continuam exigindo controle transacional
específico; elas não são substituídas pelos perfis de throughput/contensão.

## Critérios e resultados

| Critério | Meta | Resultado | Evidência | Status |
| --- | ---: | ---: | --- | --- |
| evento perdido | 0 | não medido | a preencher | NÃO VALIDADO |
| dupla aprovação | 0 | não medido | a preencher | NÃO VALIDADO |
| IndexedDB p95 | ≤ 25 ms | não medido pelo k6 | browser trace a preencher | NÃO VALIDADO |
| ACK banco p95 | ≤ 250 ms | não medido | `collection_ingress_ack_ms` | NÃO VALIDADO |
| decisão nominal p95 | ≤ 800 ms | não medido | `collection_decision_ms` | NÃO VALIDADO |
| decisão p99 | ≤ 2.000 ms | não medido | `collection_decision_ms` | NÃO VALIDADO |
| projeção após commit p95 | ≤ 500 ms | não medido | `collection_projection_ms` | NÃO VALIDADO |
| queue age nominal p99 | ≤ 2.000 ms | não medido | `collection_queue_age_ms` | NÃO VALIDADO |
| deadlock caminho normal | 0 | não medido | health/SQLSTATE | NÃO VALIDADO |
| statement timeout caminho normal | 0 | não medido | health/SQLSTATE | NÃO VALIDADO |
| retry normal | próximo de 0; gate < 1% | não medido | health/attempts | NÃO VALIDADO |
| DLQ | 0 | não medido | health/PGMQ | NÃO VALIDADO |
| canais privados nominais | 100 por 10 min; cada um recebe finalized | não medido | métricas WebSocket k6 | NÃO VALIDADO |
| ledger = projeções após reconcile | 100% | não medido | query a preencher | NÃO VALIDADO |

O threshold de k6 falhar é NO-GO. Não descarte outliers, aumente timeout, reduza
VUs ou mude batch/concurrency sem abrir uma nova rodada claramente identificada.

## Resultados por rodada

| Run ID | Perfil | Início/fim | Eventos enviados/ACKados/finalizados/projetados | Thresholds | Artefatos |
| --- | --- | --- | --- | --- | --- |
| a preencher | a preencher | a preencher | a preencher | NÃO EXECUTADO | a preencher |

Para cada run, anexe summary JSON do k6, séries temporais do Supabase, health antes
e depois, contagens por `client_event_id`/pipeline, tentativas, filas/archives/DLQ
e logs sanitizados dos workers. A soma deve fechar:

```text
capturados = ACK persistidos + rejeições explícitas de ingresso
ACK persistidos = decisões finais + pendentes em fila + DLQ explícita
decisões com outbox = projeções aplicadas + outbox pendente + DLQ explícita
```

## Concorrência, erros e causa raiz

| SQLSTATE | Função/cenário | Contagem | p95/max | Retry/backoff | Causa/correção |
| --- | --- | ---: | ---: | --- | --- |
| a preencher | a preencher | a preencher | a preencher | a preencher | a preencher |

Documente locks por peça, lock wait, hot rows, conexões e utilização máxima. Para
cada falha: preserve o caso, crie teste reproduzível, corrija a causa, repita sem
relaxar o workload e relacione os artefatos antes/depois.

## Compatibilidade e reconciliação

| Consumidor/regra | Comparação v2/v3 | Divergência | Evidência/aprovação |
| --- | --- | --- | --- |
| histórico | a preencher | a preencher | a preencher |
| KPIs/dashboard | a preencher | a preencher | a preencher |
| lote/turno | a preencher | a preencher | a preencher |
| reposição/retrabalho/rejeição | a preencher | a preencher | a preencher |
| encerramento de lote | a preencher | a preencher | a preencher |
| shards vs ledger | a preencher | a preencher | a preencher |

## Conclusão e gate

| Pergunta | Resposta atual |
| --- | --- |
| Capacidade nominal de 30 eventos/s por 10 min validada? | **NÃO** |
| Rajada de 100 eventos/s por 60 s validada? | **NÃO** |
| 100 equipamentos validados? | **NÃO** |
| SLOs e integridade validados no compute alvo? | **NÃO** |
| Autorizado expandir para produção? | **NÃO** |

Somente após todas as rodadas e reconciliações aprovadas este bloco pode registrar
capacidade sustentável, margem e limites operacionais. Até lá, health deve manter
`capacity_estimate=null` e a decisão de release é **NO-GO**.

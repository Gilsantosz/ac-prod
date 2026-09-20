# Relatório de capacidade — Collection Fabric v3

Status: **CAPACIDADE NÃO VALIDADA / NO-GO**.

Nenhum teste mutante k6 do v3 foi executado como parte desta alteração. A
sondagem inicial do gate público falhou; após o cache de auditoria aplicado em
13/09, a repetição curta de 20/09 passou. Não existe neste documento uma
alegação de throughput sustentável, quantidade suportada de equipamentos ou SLO
atingido. Preencha o relatório somente com artefatos medidos no compute
real/representativo do alvo. Um smoke, revisão de código ou resultado do pipeline
v2 não valida a capacidade v3.

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

### Revalidação de 20/09/2026

O smoke público fez **1.528 GETs em 50 segundos**, com zero falhas HTTP,
zero iterações descartadas e 3.056 verificações aprovadas. Latência do gate:
p95 **77,44 ms**, p99 **114,58 ms**, máximo **280,47 ms**. O script exige
snapshot fresco e ainda não expirado, além do contrato de release.
Artefato: [resumo k6](../evidence/capacity/20260920-readonly-smoke.json).

A rampa longa terminou com **28.200 GETs**, zero falhas HTTP, zero iterações
descartadas e 56.400 verificações aprovadas. Sustentou 40 GET/s por dez minutos,
além da rampa inicial e redução final (12 min 30 s de cenário). Latência:
p95 **87,17 ms**, p99 **165,18 ms**, máximo **1.897,13 ms**. Todos os thresholds
passaram, com parada automática mantida. Artefato:
[resumo k6 global somente leitura](../evidence/capacity/20260920-readonly-global.json).

As amostras de banco de 13:05:10Z e 13:18:00Z tiveram o mesmo `stats_reset`:
delta de deadlocks 0, rollbacks 2, commits 29.001 e temporários 77.462.072 bytes.
Havia tráfego concorrente do aplicativo e jobs; esses deltas não são atribuídos
exclusivamente ao teste. As duas amostras registraram zero esperas por lock,
16/22 conexões e snapshot fresco. Isso não comprova ausência de espera entre
amostras nem desempenho de gravação.

Essa medição não executa login, ingresso de peças, projeção nem WebSocket.
Os 1.000 IDs lógicos do perfil são identificadores de requisição; não são
1.000 operadores autenticados. Portanto, não comprovam capacidade produtiva.

Na mesma retomada, os 38 testes em PostgreSQL local passaram (cache, permissões,
TTL e invalidação; auditores e cron simulados). O teste de navegador local passou
com três sessões em Corte/Bordo, decisões concorrentes, lotes no modo normal e
foco, proteção contra duplicatas e ausência de GET por confirmação comum. Esse
teste usa respostas HTTP simuladas; não mede o banco de produção.

A correção do frontend aplica somente decisões já confirmadas pelo servidor ao
histórico, lote e indicadores. Atualizações originadas em outro aparelho são
reconciliadas em 60–90 segundos enquanto a tela está visível e conectada, ou ao
retomar foco/conexão. Corridas entre consulta e confirmação recebem duas
tentativas agrupadas em 3 e 8 segundos. Essa latência de outros postos não deve
ser apresentada como atualização instantânea global.

O ensaio mutante global permanece bloqueado por ausência de ambiente isolado
disponível e fixture validada de 1.000 usuários/sessões com peças reservadas.
Nenhum recurso pago foi criado e nenhuma massa produtiva foi apagada.

A baseline histórica versionada está em
[collection-fabric-v3-baseline.md](collection-fabric-v3-baseline.md). Ela descreve
o pipeline anterior e serve para comparação, não como evidência de capacidade do
v3. Registre aqui um health v3 imediatamente antes da rodada, com filas vazias,
DLQ vazia e sem tráfego concorrente não controlado.

### Smoke somente leitura abortado — 2026-09-13

O perfil curto consultou apenas
`GET /rest/v1/rpc/get_public_collection_immediate_release` e foi interrompido em
aproximadamente dez segundos. O artefato local `.k6-readonly-smoke.json` registrou
23 requisições: 11 respostas esperadas e 12 falhas. As respostas esperadas ainda
ficaram abaixo de 0,5 s, mas as chamadas seguintes se acumularam até quase o
timeout de 5 s.

| Sinal | Resultado observado |
| --- | ---: |
| requisições / respostas esperadas / falhas | 23 / 11 / 12 |
| taxa de falha HTTP | 52,17% |
| iterações descartadas | 13 |
| latência geral p95 / p99 / máximo | 4.980,7 / 4.984,3 / 4.985,3 ms |
| latência das respostas esperadas p95 / máximo | 399,7 / 480,4 ms |
| VUs observados / máximo provisionado | 61 / 63 |

Esse smoke histórico mostrou que o gate anterior ao cache não sustentava o começo da rampa proposta.
Ele não separa sozinho custo SQL de limite de rede/borda e não mediu ingresso. O
próximo passo é o diagnóstico GET-only pareado do runbook, comparando
`/auth/v1/health` com o gate em 1, 5, 10 e 15 req/s por endpoint.

### Auditoria funcional pós-correção — 2026-09-06

Esta verificação confirma o caminho funcional e a ausência do gargalo
single-flight; ela não substitui os perfis k6 nominal e burst.

| Sinal | Resultado observado |
| --- | ---: |
| ACK banco (captura → `received_at_db`) | 113,539 ms |
| espera até claim | 1.903,027 ms |
| processamento da decisão | 50,337 ms |
| decisão → projeção do recibo | 1.607,723 ms |
| repetição idempotente | 1 linha persistida |
| filas / DLQ após drenagem | 0 / 0 |
| erro / retry / deadlock / statement timeout | 0 / 0 / 0 / 0 |
| leituras aprovadas / fatos | 139 / 139; 0 ausentes |
| slots concorrentes validados | decisão 8; projeção 4; overflow bloqueado |
| verificações estruturais | 5 de 5 aprovadas |

O código inexistente `00000000` foi usado de propósito para atravessar ACK,
fila, decisão rejeitada, Broadcast e projeção sem aprovar uma peça produtiva. O
perfil `test` ficou `ready=true`; `capacity_estimate` permanece `null` até a
carga k6 no compute alvo.

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
Cada rodada usa `K6_RUN_ID`, faixa `K6_SEQUENCE_BASE` e janela `K6_CODE_OFFSET`
próprios, com fixture fora do Git. Os perfis nominais usam 100 identidades e a
prova global usa 1.000 sessões/dispositivos reais de staging. Todos os códigos
devem ter oito dígitos, ser exclusivos na rodada e representar peças válidas na
etapa/rota.

O gerador faz polling dos receipts por evento para medir fim a fim. Inclua essa carga
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
| global_ramp | 1.000 identidades HTTP; rampa até 40 eventos/s e sustentação por 10 min | 26.300 códigos, 1.000 sessões, ≥2 células, ≥2 postos/célula | 3 após nominal e burst |
| production_readonly | 1.000 IDs lógicos; GET público em rampa 10 → 35 → 40 req/s, sustentado por 10 min | sem fixture produtiva e sem escrita | 1 antes da janela mutante |

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
| WebSocket na coleta | 0 no perfil global; ACK/reconciliação usam HTTP | não medido | trace de rede da UI + contrato k6 | NÃO VALIDADO |
| ingresso global sustentado | 40 eventos/s por 10 min (2.400/min) | não medido | `global_ramp` | NÃO VALIDADO |
| leitura pública sem mutação | 40 GET/s por 10 min, 1.000 IDs lógicos | não medido | `production_readonly` | NÃO VALIDADO |
| ledger = projeções após reconcile | 100% | não medido | query a preencher | NÃO VALIDADO |

### Perfis de SLO versionados

| Perfil | ACK p95 | Decisão p95 / p99 | Projeção p95 | Queue p99 | Uso |
| --- | ---: | ---: | ---: | ---: | --- |
| `production` | < 250 ms | < 800 / 2.000 ms | < 500 ms | < 2.000 ms | promoção final |
| `test` | < 1.500 ms | < 1.500 / 5.000 ms | < 2.000 ms | < 5.000 ms | homologação global temporária |

Integridade, ausência de deadlock/timeout, DLQ vazia e taxas de erro/retry abaixo
de 1% continuam iguais nos dois perfis. Um resultado aprovado em `test` não pode
ser apresentado como capacidade de produção.

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
| 100 equipamentos nominais e 1.000 dispositivos HTTP globais validados? | **NÃO** |
| SLOs e integridade validados no compute alvo? | **NÃO** |
| Autorizado expandir para produção? | **NÃO** |

Somente após todas as rodadas e reconciliações aprovadas este bloco pode registrar
capacidade sustentável, margem e limites operacionais. Até lá, health deve manter
`capacity_estimate=null` e a decisão de release é **NO-GO**.

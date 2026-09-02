# Baseline operacional — Collection Fabric v3

Data: 2026-09-01. Horário do probe: 12:11 BRT aproximadamente.

## Estado estrutural observado

O RPC público `get_public_collection_runtime_health()` retornou:

- `ready=true`;
- `release_version=20260901_acprod_collection_runtime_health_security_v9_2_3`;
- `migration_version=v9.2.3`;
- `health_source=runtime_catalog`;
- `snapshot_used=false`.

Esse `ready` não é uma medida operacional: ele verifica catálogo, grants, RLS, Vault, cron, índices e literais de funções, mas não mede backlog, percentis, retries, deadlocks, timeouts ou heartbeat do worker.

## Diagnóstico validado fornecido para esta implantação

| Métrica | Valor |
| --- | ---: |
| Eventos analisados | 478 |
| Erros | 149 |
| Eventos com nova tentativa | 260 |
| Statement timeouts | 111 |
| Deadlocks | 24 |
| Duração frequente do worker | 14–28 s |

Esses números orientam o desenho, mas a consulta bruta que os produziu ainda não está versionada. O V3 adiciona `collection_processing_attempts` para tornar a próxima comparação reproduzível.

## Evidência já versionada

### Amostra de 31/08

- 121 itens sincronizados e 14 erros terminais;
- cinco sucessos com `queue_delay_ms` médio de 32.262 ms, p95 de 71.029 ms e máximo de 78.037 ms;
- processamento médio de 5.814 ms;
- burst de 19 eventos em cerca de 49 ms;
- 17 eventos com retry e 108 claims;
- conclusões entre aproximadamente 6,5 s e 78 s.

### Amostra de 01/09

- 51 leituras concluídas;
- 15 com mais de uma tentativa;
- máximo de sete tentativas;
- `queue age` p50 de 8,5 s, p95 de 110,9 s e p99 de 141,7 s;
- fila drenada ao final da amostra.

## Campos sem baseline confiável

Ainda não há medição reproduzível de:

- p50/p95/p99 do ACK de ingresso;
- p50/p95/p99 da decisão sob carga autenticada;
- p50/p95/p99 do lag de projeção e Broadcast;
- espera de lock por item;
- chamadas/tempo médio e máximo por função;
- capacidade sustentada no compute real;
- DLQ, pois ela não existia no pipeline atual.

Esses campos devem permanecer `não medido`, e não zero, até o teste em staging. Nenhuma capacidade é declarada nesta branch.

## Metas para comparação depois do staging

| Métrica | Meta |
| --- | ---: |
| IndexedDB p95 | <= 25 ms |
| ACK do banco p95 | <= 250 ms |
| decisão p95 / p99 nominal | <= 800 ms / <= 2 s |
| projeção p95 após commit | <= 500 ms |
| queue age p99 nominal | <= 2 s |
| perda / dupla aprovação / deadlock / statement timeout normal | 0 |

O relatório de capacidade só pode ser preenchido com saída k6 e métricas do PostgreSQL/Supabase no compute de staging equivalente ao produtivo.

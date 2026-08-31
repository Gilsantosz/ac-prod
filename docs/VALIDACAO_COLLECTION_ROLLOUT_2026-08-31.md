# Validação técnica — AC.Prod2 collection rollout v7

## Resultado no Supabase de produção

Projeto validado: `uozuzdfvnufsjsonswag`.

- RLS e Realtime ativos nas tabelas de estado/contexto;
- proteção transacional por peça com advisory lock e `FOR UPDATE`;
- validação sequencial da rota preservada;
- zero grupos de aprovação duplicada por peça/etapa/ciclo;
- zero lotes completos ainda abertos;
- zero lotes fechados com rota incompleta;
- zero eventos antigos presos em `processing`;
- zero sessões expiradas ainda abertas;
- campos de turno e snapshots de sessão presentes;
- compatibilidade do Histórico presente para front-ends em cache.

## Testes transacionais executados com rollback

### Duas máquinas, mesma numeração

- primeira leitura aprovada e segunda bloqueada com `DUPLICATE_PIECE_STAGE`;
- uma única leitura aprovada, uma única entrada produtiva e dois eventos auditáveis;
- peça avançou de `cut` para `edge`, sem conclusão prematura.

### Limites de turno

- 06:00–14:00: 05:59 fora, 06:00 dentro, 13:59 dentro e 14:00 fora;
- 22:00–06:00: 21:59 fora, 22:00 dentro, 02:00 dentro com data operacional anterior, 05:59 dentro e 06:00 fora.

### Lote sintético de 42 peças pelo RPC real

- após 41 peças: lote e célula abertos, 41 aprovadas e 1 pendente;
- na 42ª: célula e lote global fechados, `pending=0`, `progress=100`;
- `closed_at` e `actual_end` preenchidos;
- exatamente 42 peças concluídas, 42 leituras aprovadas, 42 entradas e 42 eventos.

Todos os cenários foram executados em transações encerradas com `ROLLBACK`. Nenhum dado sintético permaneceu.

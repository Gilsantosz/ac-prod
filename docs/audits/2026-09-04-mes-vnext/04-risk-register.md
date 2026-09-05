# Matriz de riscos — MES vNext

Escala: impacto e probabilidade de 1 (baixo) a 5 (crítico). A prioridade é o
produto dos dois valores. “Bloqueia” indica o gate que deve permanecer fechado.

| ID | Risco observado | I | P | Prioridade | Evidência | Bloqueia | Tratamento obrigatório |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| R-01 | Recibos declarados sincronizados sem fato produtivo correlacionado | 5 | 5 | 25 | 471/554 recibos sincronizados sem evento/leitura no snapshot; 59 v3 aprovados referenciam leitura ausente | integridade, GO | preservar dados; classificar cada recibo; reconciliar por `client_event_id`; nenhuma reexecução cega |
| R-02 | Drift impede recriar o runtime a partir da `main` | 5 | 5 | 25 | 154 migrations runtime versus 167 arquivos; objetos runtime-only e timestamps divergentes | deploy, rollback | capturar DDL literal, owner/grants/dependências e checksums; criar baseline e migrations aditivas |
| R-03 | Rotina destrutiva pode apagar fatos sem apagar recibos | 5 | 3 | 15 | `reset_production_data_impl()` contém `TRUNCATE ... RESTART IDENTITY CASCADE`; causalidade histórica não provada | integridade, segurança | retirar execução de papéis comuns, introduzir controle administrativo seguro; nunca executá-la na auditoria |
| R-04 | Mesmo evento pode passar por caminhos produtivos heterogêneos | 5 | 4 | 20 | v2 direto, v3, manual, reposição, rejeição, packing, shipping e fallback escrevem conjuntos distintos | resultado único | criar boundary canônico v4; fixar pipeline no primeiro attempt; matriz e shadow comparison |
| R-05 | Lease global serializa cada tipo de worker | 4 | 5 | 20 | PK atual apenas em `worker_kind`; 70/142 heartbeats sem finalização e stale | performance, escala | slots configuráveis com heartbeat, fencing e orçamento de conexões |
| R-06 | Worker por Edge Function/wakeup não é runtime persistente de consumo | 4 | 5 | 20 | 3 crons/15 s, wakeup HTTP e RPC por evento legado; latências longas nas invocações | decisão, fila | pool persistente próximo ao banco; Edge apenas control plane/sweeper/emergência |
| R-07 | Autorização privilegiada excessiva ou sem escopo setorial | 5 | 4 | 20 | 208 funções públicas `SECURITY DEFINER`; 5 executáveis por anon, 108 por authenticated; grants de escrita/TRUNCATE | segurança, cross-sector | implementação em `private`, wrappers mínimos, `search_path=''`, revoke/grant mínimo, testes negativos |
| R-08 | RLS não mitiga grants `TRUNCATE` e leitura global de counters | 5 | 4 | 20 | grants amplos e policies `USING true`; dimensões sensíveis de operação | segurança | revogar operação de tabela, policies por site/setor/assignment e testes REST/RPC por papel |
| R-09 | Tópicos Realtime não isolam setor e lifecycle é distribuído | 4 | 4 | 16 | tópicos `collection:*`/`production:*`, várias subscriptions independentes e ausência de registry/refcount | segurança, estabilidade | tópicos `mes:<sector>:...`, policy privada, singleton+registry, revision/gap/snapshot |
| R-10 | Falha transitória de Auth provoca logout involuntário | 5 | 4 | 20 | `signOut` em erros de perfil/restauração e unmount nos fluxos atuais | login, disponibilidade | portar state machine, single-flight, generation epoch, cache e testes de corrida/rede |
| R-11 | Reload de PWA durante captura pode interromper a cadeia local | 4 | 3 | 12 | `controllerchange` recarrega sem verificar captura/fila ativa | zero perda | adiar update durante captura/replay; estado e ação explícitos para operador |
| R-12 | IndexedDB não persiste o contrato completo e a transição inicial usa duas escritas | 5 | 4 | 20 | ausência de schema/trace/hash/setor/batch; `CAPTURED_LOCAL` e `PENDING_DATABASE` em transações separadas | zero perda, auditoria | uma transação local antes da rede; envelope v4 imutável; migração backward-compatible |
| R-13 | Aprovação, rejeição, avanço ou conclusão podem produzir efeitos sem recibo/outbox uniforme | 5 | 4 | 20 | manual/reposição/rejeição podem escrever fatos; embalagem/expedição avançam estado por limites transacionais distintos | integridade, KPI | adapters para função canônica quando houver decisão física; comandos idempotentes próprios para os demais workflows |
| R-14 | Barreira física usa `step_name`, não código normalizado, e o histórico Git contém definição obsoleta sem ciclo | 5 | 3 | 15 | runtime possui somente unique parcial por peça/etapa/ciclo; migration antiga sem ciclo continua no histórico | domínio, drift | definir `normalized_step_code`; impedir recriação da barreira obsoleta; migration faseada após teste |
| R-15 | Shard count diverge entre Git e runtime | 4 | 4 | 16 | código `%16`, constraint runtime 32 | KPI, reconciliação | congelar 32 ou nova revisão; backfill/rebuild testado; nunca mudar módulo in-place |
| R-16 | DLQ não possui taxonomia operacional completa | 4 | 5 | 20 | 58 mensagens `42703`, sem `reason_code`; recovery audit prova requeue, não aplicação final | GO, recovery | esquema explícito de DLQ, vínculo com evento, triagem e replay autorizado idempotente |
| R-17 | Estatísticas cumulativas podem ser atribuídas incorretamente a uma rodada | 4 | 5 | 20 | 218 deadlocks, 565 GB temp bytes e demais métricas desde meses anteriores | homologação | snapshot antes/depois por `capacity_run_id`; persistir deltas e reset temporal do observador, não dos dados |
| R-18 | Staging não representa a produção | 5 | 5 | 25 | branch `capacity-test` está `MIGRATIONS_FAILED`, sem pipeline v3 completo | todos os testes de carga | reparar/provisionar staging equivalente; preflight fail-closed; proibir fallback para produção |
| R-19 | Orçamento de conexões incompleto pode causar starvation | 5 | 4 | 20 | `max_connections=60`, reserva superuser=3, Auth fixo=10; budgets de PostgREST/Realtime/manutenção não fechados | Auth, Realtime, workers | medir cada consumidor, manter headroom, calcular slots e alterar Auth apenas após observação |
| R-20 | Retry de `57014`/`53300` pode repetir trabalho inseguro ou amplificar saturação | 5 | 3 | 15 | whitelist v3 inclui ambos genericamente | integridade, disponibilidade | retry por ponto de commit e operação; reconcile primeiro; circuit breaker e reason code |
| R-21 | Outbox/shards vazios tornam gates vacuamente verdes | 4 | 4 | 16 | estado atual zero, mas estatísticas e archives mostram uso anterior | projeção, GO | fixture isolada, decisão+outbox+projeção+reconcile no mesmo run; nunca aceitar apenas fila vazia |
| R-22 | CORS público e segredo estático ampliam superfície dos workers | 5 | 4 | 20 | `Access-Control-Allow-Origin: *`, `verify_jwt=false`, `x-cron-secret` reutilizável | segurança | identidade de serviço curta, Vault, nonce/replay protection, rate limit, sem CORS público |
| R-23 | Escritas e agregações de KPI permanecem no caminho de decisão | 4 | 5 | 20 | funções/triggers recalculam lote, célula, batch e counters por leitura | SLO | decisão mínima; outbox na mesma transação; projetor set-based e delta idempotente |
| R-24 | O código atual mistura fato nativo e espelho em tabelas de consulta | 5 | 4 | 20 | `production_entries`, `production_events` e estado da peça têm múltiplos escritores | auditabilidade | classificar fonte por fluxo; não apagar fatos; revisão/projection revision com delta compensatório |
| R-25 | Teste de carga existente relaxa requisitos e não cobre o envelope | 5 | 5 | 25 | thresholds 800/2.000 ms, limite 100 dispositivos/60 min, sem ladder/endurance completos | capacidade | suíte aberta de chegada, thresholds contratuais, stop no primeiro gate crítico e run imutável |
| R-26 | Exclusão Promob pode apagar ledger e evidências por cascata no navegador | 5 | 4 | 20 | storage é removido antes do RPC; em erro, o frontend apaga readings, events, peças, lotes, OPs, backups e logs em chamadas independentes | integridade, rollback, auditoria | remover fallback destrutivo do cliente; comando administrativo server-side, idempotente, auditável e com retenção/tombstone |
| R-27 | Reset de produção remove storage antes do RPC e depende de controle visual de rota | 5 | 4 | 20 | rota autenticada, checagem admin na UI e sequência storage→RPC podem deixar estado parcial | integridade, segurança | autorização definitiva no servidor, operação protegida, two-person/change control e preservação obrigatória de fatos/evidências |

## Riscos aceitos apenas temporariamente

Não há risco crítico aceito para produção nesta fase. Em staging isolado, todas
as flags v4 nascem desligadas; somente a flag necessária a um run autorizado
pode ser habilitada por escopo e janela após preflight, começando por shadow sem
efeito produtivo. Fora dessa janela, volta a `false`. A coexistência não autoriza
que o mesmo `client_event_id` produza fatos em dois pipelines.

## Suposições que exigem validação

- Os 471 órfãos podem refletir limpeza/reset histórico, erro de correlação,
  processamento incompleto ou combinação desses fatores. A causa não foi
  determinada.
- A duração registrada nos logs de Auth aparenta estar em nanossegundos, mas a
  unidade não foi confirmada; a amostra não pode aprovar/reprovar o gate.
- Sete conexões em um snapshot não representam pico nem utilização sustentada.
- Tabelas pequenas hoje não eliminam contenção por hot row e não justificam
  particionamento.
- Fila vazia hoje não prova que a capacidade de drenagem satisfaz a chegada.

## Condições para rebaixar riscos críticos

Cada risco só pode ser reclassificado com um artefato reproduzível associado a
commit, migrations, ambiente e `capacity_run_id`. Revisão de código, smoke
isolado, health `ready=true` ou ausência momentânea de backlog não substituem os
gates de integridade e capacidade.

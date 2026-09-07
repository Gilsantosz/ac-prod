# Plano de alteração, validação e rollback — MES Collection Fabric v4

## 1. Objetivo e estado de decisão

Este plano transforma a arquitetura de coleta de forma aditiva, faseada e
reversível, mantendo PostgreSQL/Supabase como sistema de registro e preservando
os componentes válidos existentes. Ele não autoriza implantação, ativação de
flags, teste de carga ou merge.

**Decisão atual: NO-GO para merge, produção, shadow e canário.** O checkpoint
documental permanece na Fase Zero até que os bloqueios F0 definidos abaixo sejam
encerrados. Os demais bloqueios continuam gates específicos de implementação,
staging ou release; não formam uma condição circular para escrever código local.

Base auditada: `origin/main` em
`9174c796df4fa008507e727eb35cce63b3e4a08f`. A PR #63, cujo head auditado é
`95f95df7ff83c3f37d997c62ba64c55d374be23b`, não deve ser mesclada em bloco. As
correções aproveitáveis serão portadas seletivamente para uma branch limpa
criada da `main` atualizada, com revisão e testes próprios.

## 2. Invariantes que nenhuma fase pode violar

1. `production_stage_readings` permanece o ledger produtivo canônico; recibos,
   resultados, tentativas, outbox, filas, archives e DLQ são evidência e não
   podem ser apagados em deploy ou rollback.
2. Toda alteração de semântica será `pipeline_version = 4`. A semântica da v3
   não será alterada silenciosamente.
3. O `pipeline_version` será fixado antes da primeira tentativa de rede e nunca
   trocado após resposta incerta.
4. O mesmo `client_event_id` não poderá produzir efeitos em dois pipelines.
   Rollback não reenvia à v2/v3 um evento recebido ou decidido pela v4.
5. Somente um resultado `APPROVED` confirmado pelo banco autoriza feedback de
   aprovação no posto.
6. Mudanças de banco serão aditivas e backward-compatible até o encerramento da
   expansão. Não haverá `TRUNCATE`, reset, exclusão de histórico, `DROP CASCADE`
   nem reconstrução destrutiva.
7. RLS e grants não serão enfraquecidos. Funções privilegiadas terão wrapper
   mínimo, autorização server-side, `search_path = ''`, objetos qualificados e
   `EXECUTE` mínimo.
8. Segredos de serviço não irão para o frontend. Endpoints internos não usarão
   CORS `*`.
9. Uma fila vazia, um health `ready=true` ou um smoke isolado não constituem GO.
10. Thresholds contratuais não serão relaxados para converter falha em PASS.
11. Nenhuma transação de banco permanecerá aberta durante I/O externo ou espera
    de usuário.
12. Rollback de aplicação será preferencialmente por flag e roll-forward de
    schema; fatos já comprometidos permanecem intactos.

## 3. Bloqueios atuais

| ID | Bloqueio observado em 2026-09-04 | Consequência | Condição de liberação |
| --- | --- | --- | --- |
| B-01 | O ambiente `capacity-test` está em `MIGRATIONS_FAILED` e contém somente cinco migrations antigas. | Não representa produção; nenhum ensaio de capacidade é válido. | Staging novo ou reparado a partir de uma baseline verificável, migrations aplicadas com sucesso e catálogo comparado ao alvo. |
| B-02 | Runtime registra 154 migrations; a `main` contém 167 arquivos, com timestamps divergentes, migrations `SELECT 1` e objetos runtime-only. | Deploy e rollback não são reproduzíveis. | Captura literal de DDL, owners, grants, policies, triggers, overloads e dependências; classificação de cada diferença; baseline aprovada e migrations aditivas testadas do zero. |
| B-03 | Há 471 de 554 recibos sincronizados sem evento ou reading correlacionado; a causa não foi determinada. | `lost_receipts = 0` e reconciliação não estão comprovados. | Classificar cada recibo por `client_event_id`, sem reprocessamento cego; preservar snapshot e produzir reconciliação assinada com diferença zero ou exceção formal individualizada. |
| B-04 | Há 59 resultados v3 aprovados cuja leitura referenciada não existe no snapshot. | `reconciliation_difference = 0` falha; `conflicting_outcomes = 0` não está comprovado por run. | Identificar cadeia de commit/remoção de cada item e definir correção compensatória auditável; jamais fabricar readings retroativos sem autorização de domínio. |
| B-05 | Archive da DLQ de projeção contém 58 mensagens `42703`; a recovery audit registra todas como refileiradas, mas os outboxes e aplicações correlatos não existem hoje. | `untreated_dlq = 0` não está comprovado, apesar da tentativa de recovery. | Preservar mensagens e audit, classificar causa/impacto, provar aplicação/reconciliação em staging ou registrar disposição terminal aprovada. |
| B-06 | Outbox e shards atuais estão vazios, embora archives provem processamento anterior. | Gates de projeção são vacuamente verdes. | Fixture isolada provar decisão, outbox, aplicação idempotente, snapshot e reconciliação na mesma rodada. |
| B-07 | Shard count diverge: código v3 usa 16; constraint/runtime opera com 32. | Projeções podem distribuir ou contar de forma incompatível. | Congelar a revisão v4 com shard count explícito e testar rebuild/migração; não mudar módulo sobre dados existentes. |
| B-08 | Lease v3 é global por `worker_kind`; worker principal é Edge/wakeup e há RPC por item legado. | Não há escala horizontal demonstrada. | Slots com fencing e orçamento de conexões, worker persistente e batch set-based aprovados em staging. |
| B-09 | Há superfície privilegiada ampla: funções `SECURITY DEFINER`, grants a `anon`/`authenticated`, `verify_jwt=false`, CORS público e segredo estático de worker. | Gates de autorização e isolamento setorial não estão comprovados. | Inventário por overload, hardening, rotação de identidade de serviço e testes negativos sem sucesso indevido. |
| B-10 | O catálogo contém `reset_production_data_impl()` com `TRUNCATE ... RESTART IDENTITY CASCADE`; não há prova de que causou os órfãos. | Risco destrutivo e causalidade desconhecida. | Remover sua execução de papéis comuns por mudança aditiva/controle administrativo; preservar auditoria. A função nunca será executada durante a investigação. |
| B-11 | Não existe `capacity_test_run` válido e completo; métricas históricas são cumulativas ou de populações diferentes. | Capacidade, saturação e margens continuam desconhecidas. | Runs imutáveis com baseline/delta, commit, migrations, ambiente, configuração, artefatos e hashes. |
| B-12 | As 222 funções `SECURITY DEFINER` foram enumeradas por overload, mas ainda há apenas triagem heurística e captura literal das funções críticas; a revisão semântica não foi concluída. | A superfície privilegiada não está aprovada para implementação ou merge. | Para cada assinatura, decidir necessidade de definer, validar Auth/role/setor e `search_path`, reduzir grants e executar teste positivo/negativo. |
| B-13 | Delete Promob e reset de produção possuem sequências destrutivas no frontend, inclusive remoção de storage antes do RPC e fallback multichamada. | Fatos/evidências podem ser removidos e a operação pode ficar parcial. | Bloquear o fallback destrutivo; desenhar comando administrativo idempotente, autorizado e auditável; validar retenção/tombstone e recovery. |
| B-14 | Budgets de PostgREST, Realtime, manutenção, pool wait e compute/custo não estão disponíveis. | Não é seguro escolher `worker_slots_max` ou alterar pool de Auth. | Obter métricas/configuração representativas e fechar a equação de conexões com headroom antes do dimensionamento. |

Enquanto qualquer B-01 a B-14 estiver aberto, não há merge, shadow/canário em
produção nem teste de carga produtivo. Flags v3/v4 permanecem desligadas em
produção. Em staging isolado, uma flag pode ser habilitada somente dentro de um
run autorizado, após os gates correspondentes, e deve voltar a `false` ao final.

| Boundary | Bloqueios mínimos que devem estar fechados |
| --- | --- |
| Encerrar Fase Zero e iniciar código de produto | B-01, B-02, B-12 e B-13; artefatos/hash congelados |
| Dimensionar/implementar pool de workers | Gate F0 + B-14 |
| Executar shadow em staging | Gate F0; fixture e emergency-stop; segurança do fluxo; flags somente por run |
| Executar nominal/burst/ladder/endurance | B-08, B-09, B-10, B-11 e B-14, além dos gates anteriores |
| Abrir shadow/canário em produção ou recomendar merge | B-01 a B-14 e todos os gates funcionais, segurança, integridade e performance |

## 4. Flags e fail-closed

Os nomes finais serão versionados em migration, mas o conjunto mínimo planejado
é:

| Flag v4 | Default | Autoriza |
| --- | --- | --- |
| `collection_pipeline_v4_shadow` | `false` | cálculo comparativo sanitizado, sem efeito produtivo |
| `collection_pipeline_v4_ingress` | `false` | seleção da v4 para novas capturas elegíveis |
| `collection_pipeline_v4_sync_decision` | `false` | decisão síncrona pela função canônica |
| `collection_pipeline_v4_fallback_worker` | `false` | novos claims das filas live/replay |
| `collection_pipeline_v4_projection` | `false` | novos claims/aplicações da outbox v4 |
| `collection_pipeline_v4_broadcast` | `false` | Broadcast privado após projeção |

Regras operacionais:

- todas serão criadas como `false`, inclusive em staging;
- flags desconhecidas, leitura indisponível, release não-ready ou
  emergency-stop ativo significam **desligado**;
- habilitação será por ambiente, setor, célula, dispositivo e janela, nunca um
  booleano global irrestrito;
- mudar flag exige ator autorizado, motivo, ticket/change id, horário, versão e
  registro append-only;
- eventos já persistidos mantêm a pipeline gravada mesmo se a flag mudar;
- emergency-stop impede novas capturas v4 e novos claims, mas não apaga nem
  reclassifica mensagens;
- v3 permanece off durante toda a implementação v4, salvo teste isolado
  explicitamente desenhado para comparação em staging;
- nenhuma flag v4 será ligada em produção antes de GO formal e autorização da
  etapa de rollout correspondente.

## 5. Separação por ambiente e momento

| Momento | Permitido | Proibido |
| --- | --- | --- |
| **Agora — Fase Zero** | Leitura de Git/runtime; captura sanitizada de catálogo; hashes; ADR; matriz de fluxos/riscos; branch limpa; desenho de migrations; reparo/provisionamento de staging. | Alterar produção; ligar v3/v4; replay; reconciliar por escrita; deploy de função; teste de carga; merge da PR #63. |
| **Desenvolvimento local/CI** | Implementação backward-compatible; testes SQL/Vitest; lint/typecheck/security; testes com fixtures sintéticas; build do worker/PWA. | Usar dados ou segredos produtivos; assumir equivalência com runtime; declarar capacidade. |
| **Staging reparado** | Aplicar migrations; habilitar flags v4 uma a uma; testes funcionais, concorrência, Playwright e k6; fault injection; replay de fixtures; scale ladder/endurance na janela aprovada. | Copiar PII; reutilizar códigos produtivos; avançar após gate crítico falho; redirecionar teste para produção. |
| **Produção pré-GO** | Deploy de artefatos inertes e migrations aditivas aprovadas, flags v4 off; observação; validação de health e rollback. | Shadow, canário ou carga sem change formal; mudar pool/compute/flags para mascarar falha. |
| **Produção pós-GO por etapa** | Shadow sem escrita canônica; depois canário restrito e expansão 5/25/50/100%, cada qual com gate próprio. | Dupla escrita canônica; avançar automaticamente em integridade incerta; limpar filas/evidência no rollback. |

## 6. Estratégia de mudança

### Fase 0 — congelar, inventariar e tornar reproduzível

Objetivo: produzir uma base verificável sem mutar o runtime produtivo.

1. Atualizar referência da `main` e criar branch limpa; registrar SHA e dirty
   state.
2. Capturar catálogo runtime integral e sanitizado: tabelas, colunas,
   constraints, índices, FKs, triggers, funções/overloads, views, owners, grants,
   RLS/policies, publications, filas, crons, extensões, versões de Edge Functions,
   nomes de secrets, releases e migrations.
3. Para objetos runtime-only, guardar literalmente `pg_get_functiondef`,
   `pg_get_triggerdef`, `pg_get_viewdef` e privilégios. Não recriar de memória.
4. Produzir diff classificado: equivalente, Git-only, runtime-only, divergente
   ou destrutivo.
5. Preservar snapshots dos 471 órfãos, 59 resultados aprovados inconsistentes e 58 itens de
   DLQ; calcular hashes e impedir qualquer rotina de limpeza.
6. Reparar/provisionar staging por procedimento reproduzível. Resolver
   `MIGRATIONS_FAILED`; não apenas marcar a migration como aplicada.
7. Reexecutar o inventário em staging e provar equivalência intencional com a
   baseline esperada.

Gate F0: B-01, B-02, B-12 e B-13 encerrados; evidências dos B-03 a B-05
preservadas; staging recriável; B-14 fechado antes de qualquer pool de worker;
flags v4 inexistentes ou `false`; nenhum dado produtivo alterado.

Rollback F0: descartar somente o staging/fixture isolado conforme seu runbook.
Manter snapshots e hashes. Não “reparar” produção para fazê-la parecer alinhada.

### Fase 1 — fundação aditiva v4 e observabilidade

Objetivo: introduzir estruturas inertes antes do comportamento.

1. Criar `pipeline_version=4`, flags v4 off e release state fail-closed.
2. Adicionar envelope v4, tentativas, resultado, outbox/revisões, DLQ estruturada,
   slots de worker e tabelas de capacidade/auditoria sem remover objetos v2/v3.
3. Incluir correlação (`trace_id`, `client_event_id`, receipt, queue message,
   worker/slot, projection revision, run, commit e migration) sem PII.
4. Adicionar constraints de unicidade/idempotência em estratégia expand/validate:
   detectar duplicatas, criar índice/constraint compatível, validar em staging e
   somente então confiar nela.
5. Não alterar shard count existente in-place. Declarar revisão e módulo v4
   explícitos.
6. Portar apenas hardening válido da PR #63, commit por commit, com revisão de
   conflito com a PR #64 e com a `main` atual.

Gate F1: migrations passam do zero e sobre snapshot representativo; downgrade
de aplicação ainda funciona; catálogo esperado tem checksum; grants/RLS passam
testes negativos; flags continuam off.

Rollback F1: reverter binários/aplicação; manter tabelas, colunas e constraints
aditivas não utilizadas. Desabilitar grants novos quando necessário. Remoção
física fica para migration futura, fora do incidente e somente após retenção.

### Fase 2 — função canônica e caminho rápido

Objetivo: ter uma única decisão por recibo sem trabalho derivado no hot path.

1. Implementar `private.decide_collection_event_v4(receipt_id, mode)` como
   única regra de decisão, chamada pelo RPC síncrono, fallback, replay e
   reconciliação autorizada.
2. Criar wrapper público mínimo que resolve `auth.uid()`, sessão, dispositivo,
   célula/setor e contexto no servidor; limitar tamanhos e sanitizar erros.
3. Inserir recibo idempotente e, para duplicata, retornar o resultado existente.
4. Resolver rota antes de escrever; ordenar IDs; adquirir somente locks mínimos
   na mesma ordem em todos os caminhos.
5. Na mesma transação, inserir ledger, resultado e outbox. Não calcular KPIs,
   fazer Broadcast ou chamar rede.
6. Usar, inicialmente em staging, `sync_decision_budget_ms=150` e
   `piece_lock_timeout_ms=50`. Antes de cada fase limitada, conferir o tempo;
   ao esgotar o orçamento, lançar a exceção tipada v4 `P4B01` dentro de um bloco
   PL/pgSQL com handler. A subtransação implícita desfaz os efeitos do bloco, e
   o escopo externo enfileira. A meta de commit server-side do receipt é até
   180 ms, reservando margem para o SLO de DB ACK de 250 ms. Isso é configuração
   candidata, não capacidade homologada; uma query individual que ultrapasse o
   orçamento reprova o gate em vez de ser ocultada.
7. Somente erro entregue e capturado pelo handler dessa subtransação implícita,
   antes do commit externo e com classe explicitamente homologada, pode
   preservar receipt e enfileirar na mesma transação. Classe `08`, `40001` no
   commit, perda da resposta ou qualquer commit incerto seguem reconciliação do
   mesmo `client_event_id`; se ausente, o cliente repete o mesmo comando e nunca
   cria outro ID. Erro terminal persiste resultado terminal; erro desconhecido
   nunca vira aprovação ou retry infinito. A função não emite comandos
   `SAVEPOINT`/`ROLLBACK TO`/`RELEASE SAVEPOINT`, que PL/pgSQL não suporta.
8. Provar barreiras de `client_event_id`, `device_id/device_sequence` e
   peça/etapa normalizada/ciclo em todos os adapters produtivos.

Gate F2: testes 1–13 e 19/24/25/27–30 da matriz funcional passam em staging;
100 reenvios produzem um resultado; colisões em 2 e 100 dispositivos produzem
uma aprovação; ledger/outbox fecham exatamente.

Rollback F2: desligar `collection_pipeline_v4_ingress` e
`collection_pipeline_v4_sync_decision`; nenhuma nova captura escolhe v4.
Preservar receipts pendentes e resultados comprometidos. Reconciliar pelo mesmo
`client_event_id`; não encaminhar à v2/v3.

### Fase 3 — filas e pool horizontal persistente

Objetivo: concluir fallback/replay sem lease global nem dependência do cron para
latência normal.

1. Separar PGMQ live, replay, projection e DLQ; usar `read` com visibility
   timeout, `set_vt` e archive após commit. Nunca usar `pop` em mensagem crítica.
2. Criar slots por `(worker_kind, slot_id)`, lease com expiração, heartbeat e
   fencing token/generation. Worker que perde slot ou vê emergency-stop para de
   escrever imediatamente.
3. Processar batch set-based; nenhuma transação atravessa chamada externa.
4. Aplicar prioridade live:replay inicial 4:1 como configuração, não garantia;
   medir starvation, queue age e tempo de drenagem.
5. Calcular slots a partir de chegada, service time, utilização alvo e orçamento
   real de conexões. Não abrir conexão por posto.
6. Manter Edge/`pg_net` como wakeup/control plane e Cron como sweeper. O worker
   persistente executa próximo à região do banco.

Gate F3: morte após claim, expiração de VT, perda de slot, emergency-stop,
reentrega e backlog offline passam sem perda/duplicação; live não fica atrás do
replay; Auth e Realtime não sofrem starvation; fila volta ao baseline no prazo.

Rollback F3: desligar novos claims, revogar leases/avançar fencing generation e
esperar transações em curso terminarem dentro do timeout. Mensagens permanecem
na fila ou voltam após VT. Não archive, delete ou mova em massa durante o
incidente.

### Fase 4 — projetor, snapshots e Broadcast

Objetivo: retirar KPIs/dashboards do caminho crítico e tornar projeção
idempotente/reconstruível.

1. Aplicar outbox em batches e deltas agrupados por dimensões, shard e métrica.
2. Proteger aplicação por
   `(client_event_id, projection_revision, projection_kind)`.
3. Separar projeções de lote e turno; preservar contextos encerrados; correções
   usam delta compensatório, nunca sobrescrita histórica.
4. Criar snapshot leve com revisão, contexto, KPIs, queue health, último evento e
   lag de projeção.
5. Emitir Broadcast privado somente depois da projeção, com payload mínimo. A
   UI coalesce eventos e refaz snapshot; revision/gap detection recupera perdas.
6. Manter materialized views históricas fora do hot path.

Gate F4: morte do projetor após commit, Broadcast perdido e gap de revision
passam; reaplicação não duplica contador; rebuild em fixture reproduz snapshot;
isolamento setorial é comprovado.

Rollback F4: desligar Broadcast e novos claims de projeção conforme a causa.
Preservar outbox, `projection_applied`, shards, snapshots, archives e DLQ. Corrigir
e retomar pela mesma revisão; não recalcular apagando histórico.

### Fase 5 — PWA, Auth e Realtime

Objetivo: captura local anterior à rede e sessão resiliente a falhas
transitórias.

1. Migrar IndexedDB de modo backward-compatible; gravar o envelope v4 e estado
   inicial em uma única transação antes da primeira rede.
2. Implementar retries com exponencial/full jitter, classificação e limite;
   reconciliar resposta incerta com o mesmo ID e dar prioridade a evento online.
3. Adotar máquina de Auth com estados explícitos, profile single-flight/cache e
   session epoch/generation. Falha de perfil, heartbeat ou socket não faz logout.
4. Impedir operação antiga de restaurar sessão após logout explícito; testar
   múltiplas abas e refresh simultâneo.
5. Usar Supabase client singleton e registry de canais com reference counting,
   token renovado, resubscribe e polling apenas quando desconectado/stale.
6. Adiar PWA update/reload durante captura ou replay ativo e tornar
   backpressure/fila local visíveis ao operador.

Gate F5: testes de rede móvel, suspensão, reload, refresh/JWT, logout durante
retry, duas sessões e 100 dispositivos passam; `involuntary_logout = 0`; nenhum
token/PII aparece em IndexedDB, Broadcast ou telemetria.

Rollback F5: desativar seleção v4 para novas capturas e servir bundle anterior.
O bundle anterior deve ignorar campos v4 desconhecidos sem apagar registros. Um
processo compatível de recuperação continua reconciliando eventos v4 já
persistidos; nunca reescreve sua versão.

### Fase 6 — homologação de capacidade em staging

Objetivo: encontrar capacidade real e ponto de saturação, não confirmar uma
conclusão prévia.

Executar, em ordem e com chegada aberta: smoke, idempotência, colisão 20/100/500,
hot cell, rota completa, nominal 30 eventos/s, burst 100 eventos/s, ladder de
100/250/500/1.000 dispositivos, Auth storm, mobile network, offline replay e
endurance. Encerrar no primeiro gate crítico e abrir novo `capacity_run_id`
depois da correção.

Gate F6: todos os gates da seção 9 passam, incluindo reconciliação; ponto de
saturação, throughput sustentável, margem, compute e custo estão registrados.

Rollback F6: emergency-stop, parar injetores e claims do run, preservar fixture,
filas e métricas, reconciliar e fazer cleanup somente dos dados sintéticos
identificados pelo runbook. Nunca migrar a carga para produção.

### Fase 7 — rollout progressivo em produção

Objetivo: reduzir blast radius e manter retorno imediato.

1. **Deploy inerte:** migrations aditivas e artefatos aprovados; flags v4 off;
   observar uma janela normal.
2. **Shadow:** cópia sanitizada calcula decisão v4 sem ledger/outbox canônicos;
   comparar com a decisão vigente e registrar divergência.
3. **Canário:** uma máquina, uma célula, operadores autorizados, janela curta e
   suporte presente.
4. **Expansão:** 5%, 25%, 50% e 100% das máquinas elegíveis. Cada estágio ganha
   novo registro e gate; não avançar por tempo apenas.
5. Somente após estabilidade e retenção aprovada iniciar depreciação de caminhos
   antigos. Remoções são outro change, nunca parte do rollout inicial.

Gate F7: zero divergência crítica no shadow; cada etapa cumpre integridade,
performance, Auth, Realtime, conexão e operação; rollback foi exercitado antes
do canário.

## 7. Preflight obrigatório

### 7.1 Antes de qualquer migration/deploy

- change id, responsável, aprovadores, janela e canal de incidente registrados;
- commit, árvore limpa, artefatos e SHA-256 fixados;
- migrations esperadas e checksums comparados com runtime;
- backup/PITR e procedimento de restauração verificados, sem executar restore em
  produção;
- DDL bloqueante analisado; `lock_timeout`/`statement_timeout` locais;
- espaço em disco, WAL, bloat, autovacuum, locks e conexões dentro do orçamento;
- compatibilidade N/N-1 entre frontend, RPC, worker e schema comprovada;
- flags v4 e emergency-stop lidos como off/operacionais;
- owner, RLS, policies e grants esperados revisados;
- migrations aplicadas e revertibilidade lógica exercitada em staging;
- nenhum comando destrutivo incluído no plano.

### 7.2 Antes de cada teste de capacidade

- ambiente identificado como não produtivo e endpoint verificado em duas
  fontes; fail-closed se houver dúvida;
- staging saudável, sem `MIGRATIONS_FAILED`, e catálogo no checksum aprovado;
- fixture sintética exclusiva, setor/site segregado, códigos e `capacity_run_id`
  únicos;
- flags, worker version, Edge versions, compute, pool e conexão registrados;
- snapshot antes de `pg_stat_activity`, `pg_stat_database`,
  `pg_stat_statements`, locks, filas, outbox, DLQ, Auth e Realtime;
- contadores cumulativos registrados antes; o resultado usará apenas deltas;
- orçamento de conexões fechado e emergency-stop testado;
- limites de duração, stop conditions e responsável de plantão definidos;
- cleanup idempotente restrito à fixture e ensaiado, sem `TRUNCATE`.

### 7.3 Antes de cada etapa de produção

- manifesto GO assinado para o estágio específico; etapa anterior encerrada;
- reconciliação zero e ausência de DLQ sem tratamento;
- dashboards e alertas ativos; runbook e comandos fail-safe revisados;
- seleção exata de setor/célula/máquina/dispositivo confirmada;
- nenhuma manutenção concorrente, importação pesada ou mudança de pool/compute;
- rollback drill recente e operador com autoridade para acionar emergency-stop;
- comunicação de início/fim e critério de abortar registrada.

## 8. Sequenciamento de migrations

1. **Expand:** criar novos objetos v4, colunas nullable/default seguro, índices e
   wrappers sem alterar chamadas atuais.
2. **Backfill controlado:** se necessário, trabalhar em lotes com checkpoint,
   rate limit e identificador de run; não derivar fatos ausentes por suposição.
3. **Dual-read/shadow, não dual-write canônico:** comparar resultados sem criar
   duas aprovações.
4. **Validate:** validar constraints, planos, RLS/grants, checksums e
   reconciliação em staging.
5. **Switch:** selecionar v4 apenas por flag e escopo autorizado.
6. **Contract tardio:** retirar superfícies antigas somente em change separado,
   após 100%, retenção e prova de que nenhum receipt/fila/outbox depende delas.

`CREATE INDEX CONCURRENTLY` não pode executar dentro de transaction block. Cada
uso exige confirmação do comportamento da versão fixada do migration runner,
plano para índice `INVALID`, monitoramento de espaço/WAL e comando de retomada.
Não adicionar ou remover índice sem consulta identificada, EXPLAIN em staging,
custo de escrita e rollback documentados.

## 9. Gates GO/NO-GO

### 9.1 Integridade e segurança — todos obrigatórios

| Gate | Exigência |
| --- | ---: |
| `lost_receipts` | 0 |
| `double_approvals` | 0 |
| `conflicting_outcomes` | 0 |
| `duplicate_projections` | 0 |
| `deadlocks_delta` | 0 |
| `statement_timeouts_delta` | 0 |
| `unauthorized_success` | 0 |
| `cross_sector_leak` | 0 |
| `orphan_outbox` | 0 |
| `untreated_dlq` | 0 |
| `reconciliation_difference` | 0 |

### 9.2 Performance e disponibilidade

| Métrica | p95 | p99/limite adicional |
| --- | ---: | ---: |
| ACK local | <= 50 ms | <= 100 ms |
| ACK banco | <= 250 ms | <= 500 ms |
| decisão | <= 500 ms | <= 1.000 ms |
| projeção | <= 500 ms | <= 1.000 ms |
| dashboard | <= 1.000 ms | <= 2.000 ms |
| lock wait | <= 50 ms | <= 200 ms |
| login | <= 1.500 ms | <= 3.000 ms |
| conexões | sustentado < 70% | pico < 85% |

Também são obrigatórios: `involuntary_logout = 0`, pool wait p95 < 50 ms,
nenhuma conexão `idle in transaction`, oldest queue age dentro do SLO e retorno
da fila ao baseline em até 60 segundos após burst.

Qualquer gate crítico falho produz NO-GO imediato, interrompe a próxima etapa,
mantém flags desligadas, preserva evidência, registra causa e exige novo run id.
Não se calcula média entre runs para esconder falha.

## 10. Runbook de rollback

### 10.1 Critérios de acionamento

Acionar rollback/emergency-stop diante de qualquer um destes eventos:

- indício de perda, dupla aprovação ou resultado conflitante;
- sucesso não autorizado ou vazamento cross-sector;
- ledger sem outbox, projeção duplicada ou divergência de reconciliação;
- deadlock/timeout do run acima de zero;
- SLO crítico excedido pela janela definida;
- saturação de conexão >= 85%, starvation de Auth/Realtime ou `idle in
  transaction` persistente;
- queue age crescente sem recuperação, DLQ nova sem tratamento ou worker sem
  fencing;
- comportamento de migration diferente do ensaiado;
- telemetria insuficiente para determinar segurança.

### 10.2 Ordem operacional

1. Declarar incidente, registrar horário, escopo, commit, releases, flags,
   métricas e último `client_event_id` conhecido. Não reiniciar contadores.
2. Acionar emergency-stop fail-closed para impedir **novas capturas v4** e
   **novos claims**. Confirmar leitura do stop por todas as instâncias.
3. Avançar fencing generation/revogar slots e aguardar somente transações já em
   commit terminarem. Worker que perdeu slot não pode voltar a escrever.
4. Manter receipts já confirmados e decisões comprometidas. Marcar como pendente
   aquilo cujo resultado é desconhecido; consultar pelo mesmo `client_event_id`.
5. Pausar Broadcast se ele estiver propagando estado incorreto. Clientes voltam
   a snapshots/polling degradado, sem logout.
6. Pausar projetores se a projeção for a causa. Não apagar outbox nem
   `projection_applied`; preservar ordem/revision para retomada.
7. Reverter frontend/worker/Edge para o artefato compatível N-1 ou desligar a
   funcionalidade por flag. Schema aditivo permanece.
8. Não restaurar triggers legados até todos os workers v4 estarem parados e a
   matriz de dupla escrita ter sido verificada.
9. Capturar after-snapshot de filas, archives, DLQ, receipts, ledger, outbox,
   projeções, locks, conexões, Auth e Realtime. Calcular deltas.
10. Reconciliar cada evento do intervalo. Evento v4 decidido permanece v4;
    evento incerto é consultado/reprocessado somente pela função canônica v4 e
    com autorização explícita.
11. Isolar correção em nova branch/release e novo run id. Retomar primeiro em
    staging e repetir o estágio de rollout; nunca continuar do percentual
    anterior automaticamente.

### 10.3 O que rollback não faz

- não executa `TRUNCATE`, `DROP CASCADE`, reset produtivo ou delete em massa;
- não exclui receipt, ledger, resultado, tentativa, outbox, archive ou DLQ;
- não desfaz uma aprovação válida com update destrutivo; correção de domínio usa
  evento/delta compensatório autorizado;
- não arquiva mensagem apenas para esvaziar fila;
- não altera `pipeline_version` nem gera novo `client_event_id` para resposta
  incerta;
- não reativa trigger legado enquanto o novo writer ainda pode escrever;
- não muda threshold, pool ou compute durante a análise para maquiar o incidente;
- não declara conclusão até `reconciliation_difference = 0` e tratamento da DLQ.

### 10.4 Retomada após rollback

A retomada exige causa raiz registrada, correção revisada, testes de regressão e
falha, replay em fixture, capacidade do estágio novamente aprovada e novo
manifesto GO. Mensagens preservadas serão drenadas na ordem/prioridade definida,
com observação de live versus replay. Se a origem for WAN industrial e o sistema
cumprir SLO na mesma região, avaliar gateway local em ADR separada; não introduzi-lo
como reação automática ao incidente.

## 11. Evidência e responsabilidade

Cada mudança e ensaio deve produzir registro imutável ou anexos append-only com:

- ambiente, início/fim, responsável e aprovadores;
- commit, migrations/checksums, versões de Edge/worker/frontend;
- compute, pools, slots, flags e configuração de chegada;
- baseline e after-snapshot, sempre com deltas;
- percentis, throughput, ponto de saturação e margem;
- reconciliação exata de receipts, resultados, ledger, outbox e projeções;
- depth/age/retries/archive/DLQ e disposição de cada erro;
- artefatos k6/SQL/Vitest/Playwright, logs sanitizados e SHA-256;
- motivo de parada, decisão GO/NO-GO e riscos residuais.

O responsável pelo ensaio não pode encerrar um run falho como PASS. Alterações
posteriores não sobrescrevem métricas finalizadas; entram como anexos auditáveis
ou novo run. E-mail, matrícula completa, JWT, refresh token, IP e secrets não
entram nos relatórios.

## 12. Critério de conclusão deste plano

Este plano estará executado — e não apenas escrito — somente quando:

1. drift e staging estiverem resolvidos de forma reproduzível;
2. órfãos e DLQ tiverem disposição auditável sem apagar evidência;
3. v4 passar todos os testes funcionais, concorrentes e de capacidade em
   staging;
4. cada etapa de produção passar seus próprios gates;
5. before/after, capacidade homologada, margem, custo e riscos residuais forem
   publicados;
6. houver recomendação explícita de merge e GO por autoridade definida.

Até isso ocorrer, o estado correto é: **flags v3/v4 desligadas, PR #63 sem merge
integral, sem teste de carga em produção e NO-GO**.

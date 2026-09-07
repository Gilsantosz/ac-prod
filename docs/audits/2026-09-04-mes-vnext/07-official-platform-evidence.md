# Evidências oficiais de plataforma — Supabase e PostgreSQL 17

## Metadados

- **Data da consulta:** 2026-09-04
- **Escopo:** decisões técnicas da Fase Zero da rearquiteturação MES vNext
- **Fontes admitidas:** documentação, changelog e repositórios oficiais do Supabase; documentação oficial do PostgreSQL 17
- **Natureza desta evidência:** documental e temporal. Este arquivo não comprova a configuração, a versão instalada, a capacidade nem o comportamento observado no projeto `uozuzdfvnufsjsonswag`.

## Como interpretar esta matriz

Cada seção separa:

- **Documentado:** comportamento afirmado diretamente pela fonte oficial.
- **Decisão sustentada:** uso arquitetural compatível com esse comportamento.
- **Limite de inferência:** aquilo que a fonte não garante e que precisa ser confirmado no runtime, em staging ou por teste reproduzível.

Nenhuma referência abaixo substitui o inventário do catálogo, a medição de conexões, os testes de falha ou os gates GO/NO-GO do AC-Prod2.

## 1. PGMQ e Supabase Queues

### 1.1 Leitura, visibility timeout, renovação e archive

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase — PGMQ Extension](https://supabase.com/docs/guides/queues/pgmq) | `read(queue_name, sleep_seconds, n)` lê mensagens e as torna invisíveis pelo período de visibilidade; após esse período elas podem voltar a ser lidas. `read_ct` registra quantas vezes uma mensagem foi lida. `set_vt` altera a visibilidade de uma mensagem. `archive` retira a mensagem da fila ativa e a conserva no archive. | Consumidores críticos devem usar `read`, executar efeito idempotente, confirmar a transação e somente então arquivar. Operações longas podem renovar a visibilidade com `set_vt`. `read_ct` pode contribuir para uma política explícita de tentativas. | Visibility timeout não prova exatamente uma aplicação do efeito de negócio. Um worker pode morrer após o commit e antes do archive, causando nova entrega; unicidade e idempotência continuam obrigatórias. A documentação não define a duração correta do VT para este workload. |
| [Supabase — Queues API](https://supabase.com/docs/guides/queues/api) | A API expõe operações de envio, leitura, `pop`, archive e alteração de VT. `pop` lê e remove imediatamente a mensagem. | Não usar `pop` para recibos ou decisões críticas, pois não há oportunidade posterior de archive após o commit do efeito. | A conclusão sobre a janela de perda após `pop` é inferência de engenharia decorrente da semântica documentada, não uma garantia textual de perda nem uma proibição da plataforma. |
| [Supabase — Queues](https://supabase.com/docs/guides/queues) | Supabase Queues/PGMQ mantém filas duráveis no PostgreSQL e usa visibility timeout para entrega. | PGMQ pode permanecer como mecanismo de fallback, replay, projeção e recuperação enquanto cumprir o envelope medido. | A expressão de entrega “exactly once” dentro da janela de visibilidade não equivale a exatamente um efeito produtivo por toda a vida do evento. PGMQ, isoladamente, não prova zero dupla aprovação. |

### 1.2 DLQ e tentativas

Nas APIs oficiais consultadas não há uma primitiva automática e completa que, sozinha, implemente DLQ de domínio com `reason_code`, `first_seen_at`, `last_seen_at`, `last_sqlstate`, limite de tentativas e vínculo a `client_event_id`.

Logo, são decisões da aplicação — e não garantias nativas documentadas — criar filas live, replay, projection e dead-letter separadas; classificar erros; limitar tentativas; e mover uma mensagem para DLQ de modo transacional e auditável. A atomicidade da operação concreta precisa ser provada contra as funções e assinaturas instaladas.

### 1.3 Versão efetiva da extensão

O changelog [Extension version pinning ignored](https://supabase.com/changelog/extension-version-pinning-ignored) informa que, desde 2026-08-05, pedidos de versão explícita de extensões são ignorados e a versão padrão suportada é instalada.

Consequência para a Fase Zero: registrar `pg_extension.extversion`, assinaturas efetivas e checksums no projeto real. Uma migration que declara uma versão não é prova de que essa é a versão presente no runtime.

## 2. Supabase Realtime Broadcast privado

### 2.1 Autorização de canais

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase — Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) | A autorização de Broadcast/Presence usa policies RLS sobre `realtime.messages`. `SELECT` governa recebimento e `INSERT` governa envio. O tópico pode ser lido com `realtime.topic()`. Para aplicar essa autorização, o canal deve ser configurado como privado. | Usar tópicos privados com escopo de setor/célula/dispositivo e policies mínimas para o papel autenticado. Testar envio e recepção, pois são permissões distintas. | O recurso não cria automaticamente isolamento correto por setor. A policy, os claims e as associações do AC-Prod2 precisam ser auditados e testados negativa e positivamente. |
| [Supabase — Realtime Settings: database connection pool size](https://supabase.com/docs/guides/realtime/settings#database-connection-pool-size) | O pool de banco do Realtime é usado em autorizações de canais privados, atualização de `access_token` e Broadcast privado via REST. Pool pequeno pode formar fila, gerar timeouts e descartar mensagens; pool excessivo disputa `max_connections` e pode impedir o serviço de iniciar. | Incluir Realtime no orçamento global de conexões e medir joins, refresh e Broadcast sob carga simultânea. | A fonte não fornece um tamanho universal para o pool nem prova que uma configuração específica do projeto é segura. |

Desde 2026-07-14, segundo o changelog [Realtime schema locked down against modification](https://supabase.com/changelog/realtime-schema-locked-down-against-modification), objetos do schema `realtime` não podem ser criados, alterados ou removidos pelo usuário; policies RLS em `realtime.messages` continuam permitidas. Migrations vNext devem limitar-se às operações suportadas.

### 2.2 JWT, reconexão e entrega

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase JavaScript — `setAuth`](https://supabase.com/docs/reference/javascript/setauth) | `setAuth` define o JWT usado para autorização de canais e policies RLS. Com callback de token, o cliente obtém o token atualizado nos heartbeats. | Propagar a sessão renovada ao Realtime por um cliente singleton e testar expiração/reconexão. | `setAuth` não substitui a máquina de estados de Auth, single-flight, epoch de sessão ou prevenção de restauração após logout; essas são responsabilidades da aplicação. |
| [Supabase Realtime Protocol — access token refresh](https://supabase.com/docs/guides/realtime/protocol#access-token-refresh) | O protocolo permite enviar um novo token ao canal sem fazer novo join. | Renovar credenciais sem tratar refresh como logout ou queda definitiva do socket. | A fonte não garante que código cliente customizado faça isso corretamente; é necessário teste com expiração real e múltiplas abas. |
| [Supabase Realtime Protocol — reconnection](https://supabase.com/docs/guides/realtime/protocol#reconnection) | Após erro inesperado do canal, clientes devem realizar rejoin; a biblioteca JavaScript usa backoff progressivo documentado de 1, 2, 5 e 10 segundos. | Adotar reconexão controlada, resubscribe e snapshot posterior. | Rejoin não prova continuidade; replay é um recurso separado, limitado, e não fornece detecção automática de lacunas de revisão. |
| [Supabase — Broadcast Replay](https://supabase.com/docs/guides/realtime/broadcast#broadcast-replay) | Canais privados podem solicitar mensagens anteriores com `since` e `limit`; somente Broadcasts originados no banco são elegíveis e o limite máximo é 25. A documentação da mesma página informa retenção de três dias para Broadcasts do banco e requisitos mínimos de versão por SDK. | O cliente pode usar replay limitado como otimização de reconexão, preservando `revision`/`client_event_id`. | Não cobre mensagens enviadas por client/REST, janelas arbitrárias, mais de 25 itens por join nem constitui ledger durável. Snapshot e gap detection continuam obrigatórios. |
| [Supabase Realtime Protocol — Broadcast errors](https://supabase.com/docs/guides/realtime/protocol#broadcast-errors) | O `ack` de Broadcast é opcional e, por padrão, desabilitado. Falhas de push em Broadcast privado podem não ser entregues ao cliente quando não há ack. | Tratar Broadcast como aviso compacto de invalidação; após evento ou reconexão, usar replay limitado quando elegível e consultar snapshot por `revision`. | “Broadcast como hint, não como ledger” deriva dos limites de ack/replay; a fonte não implementa a reconciliação do AC-Prod2. |

Portanto, Realtime não deve ser fonte de verdade do resultado produtivo. Ledger, recibo, outbox e revisão de snapshot permanecem no PostgreSQL.

## 3. Auth e orçamento de conexões

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase self-hosting configuration — Database](https://github.com/supabase/supabase/blob/master/docker/CONFIG.md#database) | A configuração oficial do Auth inclui tamanho de pool e percentual de conexões (`GOTRUE_DB_CONN_PERCENTAGE`). | A estratégia percentual é uma capacidade suportada pelo componente Auth e pode evitar uma reserva fixa incompatível com mudanças de compute. | O documento de self-hosting não prova qual configuração está ativa no projeto hospedado nem qual percentual atende ao AC-Prod2. |
| [Supabase Auth — configuração no código oficial](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go) | O código oficial define os campos de pool de banco, inclusive percentual limitado ao intervalo de 0 a 100. | Validar que a unidade configurada corresponde ao valor pretendido antes de mudar a reserva fixa. | Existência do campo no código não autoriza alterar produção nem fornece recomendação de valor. A release hospedada precisa ser inventariada. |
| [Supabase Management API — Get Auth service config](https://supabase.com/docs/reference/api/v1-get-auth-service-config) e [Update Auth service config](https://supabase.com/docs/reference/api/v1-update-auth-service-config) | A API de configuração expõe `db_max_pool_size` e `db_max_pool_size_unit`. | Inventariar, sem revelar segredos, valor e unidade efetivos; qualquer ajuste deve ser progressivo e reversível. | A documentação da API não prova que a conta atual tem permissão, nem que a mudança é sem indisponibilidade, nem define o valor adequado. |
| [Supabase — Database connection management](https://supabase.com/docs/guides/database/connection-management), [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) e [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) | O compute determina o limite de conexões; serviços Supabase e clientes disputam esse orçamento. `pg_stat_activity` e relatórios de conexão ajudam a identificar consumo por serviço/aplicação. | Calcular orçamento com estado real, headroom e picos de Auth, PostgREST, Realtime, manutenção e workers antes de dimensionar slots. | Recomendações de 40%/80% presentes na documentação de pool dizem respeito a cenários do Supavisor; não constituem uma recomendação de percentual do Auth. Não há “percentual correto” universal documentado. |

Conclusão: substituir a reserva fixa de 10 por percentual pode ser tecnicamente válido, mas somente após medir `max_connections`, consumo simultâneo, picos de login/refresh e fila de pool. A documentação não sustenta uma mudança cega.

## 4. Edge Functions versus worker persistente

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase — Edge Functions](https://supabase.com/docs/guides/functions) | Edge Functions são funções server-side distribuídas, adequadas a handlers curtos; a documentação recomenda operações idempotentes e mover trabalho pesado ou longo para workers em background. | Manter Edge Functions como control plane, health, administração, wakeup não crítico e sweeper, em vez de criar uma invocação por evento como consumidor principal. | A fonte não proíbe consumidores de fila em Edge Functions nem escolhe o provedor do worker persistente. A decisão depende do workload e dos testes. |
| [Supabase — Edge Function limits](https://supabase.com/docs/guides/functions/limits) | No ambiente hospedado, a documentação lista 256 MB de memória, wall-clock de 150 s no plano Free e 400 s nos planos pagos, 2 s de CPU por request e idle timeout de 150 s. | Não desenhar o consumidor principal como daemon ilimitado dentro de uma Edge Function; usar batches limitados e retomáveis para ações administrativas. | Limites podem mudar e devem ser reconfirmados antes do rollout. Eles não demonstram, por si, throughput insuficiente. |
| [Supabase — Background Tasks](https://supabase.com/docs/guides/functions/background-tasks) | `EdgeRuntime.waitUntil(...)` permite continuar uma tarefa após a resposta, mas ela continua sujeita aos limites de execução da plataforma. | `waitUntil` não transforma a Edge Function em runtime persistente para manter slots e heartbeats indefinidamente. | “Worker persistente separado” é inferência arquitetural baseada nos limites; a documentação não concede SLA de daemon a uma opção externa. |
| [Supabase — Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) | Conexão direta é indicada para servidores persistentes, como VMs e contêineres de longa duração; transaction pooler é indicado para clientes temporários/serverless. | Um pool de workers de longa duração pode usar a modalidade de conexão adequada, com conexões limitadas e próximas ao banco. | A fonte não determina número de slots, `connections_per_worker`, linguagem, runtime ou topologia. Isso deve resultar de medições. |
| [Supabase — Regional invocation](https://supabase.com/docs/guides/functions/regional-invocation) | Funções podem ser invocadas em região específica; para operações intensivas de banco, executar próximo da região do banco tende a reduzir latência. | Colocar workers DB-heavy próximos à região do PostgreSQL e separar latência de aplicação de latência WAN. | Proximidade regional não garante os SLOs dos postos; medir a WAN industrial continua obrigatório. |

## 5. `pg_net` e Supabase Cron

### 5.1 `pg_net`

Segundo [Supabase — `pg_net`: Async Networking](https://supabase.com/docs/guides/database/extensions/pg_net):

- requisições HTTP são assíncronas e começam após o commit da transação;
- a extensão é beta;
- as tabelas de request/response são unlogged e podem perder conteúdo após crash;
- respostas possuem retenção limitada, com padrão documentado de seis horas;
- o uso indicado é da ordem de aproximadamente 200 requisições por segundo.

Isso sustenta `pg_net` como sinal pós-commit ou wakeup auxiliar. Não sustenta utilizá-lo como recibo durável, ledger, fila crítica ou prova de entrega. Classificá-lo como mecanismo não crítico, com PGMQ/ledger preservando a verdade e Cron atuando como sweeper, é uma decisão arquitetural — não uma garantia automática do `pg_net`.

### 5.2 Cron

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase Cron](https://supabase.com/docs/guides/cron) | Jobs podem ser agendados de uma vez por segundo até uma vez por ano. A documentação recomenda no máximo oito jobs concorrentes e duração de até dez minutos por job. | Usar Cron como reconciliação/sweeper de baixa frequência, sempre com trabalho idempotente e limitado. | Um cron de 15 segundos é configuração do sistema auditado, não piso da plataforma. Cron não garante p95/p99 subsegundo nem substitui wakeup/worker persistente. |
| [Supabase — Schedule Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) | `pg_cron` pode acionar Edge Functions, frequentemente por `pg_net`, com segredos guardados no Vault. | Preservar essa composição para tarefas administrativas ou recuperação, sem colocá-la no caminho normal de decisão. | Agendamento + HTTP não cria entrega exatamente uma vez e continua sujeito aos limites da Edge Function e do `pg_net`. |

O changelog [Directly updating rows in the `cron.job` table is no longer allowed](https://supabase.com/changelog/19298-directly-updating-rows-in-the-cron-job-table-is-no-longer-allowed) orienta gerenciar jobs por `cron.schedule`, `cron.alter_job` e `cron.unschedule`, em vez de DML direto em `cron.job`.

## 6. PostgreSQL 17: `lock_timeout` e `statement_timeout`

A documentação [PostgreSQL 17 — Statement Behavior](https://www.postgresql.org/docs/17/runtime-config-client.html#RUNTIME-CONFIG-CLIENT-STATEMENT) estabelece:

- `statement_timeout` limita o tempo total de execução de cada comando, medido desde sua chegada ao servidor;
- `lock_timeout` aplica-se somente ao tempo de espera para adquirir cada lock;
- configurar `lock_timeout` com valor igual ou superior a `statement_timeout` é inútil, pois o timeout do statement ocorrerá primeiro;
- não é recomendado definir esses valores globalmente em `postgresql.conf`, pois isso afeta todas as sessões.

Decisão sustentada: aplicar timeouts curtos e locais à transação/sessão do caminho de coleta, com `lock_timeout` menor que `statement_timeout`, registrar SQLSTATE e latência de lock, e tratar somente estados comprovadamente seguros para retry idempotente.

Limites:

- a documentação não define os valores adequados de 50, 200, 500 ou 1.000 ms para o AC-Prod2;
- ela não classifica todo `57014` como retry seguro;
- elevar `statement_timeout` não resolve contenção e não deve converter um gate falho em PASS;
- valores finais exigem teste de colisão, EXPLAIN, métricas antes/depois e reconciliação.

### 6.1 Subtransações em PL/pgSQL

A documentação [PostgreSQL 17 — Transaction Management](https://www.postgresql.org/docs/17/plpgsql-transactions.html)
afirma que PL/pgSQL não suporta os comandos `SAVEPOINT`, `ROLLBACK TO
SAVEPOINT` e `RELEASE SAVEPOINT`. O padrão equivalente é um bloco com handler
de exceção; internamente, esse bloco forma uma subtransação.

Decisão sustentada: o fast path insere o receipt no escopo externo e chama a
decisão dentro de `BEGIN ... EXCEPTION ... END`. Apenas SQLSTATEs allowlisted e
uma exceção tipada de orçamento podem cair no handler; os efeitos do bloco são
desfeitos antes de registrar a tentativa e enfileirar no escopo externo. Não
prescrever comandos de savepoint dentro da função.

Limite de inferência: uma falha de conexão, cancelamento externo ou erro no
commit pode atingir a transação inteira e não prova que receipt ou enqueue foi
preservado. Esses casos exigem reconciliação pelo mesmo `client_event_id`.

## 7. Funções `SECURITY DEFINER`

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [Supabase — Database Functions](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker) | `SECURITY INVOKER` é o padrão/recomendação geral. Quando `SECURITY DEFINER` for usado, a documentação orienta definir `search_path` vazio e qualificar objetos. | Manter a implementação privilegiada mínima em schema privado, wrapper público estreito, `search_path = ''` e nomes totalmente qualificados. | `search_path=''` não valida `auth.uid()`, papel, permissão, setor, tamanho de JSON nem regras de domínio. Essas verificações são específicas da aplicação. |
| [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) | RLS deve ser habilitada e policies controlam acesso; funções `SECURITY DEFINER` podem contornar RLS conforme proprietário/contexto e não devem ficar expostas sem necessidade. | Não enfraquecer RLS por desempenho; limitar grants e cobrir wrappers com testes de acesso autorizado, anônimo e cross-sector. | RLS correta depende das policies, índices e grants reais. A página não prova que uma função atual é segura. |
| [PostgreSQL 17 — `CREATE FUNCTION`, segurança](https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY) | Uma função definer executa com privilégios do proprietário. O PostgreSQL orienta remover schemas graváveis por usuários do `search_path`, colocar `pg_temp` por último quando se usa uma lista de schemas confiáveis e controlar `EXECUTE`; novas funções concedem `EXECUTE` a `PUBLIC` por padrão. Revogar e conceder dentro da mesma transação evita janela de exposição. | Para cada função privilegiada: proprietário controlado, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE` somente ao papel necessário e criação/grants na mesma migration transacional quando compatível. | Ser `SECURITY DEFINER` não torna uma RPC segura. Owner, overloads, search path, privilégios transitivos e capacidade de chamar helpers também precisam ser inventariados. |

Não existe suporte documental para publicar uma função definer genérica e
confiar somente no frontend. O servidor deve resolver e validar identidade e
escopo; credencial, JWT ou chave do papel `service_role` e segredos
operacionais não pertencem ao navegador.

## 8. `CREATE INDEX CONCURRENTLY` e migrations

| Fonte oficial | Documentado | Decisão sustentada | Limite de inferência |
|---|---|---|---|
| [PostgreSQL 17 — Building Indexes Concurrently](https://www.postgresql.org/docs/17/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY) | A criação normal bloqueia writes durante a construção. `CONCURRENTLY` evita esse bloqueio, mas executa mais trabalho, realiza duas varreduras e esperas, permite somente uma construção concorrente por tabela, pode deixar índice `INVALID` após falha e não pode executar dentro de um transaction block. | Para índice grande/bloqueante, planejar criação faseada, detectar e tratar índice inválido, medir custo e fornecer rollback. | A documentação do PostgreSQL não informa se o migration runner adotado envolve cada arquivo em transação. Isso deve ser verificado com a versão fixada da CLI/runner em staging. |
| [Supabase — Managing Indexes](https://supabase.com/docs/guides/database/postgres/indexes) | Índices aceleram determinadas leituras, mas adicionam armazenamento e custo de escrita; a seleção deve seguir os filtros, joins e planos reais. | Registrar consulta, `EXPLAIN (ANALYZE, BUFFERS)` em staging, equivalência, tamanho, write amplification e `idx_scan` antes de manter um novo índice. | A documentação não sustenta criar em massa todos os índices sugeridos nem remover índices por baixa leitura em uma janela curta. |

Consequência: uma migration que contém `CREATE INDEX CONCURRENTLY` não deve ser presumida compatível com execução transacional. O plano precisa documentar como o comando será aplicado, retomado e revertido no runner real, sem bloquear produção.

## 9. Matriz resumida de decisão

| Tema | O que as fontes sustentam | O que ainda precisa ser provado no AC-Prod2 |
|---|---|---|
| PGMQ | `read` + VT + `set_vt` + archive formam a base de entrega redeliverable. | DLQ explícita, atomicidade do efeito/archive, prioridade live:replay, zero perda e zero duplicidade produtiva. |
| Realtime | Canais privados usam RLS; token pode ser renovado; reconexão existe. | Registry singleton, ausência de canais duplicados, isolamento por setor, gap detection, snapshot e latência de Broadcast. |
| Auth | Pool percentual é suportado; serviços disputam conexões do compute. | Configuração efetiva, percentual seguro, pool wait, storm de login/refresh e ausência de logout involuntário. |
| Edge Functions | Runtime é limitado e tarefas background continuam limitadas. | Throughput real, função adequada como control plane e capacidade do worker persistente escolhido. |
| `pg_net`/Cron | HTTP pós-commit e scheduling são suportados. | Recuperação sem perda, sweeper idempotente e independência do caminho normal em relação ao cron. |
| Timeouts | Lock e statement timeout têm escopos distintos; configuração global é desaconselhada. | Valores seguros, classificação de erros e impacto sob colisão. |
| `SECURITY DEFINER` | Search path, ownership e grants exigem hardening explícito. | Auditoria de cada overload, auth/sector enforcement e testes negativos. |
| Índices concorrentes | Reduzem bloqueio de writes, têm custo/riscos e não rodam em transaction block. | Compatibilidade com runner, duração, espaço, write amplification e benefício no plano real. |

## 10. Checklist documental para a Fase Zero

Antes de qualquer alteração ou rollout:

1. Registrar versão efetiva de PGMQ e assinaturas de `read`, `set_vt`, `archive` e demais helpers usados.
2. Inventariar filas, archive, policies de `realtime.messages`, configuração de canais privados e versão das bibliotecas cliente.
3. Registrar `max_connections`, reservas, consumo por `application_name`, configuração/unidade do pool de Auth e pool do Realtime.
4. Registrar versões e limites vigentes das Edge Functions; não inferir persistência a partir de `waitUntil`.
5. Inventariar jobs via APIs `cron.*`, configuração de `pg_net` e dependências Vault apenas pelo nome, sem valores.
6. Extrair definições reais, owners, overloads, `proconfig`, grants e dependências das funções `SECURITY DEFINER`.
7. Confirmar a semântica transacional do migration runner fixado antes de programar índices concorrentes.
8. Medir baseline e deltas por run; não converter contadores cumulativos em métricas do ensaio.
9. Executar testes de falha e reconciliação em ambiente não produtivo antes de declarar qualquer garantia de durabilidade ou capacidade.

## 11. Conclusão e fronteira de evidência

As fontes oficiais sustentam a direção arquitetural de manter PostgreSQL como sistema de registro, usar PGMQ com entrega redeliverable e efeitos idempotentes, tratar Broadcast privado como notificação autorizada, orçar conexões entre serviços, reservar Edge Functions para trabalho limitado, aplicar timeouts localmente, endurecer funções definer e planejar índices concorrentes fora de transaction blocks.

Elas **não** sustentam, sem evidência do runtime e testes, que:

- o projeto atual possui as versões ou configurações esperadas;
- PGMQ oferece exatamente uma aprovação produtiva por si só;
- Broadcast entrega ou reproduz todos os eventos;
- um percentual específico do Auth é seguro;
- Edge Functions ou um worker externo cumprem o throughput desejado;
- `pg_net`/Cron cumprem SLO subsegundo;
- os timeouts propostos são corretos;
- uma função definer atual é segura;
- um índice novo melhora a carga total;
- os SLOs, zero perda ou zero dupla aprovação foram homologados.

Essas conclusões dependem do inventário Git/runtime, de medições before/after, de testes concorrentes e da reconciliação registrada por `capacity_run_id`. Até lá, esta evidência apoia decisões de desenho, mas não autoriza ativar flags v3/vNext nem emitir GO.

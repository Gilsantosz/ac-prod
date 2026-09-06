# Runbook de implantação — Collection Fabric v3

Status: **recuperação e validação funcional no `capacity-test` isolado;
capacidade k6 e homologação para produção plena permanecem pendentes**.

Os registros abaixo descrevem janelas históricas, não garantias de saúde atual.
A antiga exceção de carga `test-production` foi removida. Consulte também o
[registro de recuperação de 06/09/2026](collection-capacity-recovery-2026-09-06.md).

Este runbook implanta o caminho v3 sem dupla escrita produtiva. As migrations são
aditivas e as quatro flags começam desligadas. Aplicar as migrations não autoriza
ativar o tráfego. A capacidade permanece **não validada** até que os testes k6
passem no mesmo tipo de compute que receberá o tráfego.

## Registro da implantação de 2026-09-02

Esta execução ocorreu após autorização explícita para tratar o aplicativo de
produção como ambiente de teste. Ela comprova instalação, publicação e saúde
estrutural; não substitui o ensaio de capacidade descrito na seção 5.

- Supabase: projeto `uozuzdfvnufsjsonswag`, região `sa-east-1`, PostgreSQL 17.6,
  observado como `ACTIVE_HEALTHY` durante a janela.
- Git: PR [#61](https://github.com/Gilsantosz/ac-prod/pull/61), merge squash
  `ec05579fa7f77e9b109e8beaaaf7eaecf6c35a43`.
- Frontend: [GitHub Pages](https://gilsantosz.github.io/ac-prod/) publicado pelo
  workflow [33642368398](https://github.com/Gilsantosz/ac-prod/actions/runs/33642368398).
  O `build-info.json` público confirmou o mesmo SHA.
- Banco: migrations `20260901120000`, `20260901121000`, `20260901122000`,
  `20260901123000`, `20260901124000`, `20260901125000` e `20260901130000`
  aplicadas e reconciliadas no ledger remoto. O histórico anterior já estava
  divergente entre local e remoto; ele não foi reescrito nem reparado em bloco.
- Edge Functions: `process-collection-v3` e `project-collection-v3` publicadas na
  versão 1, com autenticação interna por `x-cron-secret`; chamadas sem segredo
  retornaram 401.
- Flags: `ingress`, `worker`, `projection` e `broadcast` habilitadas, nessa ordem,
  com escopo global no ambiente de teste. A última ativação ocorreu às
  `2026-09-02T14:34:57Z`.
- Validação: lint, typecheck, 463 testes unitários, auditoria de dependências e
  segredos, build, aceitação SQL transacional e Playwright contra o Pages
  passaram. Às `2026-09-02T14:38:03Z`, o health v3 retornou `ready=true`,
  `structural_ready=true`, filas e DLQ zeradas, sem deadlocks ou statement
  timeouts; o health legado v9.2.3 também permaneceu `ready=true`.
- Pendência explícita: não havia fixture protegida com 100 dispositivos/sessões
  autorizadas e até 18.000 códigos válidos exclusivos. Por isso, nenhum perfil
  k6 foi executado e `capacity_estimate` continua `null`. Não promover este
  resultado como homologação de capacidade para uso produtivo real.

Se o ambiente passar a conter operação real, limite ou desligue primeiro as
flags conforme o [runbook de rollback](collection-fabric-v3-rollback.md), gere a
fixture em ambiente isolado e conclua os gates de capacidade antes de nova
expansão.

## Registro da reativação de teste — 2026-09-06

- Migrations `20260906122148` e `20260906123339` aplicadas. Elas removem o lease
  global single-flight, criam 8 slots de decisão e 4 de projeção, unem
  autenticação/claim/processamento em um RPC transacional, indexam a resolução
  de peças e incorporam cinco checagens estruturais fail-closed ao health.
- Edge Functions `process-collection-v3` e `project-collection-v3` publicadas na
  versão 4. Ambas validam o segredo dentro do ciclo atômico; chamadas válidas
  com fila vazia retornaram HTTP 200, sem timeout.
- As quatro flags estão habilitadas com escopo global somente para a fase de
  testes e perfil SLO `test`. O perfil `production` não foi relaxado.
- Smoke funcional controlado: ACK 113,539 ms, queue 1.903,027 ms, decisão
  50,337 ms e projeção 1.607,723 ms; zero retry, erro, DLQ, deadlock ou statement
  timeout. A repetição do evento manteve uma única linha.
- Integridade: 139 leituras aprovadas = 139 fatos consolidados, sem ausências;
  filas zeradas; health `ready=true` e `structural_ready=true`.
- Validação local: lint, typecheck, build e 540 testes aprovados. A capacidade
  nominal/burst continua sem certificação e `capacity_estimate=null`.

## Papéis e registros obrigatórios

| Papel | Responsabilidade | Responsável / evidência |
| --- | --- | --- |
| Incident commander | decide avançar, pausar ou reverter | a preencher |
| Banco | migration, catálogo, filas e reconciliação | a preencher |
| MES | regras produtivas e compatibilidade | a preencher |
| Frontend | roteamento exclusivo v2/v3 e estados neutros | a preencher |
| Observabilidade | métricas, alertas e artefatos | a preencher |

Abra um registro de mudança antes da primeira ação. Anexe commit, checksums das
migrations, alvo Supabase, classe de compute, horário, responsáveis, baseline,
saída dos testes e cada mudança de flag. Nunca grave chaves ou JWTs no registro.

## Barreiras que bloqueiam o rollout

- Nenhuma migration antiga foi alterada; somente migrations novas foram
  acrescentadas. Mudanças de trigger são guardadas, registradas e reversíveis.
- Backup/PITR e restauração foram verificados no alvo, sem executar restauração em
  produção.
- Não há trabalho manual de schema fora das migrations versionadas.
- O inventário e o ADR estão aprovados.
- As definições reais dos três triggers de projeção foram capturadas no registry,
  com checksum, e os três guards estão instalados.
- Browser, `anon` e `authenticated` não conseguem consumir PGMQ.
- SQL, Vitest, Playwright e verificação de segredos passam.
- A massa de staging representa rota, reposição, retrabalho, rejeição e código de
  exatamente oito dígitos.
- Todos os perfis k6 passaram no compute representativo e o relatório de
  capacidade contém artefatos, não estimativas.
- O rollback abaixo foi ensaiado em staging e assinado.

Falhas estruturais, de integridade ou autorização impedem habilitar tráfego novo.
Gates de capacidade ainda pendentes limitam a execução aos ensaios autorizados
no ambiente isolado: não autorizam promoção para produção. As flags necessárias
ao ensaio só são habilitadas nesse alvo, após os pré-requisitos estruturais.

## 1. Preparar staging isolado

1. Crie/restaure um staging sem tráfego produtivo, com a mesma versão PostgreSQL,
   extensões e classe de compute pretendida. Registre diferenças inevitáveis.
2. Gere usuários e sessões operacionais exclusivos do teste. A fixture de k6 deve
   conter ao menos 100 `device_id` distintos, sessões autorizadas e 18.000 códigos
   produtivos exclusivos, válidos e prontos para a etapa testada.
3. Guarde a fixture fora do repositório, com permissão somente para o operador do
   teste. Formato mínimo:

   ```json
   {
     "devices": [
       {
         "access_token": "JWT-EXCLUSIVO-DESTE-USUARIO-DE-TESTE",
         "device_id": "00000000-0000-4000-a000-000000000001",
         "operator_session_id": "00000000-0000-4000-a000-000000000002",
         "machine_id": "00000000-0000-4000-a000-000000000003",
         "cell_id": "00000000-0000-4000-a000-000000000005"
       }
     ],
     "codes": ["00000001"],
     "code_cells": { "00000001": "00000000-0000-4000-a000-000000000005" },
     "contention": {
       "lot_id": "00000000-0000-4000-a000-000000000004",
       "cell_name": "Corte"
     }
   }
   ```

   Cada dispositivo da carga deve ter usuário Auth e sessão operacional distintos.
   Um JWT compartilhado não comprova múltiplos usuários e é recusado. O preflight
   valida o emissor, papel `authenticated`, pelo menos 15 minutos de validade e
   confirma o usuário no Auth e a sessão/contexto pela API com RLS, sem imprimir
   tokens. Não use `service_role` no k6. Nominal, burst e priority exigem pelo
   menos duas células e `code_cells` para todos os códigos; ordene os códigos
   conforme a seleção circular de dispositivos do perfil. Um código destinado
   a outra célula interrompe o envio antes de ingressar o batch.
   Os perfis de contenção exigem uma `machine_id` distinta por dispositivo;
   os primeiros 50 códigos devem ser peças distintas do mesmo lote/célula, e o
   primeiro código é reutilizado por 20 máquinas no perfil `contention_piece`.
   Não versionar, imprimir nem anexar esse arquivo aos resultados.
4. Reserve, por dispositivo e rodada, um `K6_SEQUENCE_BASE` que ainda não exista.
   Registre o valor; não o reutilize com outro `K6_RUN_ID`.
5. Confirme que `app.settings.supabase_url` (ou o secret Vault versionado
   `project_url`/`supabase_url`) aponta para o próprio staging. A migration deriva
   os endpoints dos workers desse valor e aborta se encontrar endpoint de outro
   projeto. Nunca reutilize no staging um URL de worker de produção.

## 2. Aplicar e inspecionar as migrations

Use o fluxo versionado do projeto para aplicar migrations no staging. Depois,
antes de habilitar flags, verifique em modo somente leitura:

- release rows v3 presentes e checksums esperados;
- quatro filas logged: `collection_live_v3`, `collection_replay_v3`,
  `collection_projection_v3` e `collection_dead_letter_v3`;
- DLQ vazia e nenhuma mensagem anterior sem classificação;
- unique de `client_event_id`, unique parcial de `(device_id, device_sequence)` e
  unique de aprovação por peça/etapa/ciclo;
- três entradas `guard_installed=true` no registry e DDL/checksum preservados;
- functions v3 com owner esperado, `SECURITY DEFINER`, `search_path` fixo e grants
  mínimos;
- políticas RLS dos recibos e dos canais privados;
- flags `ingress`, `worker`, `projection` e `broadcast` iguais a `false`.

Se a instalação de qualquer guard estiver incompleta, o gate falha fechado. Não
recrie trigger manualmente e não ligue worker/projetor.

Implante também `process-collection-v3` e `project-collection-v3` pelo pipeline
versionado de Edge Functions do staging. Como o `pg_net` autentica essas rotas
com `x-cron-secret` e não envia JWT de usuário, ambas devem ser publicadas com a
verificação JWT da borda desativada; a função ainda recusa qualquer chamada cujo
segredo não passe por `verify_collection_worker_cron_secret`. Confirme 401 para
segredo ausente/incorreto e nunca exponha o segredo ao frontend.

Antes do piloto, prove também o comportamento de retrabalho com
`production_cycle > 1` quando `item_id` estiver preenchido. Os índices legados
mais restritivos não são removidos por esta entrega; qualquer conflito mantém o
rollout em NO-GO até uma migration separada, baseada em evidência de staging.

## 3. Validar com flags desligadas

Execute lint, typecheck, testes unitários, SQL transacional com rollback,
Playwright e auditoria de segredos. Valide também que:

- o v2 continua processando seus eventos normalmente;
- uma tentativa v3 com ingress desligado é recusada sem recibo parcial;
- health informa a estrutura e as flags reais, sem afirmar capacidade;
- frontend não aprova uma peça por ACK local ou ACK de banco;
- JWT/token não aparece no IndexedDB, payload, Broadcast ou logs.

## 4. Habilitar o caminho somente em staging

As flags devem ser alteradas apenas pelo RPC administrativo com credencial
`service_role` mantida em um executor seguro. Não registre a credencial. Use um
escopo explícito com os IDs da fixture e habilite nesta ordem:

1. `collection_pipeline_v3_ingress`;
2. `collection_pipeline_v3_worker`;
3. `collection_pipeline_v3_projection`;
4. `collection_pipeline_v3_broadcast`.

Após cada mudança, leia `get_collection_runtime_health_v3()`, registre o retorno
sanitizado e confirme que o escopo não inclui dispositivos/células fora do teste.
Não envie um evento ao v2 e ao v3. O roteamento do dispositivo é exclusivo.

## 5. Executar a carga reproduzível

O script [collection-fabric-v3.js](../../tests/load/collection-fabric-v3.js)
exige confirmação de staging e nunca habilita flags. Ele aceita exclusivamente
o projeto isolado `capacity-test` (`smnsihksrhzbkhcbdjfu`); a antiga exceção para
carga no projeto principal foi removida.
Use uma fixture protegida e execute cada perfil separadamente. Exemplo normal:

```bash
export SUPABASE_URL="https://smnsihksrhzbkhcbdjfu.supabase.co"
export SUPABASE_ANON_KEY="CHAVE-PUBLICA-DE-STAGING"
export K6_TARGET="staging"
export K6_CONFIRM_WRITES="staging-v3-load"
export K6_SLO_PROFILE="production"
export K6_FIXTURES="/caminho-seguro/collection-v3-fixture.json"
mkdir -p artifacts

K6_SEQUENCE_BASE=100000000 K6_PROFILE=smoke K6_RUN_ID=smoke-r1 \
  k6 run --summary-export=artifacts/smoke-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=110000000 K6_PROFILE=idempotency K6_RUN_ID=idempotency-r1 \
  k6 run --summary-export=artifacts/idempotency-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=120000000 K6_PROFILE=microbatch K6_RUN_ID=microbatch-r1 \
  k6 run --summary-export=artifacts/microbatch-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=130000000 K6_PROFILE=priority K6_RUN_ID=priority-r1 \
  k6 run --summary-export=artifacts/priority-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=140000000 K6_PROFILE=contention_piece K6_RUN_ID=piece-r1 \
  k6 run --summary-export=artifacts/piece-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=150000000 K6_PROFILE=contention_cell_lot K6_RUN_ID=cell-lot-r1 \
  k6 run --summary-export=artifacts/cell-lot-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=160000000 K6_PROFILE=nominal K6_RUN_ID=nominal-r1 \
  k6 run --summary-export=artifacts/nominal-r1.json tests/load/collection-fabric-v3.js
K6_SEQUENCE_BASE=170000000 K6_PROFILE=burst K6_RUN_ID=burst-r1 \
  k6 run --summary-export=artifacts/burst-r1.json tests/load/collection-fabric-v3.js
```

### Isolamento obrigatório

O projeto principal `uozuzdfvnufsjsonswag` e o antigo alvo `test-production`
sempre falham no preflight, mesmo com a antiga frase de confirmação. A carga
grava recibos, fatos, outbox e KPIs somente no teste isolado e não possui limpeza
automática. Não use dados reais; reserve peças sintéticas exclusivas e preserve
os dados já existentes no teste.

Comece obrigatoriamente pelo `smoke`. Antes de executar qualquer outro perfil,
confirme health `ready=true`, filas drenadas, DLQ vazia, reconciliação correta e
ausência de usuários reais. Registre a autorização, o checksum da fixture
sanitizado e a faixa de sequência. O perfil nominal grava 18.000 eventos por
rodada; repetições exigem novos códigos e novas faixas.

Use uma nova faixa de sequence para cada comando. Repita nominal e rajada pelo
menos três vezes depois de aquecimento, sem alterar timeouts, concorrência ou
carga para esconder falhas. Colete simultaneamente CPU, memória, conexões,
locks, I/O, WAL, fila, DLQ e heartbeats. O polling do k6 é parte deliberada da
carga fim a fim e deve ser descrito no relatório.

O sucesso de `ACK/decision_committed_at/projected_at` não demonstra sozinho que
a coleta foi aprovada: os perfis nominal/burst atuais observam término, inclusive
rejeições de negócio. Antes de homologar, reconcilie todos os IDs da rodada com
o resultado esperado da fixture, leituras, lançamentos e projeções; códigos
inexistentes/rejeitados não substituem a carga de aprovação de peças válidas.
Os perfis de contenção e idempotência possuem verificações adicionais de ledger.

O gate mantém zero perda, zero dupla aprovação, zero deadlock, zero statement
timeout e DLQ vazia nos dois perfis. Em `production`, os limites continuam ACK
p95 < 250 ms, decisão p95 < 800 ms/p99 < 2 s, projeção p95 < 500 ms e queue age
p99 < 2 s. Em `test`, para homologação com clientes fora da região primária de
São Paulo, os limites são ACK p95 < 1,5 s, decisão p95 < 1,5 s/p99 < 5 s,
projeção p95 < 2 s e queue age p99 < 5 s. O perfil de teste não certifica
produção e não permite erro ou perda. No nominal, os 100 canais privados de
dispositivo devem permanecer conectados e cada um deve receber ao menos um
`collection.finalized`. O p95 de IndexedDB (25 ms) vem de instrumentação de
browser, não do k6.

## 6. Shadow somente leitura

Para observação do incidente sem ingressar/reprocessar peças, execute os scripts
[collection_capacity_observation.sql](../../supabase/tests/collection_capacity_observation.sql)
e [collection_capacity_query_stats.sql](../../supabase/tests/collection_capacity_query_stats.sql)
com a conexão administrativa já configurada **do teste isolado**. Ambos usam
`BEGIN READ ONLY`, timeout de 5 segundos e não alteram flags, filas ou estatísticas.
Repita após um intervalo conhecido para calcular a drenagem e deltas de
`calls/total_exec_ms`; não zere estatísticas compartilhadas. Os percentis de
decisão/projeção incluem apenas eventos concluídos e retornam seus denominadores.
Fila pendente torna esses percentis insuficientes para afirmar que o SLO passou.
`collection_stage_facts` é uma view de leituras aprovadas: sua igualdade com as
leituras **não comprova** que outbox, indicadores e notificações foram projetados.

O teste antigo `collection-snapshot-2000.js` usa bearer anônimo e não serve como
prova de capacidade dos RPCs protegidos. Meça snapshots/KPIs pelo login normal de
teste, sem fabricar identidade ou usar `service_role` como operador. A carga k6
não mede IndexedDB, pintura da UI ou recuperação da sessão; valide também o
browser sob reconexão e renovação de token. A aceitação SQL estrutural antiga
exige flags inicialmente desligadas e não deve ser executada sem adaptação numa
célula ativa, mesmo usando rollback.

Shadow não pode chamar o RPC de ingresso nem gravar fato/outbox. Com as flags de
roteamento produtivo desligadas, reproduza snapshots sanitizados por um avaliador
somente leitura e compare a decisão esperada do v3 com o resultado persistido do
v2. Se não houver avaliador v3 read-only versionado, este gate permanece
bloqueado; não improvise shadow com dupla escrita.

Critérios: nenhuma mutação v3, nenhuma divergência sem explicação aprovada e
nenhum dado sensível nos artefatos.

## 7. Piloto e expansão

Para cada estágio abaixo, execute primeiro os gates, aplique escopo explícito e
observe ao menos um turno produtivo completo antes de expandir:

| Estágio | Escopo | Gate para avançar |
| --- | --- | --- |
| Máquina piloto | um `device_id`, uma célula | health ready, fila drena, sem DLQ, operador confirma UX |
| Célula piloto | todos os dispositivos da célula | ledger/projeções reconciliados; compatibilidade aprovada |
| Expansão | poucas células por vez | SLOs mantidos por turno; nenhum incidente aberto |
| Geral | todas as células aprovadas | relatório e assinaturas completos |

Durante o piloto, leituras ACKadas pelo v3 continuam pertencendo ao v3. O fallback
v2 é permitido somente para novas capturas inequivocamente não persistidas no v3.
Resultado desconhecido exige reconciliação por `client_event_id` antes de reenviar.

Monitore continuamente filas live/replay/projection, idade p50/p95/p99, tentativas,
SQLSTATE, DLQ, latência de Broadcast, atraso do outbox, divergência de shards e
estado dos workers. Cron é recuperação; wakeup coalescido é o caminho normal.

## 8. Gate final e evidência

Antes da próxima expansão, anexe:

- commit e migrations efetivamente aplicadas;
- health antes, durante e após, sem tokens;
- summaries k6 e séries temporais do banco;
- resultados SQL/Vitest/Playwright e browser IndexedDB;
- contagem de recibos, fatos, outbox, projeções e reconciliação;
- SQLSTATE/retry/DLQ, incluindo zeros observados;
- divergências v2/shadow e decisão registrada;
- ensaio de rollback e responsáveis que aprovaram.

Capacidade não é inferida do código ou de um smoke test. Sem os artefatos no
[relatório de capacidade](../architecture/collection-fabric-v3-capacity-report.md),
o resultado obrigatório é **NO-GO**.

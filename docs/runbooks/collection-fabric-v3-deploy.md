# Runbook de implantação — Collection Fabric v3

Status: **rollout contido em 2026-09-02; capacidade não homologada e quatro flags
v3 desligadas após falha de SLO no smoke real**.

O relatório da rodada e a evidência de limpeza estão em
[ACPROD2_CAPACITY_CAPTEST_20260902_161216_22D6E66B.md](../reports/ACPROD2_CAPACITY_CAPTEST_20260902_161216_22D6E66B.md).

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

Qualquer item pendente mantém todas as flags v3 desligadas.

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
     "access_token": "JWT-DE-USUARIO-DE-STAGING",
     "devices": [
       {
         "device_id": "00000000-0000-4000-a000-000000000001",
         "operator_session_id": "00000000-0000-4000-a000-000000000002",
         "machine_id": "00000000-0000-4000-a000-000000000003"
       }
     ],
     "codes": ["00000001"],
     "contention": {
       "lot_id": "00000000-0000-4000-a000-000000000004",
       "cell_name": "Corte"
     }
   }
   ```

   `access_token` também pode existir por dispositivo. Não use `service_role` no
   k6. Os perfis de contenção exigem uma `machine_id` distinta por dispositivo;
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

O workload [collection-fabric-v3.js](../../tests/load/collection-fabric-v3.js)
exige confirmação de staging e nunca habilita flags. Ele deve ser iniciado
somente pelo executor
[run-controlled-capacity.mjs](../../tests/capacity/run-controlled-capacity.mjs),
que reclama atomicamente o run solicitado na página administrativa, mantém
heartbeat, pausa/retoma o processo k6 e encerra-o ao observar cancelamento,
emergency-stop ou perda do plano de controle. Não chame `k6 run` diretamente.

Solicite o run na página **Testes de Capacidade**, usando perfil, alvo e
`sequence_base` exatos. Copie o `CAPTEST_...` exibido e gere uma fixture nova
para esse run/perfil antes de iniciar o executor. Dispositivos, peças e duração
são limites fixos do perfil versionado; o banco e o executor recusam uma
configuração divergente. A credencial server-side entra somente por stdin e é
removida do ambiente filho; o k6 continua usando exclusivamente a chave
pública/JWTs da fixture. A saída do preparador deve ficar fora do repositório.
`nominal` pagina e valida 18.000
códigos e cria 100 sessões operacionais com `device_id`/`session_id` distintos;
os perfis de contenção recebem 20 ou 50 máquinas de teste realmente distintas na
mesma célula. O perfil `atomic8`, em contraste, grava o mesmo contexto de
célula/máquina nas oito sessões reais. Chamadas não idempotentes de criação e
login não são repetidas automaticamente; o cleanup procura também users Auth
marcados com o `run_id`, cobrindo uma resposta perdida antes do checkpoint.

`K6_CODE_OFFSET` deve estar ausente ou ser zero. Como a massa é exata e vinculada
ao perfil/run, deslocar os códigos é recusado antes do claim; gere uma nova
fixture e uma nova faixa para qualquer repetição.

```bash
export SUPABASE_URL="https://STAGING-REF.supabase.co"
export SUPABASE_ANON_KEY="CHAVE-PUBLICA-DE-STAGING"
export K6_TARGET="staging"
export K6_CONFIRM_WRITES="staging-v3-load"
export K6_PROFILE="smoke"
export K6_SEQUENCE_BASE="100000000"
export CAPACITY_RUN_ID="CAPTEST_YYYYMMDD_HHMMSS_XXXXXXXX"
export CAPTEST_PRIVATE_DIR="/private/tmp/acprod-capacity-private"
export K6_FIXTURES="${CAPTEST_PRIVATE_DIR}/${CAPACITY_RUN_ID}-${K6_PROFILE}.json"
export CAPACITY_SUMMARY="artifacts/capacity/${CAPACITY_RUN_ID}/${K6_PROFILE}.json"

node tests/capacity/seed-capacity-fixture.mjs "$CAPACITY_RUN_ID" "$K6_PROFILE"
# Aplique o seed.sql informado pelo comando acima no staging vinculado.
supabase projects api-keys --project-ref "STAGING-REF" --reveal --output json | \
  node tests/capacity/prepare-auth-fixture.mjs \
    "$CAPACITY_RUN_ID" "$K6_PROFILE" \
    "${CAPTEST_PRIVATE_DIR}/${CAPACITY_RUN_ID}-operator-credentials.json" \
    "$K6_FIXTURES"

npm run capacity:controlled -- \
  --run-id "$CAPACITY_RUN_ID" --summary-export "$CAPACITY_SUMMARY" --dry-run

supabase projects api-keys --project-ref "STAGING-REF" --reveal --output json | \
  npm run capacity:controlled -- \
    --run-id "$CAPACITY_RUN_ID" --summary-export "$CAPACITY_SUMMARY"
```

O dry-run não toca o banco nem gera carga. A execução real recusa divergência
entre os valores locais e o registro solicitado. Repita o procedimento com um
novo run e uma nova faixa: uma vez para `idempotency` e `atomic8`; três vezes
para `microbatch`, `priority`, `contention_piece`, `contention_cell_lot`,
`nominal` e `burst`. Preserve tanto o summary quanto o sidecar
`*.control.json` criado pelo executor.

Se o host do executor morrer após o claim, aguarde ao menos 15 segundos e prove
fora do banco que não existe processo k6 remanescente. A página então habilita
**Falhar run órfão** e exige `FALHAR EXECUTOR SEM HEARTBEAT`. A transição é
travada no banco, registra `executor_heartbeat_expired` e libera o singleton ao
tornar o run `failed`. Não tente assumir o mesmo run com outro executor: abra um
novo `CAPTEST_...` e reserve outra faixa de sequência, evitando sobreposição ou
evidência ambígua.

### Exceção temporária: AC.Prod de produção usado como ambiente de teste

> **ATENÇÃO — ESCRITAS DESTRUTIVAS:** esta exceção grava recibos, fatos de
> produção, tentativas, outbox, projeções e KPIs no projeto
> `uozuzdfvnufsjsonswag`. A carga não possui limpeza automática e pode alterar
> dashboards, lotes e contadores. Não execute com dados ou usuários reais.

Use esta forma somente com autorização registrada para a janela atual. As três
travas precisam coincidir exatamente: alvo `test-production`, URL base do project
ref autorizado e frase forte que nomeia a escrita destrutiva. Uma URL parecida,
outro project ref ou a confirmação de staging falha antes de qualquer requisição.
Nunca use `service_role` na fixture nem em variável passada ao k6.

```bash
export SUPABASE_URL="https://uozuzdfvnufsjsonswag.supabase.co"
export SUPABASE_ANON_KEY="CHAVE-PUBLICA-DO-PROJETO"
export K6_TARGET="test-production"
export K6_CONFIRM_WRITES="EU-AUTORIZO-ESCRITAS-K6-DESTRUTIVAS-NO-ACPROD-TESTE-uozuzdfvnufsjsonswag"
export K6_FIXTURES="/caminho-seguro/collection-v3-fixture.json"
export K6_PROFILE="smoke"
export K6_SEQUENCE_BASE="180000000"
export CAPACITY_RUN_ID="CAPTEST_YYYYMMDD_HHMMSS_XXXXXXXX"
export CAPACITY_SUMMARY="artifacts/capacity/${CAPACITY_RUN_ID}/${K6_PROFILE}.json"

supabase projects api-keys --project-ref "uozuzdfvnufsjsonswag" --reveal --output json | \
  npm run capacity:controlled -- \
    --run-id "$CAPACITY_RUN_ID" --summary-export "$CAPACITY_SUMMARY"
```

Comece obrigatoriamente pelo `smoke`. Antes de executar qualquer outro perfil,
confirme health `ready=true`, filas drenadas, DLQ vazia, reconciliação correta e
ausência de usuários reais. Registre a autorização, o checksum da fixture
sanitizado e a faixa de sequência. O perfil nominal grava 18.000 eventos por
rodada; repetições exigem novos códigos e novas faixas. Quando o projeto deixar de
ser ambiente de teste, remova esta exceção em uma alteração versionada antes de
qualquer nova carga.

Use uma nova faixa de sequence para cada comando. Repita nominal e rajada pelo
menos três vezes depois de aquecimento, sem alterar timeouts, concorrência ou
carga para esconder falhas. Colete simultaneamente CPU, memória, conexões,
locks, I/O, WAL, fila, DLQ e heartbeats. O polling do k6 é parte deliberada da
carga fim a fim e deve ser descrito no relatório.

O gate exige, no mínimo: zero perda, zero dupla aprovação, zero deadlock, zero
statement timeout, ACK p95 abaixo de 250 ms, decisão p95 abaixo de 800 ms e p99
abaixo de 2 s, projeção p95 abaixo de 500 ms e queue age p99 abaixo de 2 s no
nominal. No nominal, os 100 canais privados de dispositivo devem permanecer
conectados e cada um deve receber ao menos um `collection.finalized`. O p95 de
IndexedDB (25 ms) vem de instrumentação de browser, não do k6.

Antes das rodadas válidas, faça um smoke descartável de parada: com o executor
ativo, acione **Pausar**, confirme que os contadores deixam de avançar; acione
**Retomar**, confirme continuidade; por fim acione **Parada de emergência** e
confirme `emergency_stopped`, término do PID k6 em até 3 segundos e ausência de
novas requisições. Esse run não entra no gate.

Ao final, copie
[capacity-gate-manifest.example.json](../../tests/capacity/capacity-gate-manifest.example.json),
defina um único `target`, preencha os sidecars e evidências e execute:

```bash
npm run capacity:gate -- artifacts/capacity/HOMOLOGACAO/manifest.json
```

O avaliador exige 21 rodadas, hashes dos summaries, faixas únicas, todos os
thresholds e todas as evidências. Qualquer ausência retorna **NO-GO** (exit 2).
Ele nunca habilita flags nem promove release.

## 6. Shadow somente leitura

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

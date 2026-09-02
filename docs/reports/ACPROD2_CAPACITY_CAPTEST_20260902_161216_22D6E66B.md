# AC.Prod2 — diagnóstico, correção e teste controlado

Run: `CAPTEST_20260902_161216_22D6E66B`  
Data: 2026-09-02  
Alvo autorizado: Supabase `uozuzdfvnufsjsonswag` (`test-production`)  
Decisão: **NO-GO — CAPACIDADE NÃO HOMOLOGADA**

## Resumo executivo

O incidente do projetor era funcionalmente sério: 58 decisões aprovadas estavam
persistidas no ledger/outbox, mas não chegavam a `production_entries` porque o
projetor referenciava a coluna ausente `production_entries.updated_at`
(`SQLSTATE 42703`). Não houve perda de decisões nem dupla projeção. A migration
restaurou a coluna/trigger e as 58 mensagens foram reprocessadas mantendo os
mesmos IDs. Ao final da recuperação havia 58 outboxes projetados, 58 entradas,
58 marcadores idempotentes, fila de projeção zero e DLQ 42703 zero.

O smoke real posterior confirmou integridade de uma nova leitura, mas reprovou os
SLOs de latência. Por isso, nenhum teste de carga superior foi executado, o
frontend não foi promovido e os quatro flags v3 foram desligados. O banco e as
Edge Functions receberam somente as correções necessárias para recuperar os
dados e tornar o teste/rollback controláveis.

## Diagnóstico de causa raiz

### Autenticação e Realtime

- O frontend usava timeout rígido de 3 s com `Promise.race`; falhas transitórias
  de perfil podiam limpar a sessão válida e iniciar sign-out.
- Havia leituras duplicadas de perfil, restauração agressiva do token fallback e
  logout operacional no unmount da tela de coleta.
- O JWT renovado não era propagado explicitamente ao Realtime, e os canais não
  tinham deduplicação/reconexão observável.
- A atualização automática do PWA podia recarregar o aplicativo durante uma
  operação.

Correção: máquina de estados de autenticação, cache/single-flight de perfil,
retry com jitter, preservação da sessão em erro transitório, descarte apenas em
erro definitivo, `realtime.setAuth` no refresh, canais deduplicados por
dispositivo/célula, reconexão com backoff e atualização PWA somente por ação do
usuário.

### Worker/projetor

- O projetor estava quebrado por drift de schema (`updated_at` ausente).
- Cron/wakeup podia sobrepor invocações. Foi adicionado lease distribuído por
tipo de worker e retorno 202 para chamadas coalescidas.
- A recuperação foi restrita aos 58 outboxes com erro exato 42703, auditável e
idempotente.

## Alterações instaladas no alvo

- Migrations aplicadas e registradas: `20260902164000`, `20260902164500`,
  `20260902165000`, `20260902165500` e `20260902170500`.
- `process-collection-v3`: Edge Function versão 2.
- `project-collection-v3`: Edge Function versão 2.
- Schema do projetor: `assert_collection_projection_schema_v3() = ok`.
- Plano de teste: 7 células, 8 máquinas distintas, 14 operadores e 500 peças
  de oito dígitos. Oito contextos atômicos foram autorizados na mesma máquina.

## Evidências do teste real

### Autenticação simultânea

Foram usados 8 usuários temporários, com 2 sessões simultâneas por usuário.

| Métrica | Resultado |
| --- | ---: |
| Logins bem-sucedidos | 16/16 |
| Usuários que preservaram as duas sessões | 8/8 |
| Login p50 / p95 / p99 | 1.670,815 / 1.720,196 / 1.720,196 ms |
| Perfil p50 / p95 / p99 | 402,726 / 410,983 / 410,983 ms |

### Smoke Collection Fabric v3

| Critério | Meta de aceite | Medido | Resultado |
| --- | ---: | ---: | --- |
| HTTP | zero erro | 24/24 requisições sem erro | PASS |
| Eventos perdidos | 0 | 0 | PASS |
| Dupla projeção | 0 | 0 | PASS |
| Deadlock do run | 0 | 0 | PASS |
| Statement timeout do run | 0 | 0 | PASS |
| DLQ do run | 0 | 0 | PASS |
| ACK de ingresso p95 | < 500 ms | 801,249 ms | **FAIL** |
| Decisão p95 | < 1.000 ms | 2.634 ms | **FAIL** |
| Decisão p99 | < 2.000 ms | 2.634 ms | **FAIL** |
| Queue age p95 | < 1.000 ms | 2.612 ms | **FAIL** |
| Projeção após decisão p95 | < 2.000 ms | 949 ms | PASS |
| Processamento interno | observacional | 110,524 ms | PASS |

O perfil seguinte foi bloqueado pelo preflight enquanto a amostra ruim ainda
estava na janela de health. O teste atômico, a rota completa, o nominal, o burst
e a endurance não foram executados: a regra é parar no primeiro gate crítico
violado, não reduzir carga nem relaxar limites.

### Estado após contenção

- Flags `ingress`, `worker`, `projection` e `broadcast`: `false`, com razão
  `CAPTEST_20260902_161216_22D6E66B_smoke_slo_failed`.
- Filas decision/projection: 0; leases ativos: 0; DLQ 42703: 0.
- Evento smoke: 1 recibo, 1 `client_event_id`, 1 projeção, 0 outbox pendente e
  0 dead letter.
- O health retornou `structural_ready=true` e `ready=true` após a drenagem; isso
  comprova estrutura/filas, não aprovação de desempenho.
- Os 191 deadlocks exibidos por `pg_stat_database` são cumulativos desde
  2026-05-22; o run produziu zero deadlock.

## Limpeza

- 16 sessões operacionais encerradas.
- 14 operadores temporários desativados.
- 3 máquinas criadas pelo teste desativadas; máquinas preexistentes preservadas.
- 500 peças temporárias arquivadas/inativadas.
- 8 usuários temporários removidos de Auth.
- 534 objetos de auditoria do fixture preservados.

## Gates locais

| Gate | Resultado |
| --- | --- |
| ESLint | PASS |
| Typecheck | PASS |
| Vitest | 106 arquivos / 473 testes PASS |
| Build Vite/PWA | PASS, com warning de tamanho de chunk preexistente |
| `npm audit --omit=dev --audit-level=high` | PASS, 0 vulnerabilidades após atualização transitiva |
| Secretlint | PASS |

## Pendências que impedem homologação

1. Reduzir a latência de cold start/wakeup/claim: a fila consumiu 2.507,356 ms,
   apesar do processamento interno de 110,524 ms.
2. Repetir smoke sem relaxar SLO; somente então executar atômico, rota completa,
   nominal, burst e endurance.
3. Corrigir drift legado detectado pelo lint remoto em entrada manual, validação
   de rota, reposição e expedição. Os avisos referentes a tabelas `pg_temp` nas
   funções v3/fixture são limitações estáticas do linter; as demais ocorrências
   são incompatibilidades reais e bloqueiam a homologação de reposição/expedição.
4. Validar IndexedDB no navegador e canais Realtime privados durante endurance.
5. Reconciliar ledger, projeções, KPIs e relatórios em todos os perfis.

## Decisão de implantação

As correções de schema/worker necessárias à recuperação estão instaladas. O
frontend candidato permanece em branch de correção e não deve ser mesclado em
`main` nem publicado enquanto os gates acima estiverem pendentes. Para nova
rodada, seguir o runbook de implantação e manter o rollback por flags pronto.

A branch foi publicada na PR 63. Os checks GitHub de contrato, segurança,
validação e build passaram, mas o check externo `Workers Builds: ac-prod2`
falhou no Build ID `c4281e56-033e-4bd7-bd3c-b5406e9cffa6`. O mesmo check já
falhava instantaneamente em commits anteriores cujos pipelines GitHub passaram.
Como `npm ci`, o build Vite e o dry-run do Wrangler passaram localmente, a
investigação deve continuar na integração/configuração Cloudflare conforme
[cloudflare-ac-prod2-build.md](../runbooks/cloudflare-ac-prod2-build.md). Essa
falha impede atualizar o frontend Cloudflare, mas não substitui nem derruba a
versão anterior.

## Artefatos

- `artifacts/capacity/CAPTEST_20260902_161216_22D6E66B/auth-results.json`
- `artifacts/capacity/CAPTEST_20260902_161216_22D6E66B/k6-smoke.json`
- `artifacts/capacity/CAPTEST_20260902_161216_22D6E66B/k6-smoke-2.json`

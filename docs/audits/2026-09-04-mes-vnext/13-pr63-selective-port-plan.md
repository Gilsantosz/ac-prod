# Port seletivo da PR #63 sobre a main atual

Base `9174c796`, PR #63 `95f95df`, merge-base `111501f`. A PR possui 11 commits
próprios e fica um commit atrás da main. Foram identificados 56 arquivos
alterados e conflito em `src/hooks/useProductionRealtimeSync.js`. A PR #64
adicionou sincronização de `production_stage_policies`, bootstrap de query cache
e cleanup que precisam ser preservados.

**NO-GO para merge/cherry-pick integral.**

| Commit | Tratamento |
|---|---|
| `95a5af3` | Portar telemetria sanitizada, acrescentando métricas verificáveis. |
| `a98a487` | Portar generation guard, single-flight, cache e preservação transitória; implementar a FSM exigida. |
| `f291524` | Adaptar renovação JWT/Realtime, teardown, deduplicação e prompt PWA. |
| `ac1a6d9` | Capturar drift literal; a lease global não é a arquitetura v4. |
| `bf44a33` | Não portar executor Edge HTTP como consumidor principal. |
| `33ec882` | Reescrever control plane e fixtures para staging e perfis v4. |
| `3e477a2`, `a685fdd` | Preservar evidências históricas NO-GO e Cloudflare. |
| `4f3a29d` | Reaproveitar guards de corrida e emergency-stop, com contrato v4. |
| `5d901dc`, `95f95df` | Reaproveitar ownership e lifecycle retry-safe; manter runs finalizados imutáveis. |

## Lacunas que o port precisa fechar

Auth: FSM da PR difere de INITIALIZING/AUTHENTICATED/DEGRADED_NETWORK/REFRESHING/
REAUTH_REQUIRED/SIGNED_OUT. `loginViaEmailPassword` mascara rede/5xx como 401;
restore retorna `null` tanto para ausência quanto indisponibilidade. Single-flight
é por aba, assignments não têm cache coerente e `setAuth` precisa tratar falha.
`Entry.jsx` também encerra a sessão operacional no unmount. Heartbeat operacional
precisa distinguir falha transitória de revogação definitiva.

Realtime: faltam registry central, reference counting, tópicos por setor,
revision-gap detection e snapshot inicial. O polling ainda permanece conectado
e existem criadores diretos de canais em `collectionService`,
`replacementService`, `CellsAndGoals` e `PromobIntegration`.

PWA: `registerType: prompt` e `skipWaiting: false` são aproveitáveis, mas o
`controllerchange` em `App.jsx` ainda recarrega incondicionalmente. A autorização
de update deve considerar captura, request incerto, flush e fila pendente.

Rejeitar CORS `*`, segredo estático no HTTP como identidade definitiva do worker,
lease única por `worker_kind`, limite de 100 dispositivos/60 minutos, SLO de
800/2.000 ms, recovery em massa sem dry-run/filtro/limite e sobrescrita de runs
finalizados. O `package-lock.json` final da PR é idêntico ao da main.

## Evidência mínima para aceitar o port

Testar falhas transitórias de perfil/rede, refresh concorrente, múltiplas abas,
logout durante retry, heartbeat degradado, rotação JWT, canais deduplicados,
Broadcast perdido, ressincronização por revision, isolamento LSM/CS, update PWA
durante coleta e regressão da PR #64. Verificações estáticas por strings devem
ser complementadas por testes de comportamento.

Este documento registra a revisão. O port funcional ainda não está concluído;
a recuperação do staging e a reconciliação histórica precedem sua homologação.

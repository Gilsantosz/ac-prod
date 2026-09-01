# AC.Prod2 — histórico controlado do rollout de coleta

Este documento registra o alinhamento entre o diretório `supabase/migrations`, o ledger remoto do projeto de produção `uozuzdfvnufsjsonswag` e o release publicado pelo GitHub Pages.

## Regra de integridade

Migrações que já constam como aplicadas em produção são tratadas como imutáveis. O histórico remoto não deve ser marcado como revertido nem reaplicado apenas para alterar a representação local. Quando uma alteração foi executada por um canal controlado do Supabase, o repositório pode manter um marcador `SELECT 1` com a mesma versão para preservar a ordenação do CLI e impedir execução duplicada.

## Rollout emergencial de coleta

As versões `20260831041525` a `20260831051513` foram aplicadas pelo canal controlado do Supabase durante a correção emergencial e já constam no ledger de produção. Os arquivos locais correspondentes são marcadores de alinhamento; eles não representam trabalho pendente.

As versões finais executáveis desse ciclo são:

- `20260831052152`: compatibilidade do Histórico para clientes ainda em cache;
- `20260831052721`: contrato fail-closed de concorrência, lotes, turnos e Realtime;
- `20260831052809`: publicação do marcador público de release.

## Reposição v8 e coleta rápida v8.5

O ledger de produção foi conferido antes da implantação da captura automática de oito dígitos. O estado reconciliado é:

| Versão | Nome no ledger remoto | Representação no repositório | MD5 do SQL registrado no Supabase |
|---|---|---|---|
| `20260831142929` | `replacement_roles_flow_and_audit_v1` | marcador de alinhamento, pois o SQL já foi executado pelo canal controlado | `bf60fda31c143ad947f7e41c42b31ed6` |
| `20260831143323` | `reconcile_replacement_workflow_v8_3` | migração executável e idempotente | `e7cfe4b26a60c396f0fefac9be523b71` |
| `20260831143850` | `fix_force_completion_conflict_v8_4` | migração executável e idempotente | `b83135394d35d6872bc14aa231798056` |
| `20260831150725` | `collection_exact_8_digit_fast_capture_v8_5` | migração executável e idempotente | `cb57bed31b7b8412cb0bd1328d67c261` |

A versão `20260831142929` não deve ser substituída no diretório ativo pelo SQL remoto nem reaplicada. O marcador local mantém a equivalência de versão sem provocar duplicação de funções, políticas, gatilhos ou registros de auditoria já existentes no banco.

## Coleta assíncrona v8.7–v9.2.3

O histórico remoto confirmou que as versões abaixo já estão aplicadas em produção. Os cinco arquivos que formam a base assíncrona foram recuperados diretamente do ledger do projeto vinculado e agora permanecem versionados para alinhar o repositório ao ledger e preservar a cadeia usada pelas migrações posteriores:

- `20260831221753`: inbox com lease, claim `SKIP LOCKED`, processamento idempotente, wakeup e cron;
- `20260831223614`: primeiro marcador público do release assíncrono;
- `20260831224808`: sanitização de payload e estado cache-first do dashboard;
- `20260831224837`: KPIs e contenção de concorrência do worker;
- `20260831225000`: marcador fail-closed v8.8.

As versões `20260831225902`, `20260831230439`, `20260831232032` e `20260831234332` consolidam, respectivamente, reconciliação/KPIs pelo ledger canônico, janela de turno em tempo constante, wakeup sem chamadas ociosas com fallback de 15 segundos e o release público v9.2.1.

A versão `20260901025000` acrescenta `get_public_collection_runtime_health()` e alinha o timeout HTTP assíncrono do wakeup a 30 segundos. Esse RPC não lê a fotografia de `app_schema_releases`: a cada chamada ele recalcula a saúde real de funções, privilégios, triggers, RLS, publication, Vault, cron e índices, inclusive validando o timeout de 30 segundos. Os probes legados v8.8/v9.2.1 permanecem inalterados para compatibilidade durante o rollout.

A versão incremental `20260901032000` endurece o mesmo probe para validar as duas policies do inbox por comando, role e expressão efetiva, além de conferir o corpo canônico do verificador do segredo (Vault e digest SHA-256) e seus grants. Ela não redefine o worker nem os wrappers legados.

Esse alinhamento não substitui uma baseline completa do schema: migrações históricas anteriores ainda incluem marcadores de reconciliação. Portanto, a reconstrução integral de um banco vazio deve partir de um schema dump validado, seguido pelo ledger incremental.

## Gate de publicação atual

O workflow de produção só gera o artefato depois de consultar os três marcadores públicos e comprovar simultaneamente:

- `migration_version = 20260831150725`;
- `release_version = 20260831_acprod_collection_fast8_v8_5`;
- `ready = true`;
- os flags `collection_exact_8_digit_scan` e `collection_active_tags_8_digits` em `true`;
- todos os flags anteriores de turnos, lotes, Realtime, Histórico e reposição ainda em `true`.
- `get_public_collection_async_release()`: `migration_version = v8.8`, release assíncrono esperado e todos os flags do inbox/worker em `true`;
- `get_public_collection_runtime_health()`: `migration_version = v9.2.3`, `release_version = 20260901_acprod_collection_runtime_health_security_v9_2_3`, `health_source = runtime_catalog`, `snapshot_used = false`, `ready = true` e todos os flags reais de inbox, policies RLS, verificador do segredo, worker, Realtime, KPIs, índices, turnos, claim, wakeup e fallback em `true`.

Assim, o front-end de captura rápida não pode ser publicado contra um banco antigo, parcialmente migrado ou cuja arquitetura tenha sofrido deriva depois da aplicação das migrações.

## Arquivos retirados do diretório ativo

Os arquivos experimentais `20260831100000` e `20260831120000` permanecem somente em `supabase/migrations_archive/` para auditoria forense e não participam da sequência ativa de implantação.

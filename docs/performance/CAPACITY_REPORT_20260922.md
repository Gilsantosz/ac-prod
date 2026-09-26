# AC.Prod2 — retomada de capacidade em 22/09/2026

**Decisão: NO-GO / NÃO COMPROVADO. A tarefa de homologação completa permanece aberta.**

## Origem e arquitetura verificadas

Base preservada: `5ea4d8c33a7172dd24f0cf9adadfe570c7130aae`. Continuação em `test/capacity-real-20260922`.
A PR #91 corresponde à continuação publicada do trabalho ISA-95/isolamento da coleta; a PR #88 contém o trabalho anterior do k6. Nenhuma dessas branches antigas foi mesclada sobre as correções posteriores de `main`.

O caminho real encontrado é React/PWA, fila local durável, `ingest_collection_batch_immediate_v3`, decisão/transação PostgreSQL, outbox/PGMQ para projeções e Realtime. Os serviços ISA-95 em `services/` não são usados como substituto para esse caminho. `/health`, compilação e mocks não comprovam capacidade.

## Execução comprovada

O GitHub Actions executou o commit `cea2a7bca2591b483a3de1a29829334fe681a03f` no run `35753945125`, job `106834867593`, em 22/09/2026 às 16:24–16:26 UTC. Instalação, auditoria de contratos, lint, typecheck, **953 testes unitários em 152 arquivos** e build passaram. São regressões de código; não são carga industrial.

Artefato da origem: `10707157733`, SHA-256 `f95d0a06e8424be9b2e49584071d19fe2518c854cb27fcaea7df302dc0d4c020`. O runner verificou apenas a presença das variáveis, sem exportar valores: `CAPACITY_TEST_ANON_KEY=false`, `CAPACITY_TEST_SERVICE_ROLE_KEY=false`, `SUPABASE_ACCESS_TOKEN=false`. Isso não afirma que todas as demais credenciais possíveis foram investigadas.

O novo plano gera deterministicamente 200 slots de clientes, 100 postos, nominal de 2.000/min por 900 s, soak de 3.600 s e degraus de 2.000–6.000/min. Slots gerados não equivalem a usuários autenticados. O perfil antigo em `tests/load/collection-fabric-v3.js` continua preservado; ele usa nominal de 1.800/min por 600 s. A integração do novo plano ao executor completo ainda não foi concluída.

## Alterações efetivamente aplicadas no banco de homologação

Alvo exclusivo: `smnsihksrhzbkhcbdjfu` / `capacity-test`. Produção `uozuzdfvnufsjsonswag` não recebeu carga nem alteração nesta retomada.

| Migração aplicada | Resultado verificado |
| --- | --- |
| 20260922163308 — capacity_stage_sync_trigger_parity_20260922 | Backup de duas funções e alinhamento do guard de importação do trigger; hash intermediário `06ebbec1fcd7fef010449b94dc859801` |
| 20260922163414 — collection_immediate_decision | Caminho imediato canônico instalado, preservando autenticação, recibos e outbox |
| 20260922163435 — collection_immediate_worker_reuse | Worker reutilizado por backend; hash final da RPC `90ffa0ee5c0f4b6b82c3a92a7d056bcf` |
| 20260922165032 — capacity_real_private_fixture_v1 | Helpers privados instalados; primeira execução da massa falhou e foi revertida |

A tentativa `private.capacity_real_seed_v1(200)` encontrou **SQLSTATE 42702: `login_name` ambíguo**, entre variável local e coluna. Isso é um defeito no gerador desta rodada, não um gargalo de produção. A aplicação da correção foi bloqueada pelo controle de segurança da ferramenta; ela não foi executada por outra rota.

Verificação posterior no banco: **0 runs, 0 máquinas, 0 operadores e 0 peças com o prefixo desta rodada**. O total anterior de `auth.users` permaneceu em 2. Portanto, a massa de 20.000 peças NÃO foi criada. A transação falhou sem deixar massa parcial. Os helpers privados não são executáveis por `anon` nem `authenticated`.

O erro precisa ser corrigido em uma migração revisada, renomeando a variável PL/pgSQL para `v_login_name` sem renomear a coluna `operators.login_name`. Depois é necessário executar o mesmo seed duas vezes, conferir a invariância das contagens e validar cleanup por manifesto. **Cleanup do novo cenário ainda não foi implementado e homologado.** O cleanup antigo não pode ser declarado compatível com recibos/outbox V3 sem testar suas referências.

## BEFORE / AFTER — sem inventar ganho de latência

| Evidência | Antes | Depois | Limite da conclusão |
| --- | --- | --- | --- |
| RPC imediata no staging | Ausente | Instalada, hash confirmado | Estrutura corrigida; latência não medida |
| Identidade do worker imediato | Versão inicial usa ID por chamada | Reutilização por backend aplicada | Sem medição de crescimento sob carga |
| Gerador | Não havia cenário novo desta rodada | Função instalada, execução 42702 com rollback | Não aprovado; nenhuma massa gerada |
| Critérios do novo plano | Perfil antigo 1.800/min, 10 min | Plano novo 2.000/min, 15 min; soak 60 min | Configuração testada, executor não homologado |

## Bloqueios ainda abertos

Os gates `get_public_collection_runtime_health()` e `get_public_collection_immediate_release()` continuam ausentes no banco consultado. Não foram criados retornos falsos de prontidão nem desativados gates para iniciar a carga.

O provisionamento de 200 identidades reais depende do acesso autenticado apropriado do executor ao staging; não deve usar identidade compartilhada, credenciais no código, JWT fabricado ou chave de produção. Uma proposta de endpoint privilegiado de bootstrap foi bloqueada e descartada, sem implantação.

O plano representa cada posto físico por um `machine_id` distinto e etapas por células lógicas canônicas. Ainda não há prova de isolamento de setor nem de várias máquinas dentro de uma mesma célula física. Não inferir isso de 200 IDs sintéticos.

A integração Cloudflare não foi disponibilizada pela busca de plugins desta conversa. Não houve publicação, configuração de conta ou medição de latência Cloudflare.

## SLOs e conclusão

Nenhum cenário A–K foi homologado nesta rodada. ACK p95/p99, processamento p99, Realtime p95, perdas, duplicação, logouts, deadlocks sob carga, CPU, memória e conexões permanecem **não medidos**. Não usar zero para representar essas ausências.

`gate.mjs` devolve FAIL para métricas ausentes, taxa de erro igual a 0,1%, reconciliação incompleta, duração insuficiente e cenários faltantes. Os testes dessa função são apenas testes unitários do avaliador. Os 18 testes locais de plano/avaliador passaram nesta rodada.

A rotina CI desta branch instala o k6, valida o plano e faz uma consulta **não mutante** de prontidão ao gate público. Mesmo um gate saudável não produz PASS de capacidade. Nenhum script desta branch aplica automaticamente SQL no staging ou em produção.

## Segurança e recuperação

O backup é `private.capacity_20260922_definition_backup`. O rollback proposto está em `supabase/staging/capacity-real-20260922/rollback-immediate.sql`; não foi executado. Ele exige fingerprints conhecidos, runners parados e filas drenadas, não usa CASCADE nem apaga o histórico de migrações. Deve ser revisado e ensaiado antes de uso.

O advisor de segurança retornou avisos sobre funções SECURITY DEFINER expostas e tabelas com RLS sem policies. Isso não prova exploração: é necessário revisar os guards internos. Os helpers novos foram verificados como privados. Não houve abertura de policies para permitir o teste.

O `npm ci` do baseline também reportou seis vulnerabilidades (1 baixa, 4 moderadas e 1 alta); a investigação detalhada de dependências não foi concluída nesta rodada. Não houve `npm audit fix --force`.

**Não promover esta branch como homologação concluída.**

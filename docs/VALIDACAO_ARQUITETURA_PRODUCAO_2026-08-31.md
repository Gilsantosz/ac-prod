# Validação da arquitetura de coleta em produção — 2026-08-31

## Resultado

A arquitetura assíncrona está operante no projeto de produção `uozuzdfvnufsjsonswag` e o GitHub Pages publicado antes deste hardening servia exatamente o commit `c3b42fd4bb01543a469ade5bbaf1de5af9a4d9e7`.

Foram confirmados ao vivo:

- `get_public_collection_release()`: v8.5, `ready = true`;
- `get_public_collection_async_release()`: v8.8, `ready = true`;
- `get_public_collection_sync_release()`: v9.2.1, `ready = true`;
- Edge Function `process-collection-inbox`: ativa, versão 3, com código igual ao `origin/main`;
- cron `run-process-collection-inbox`: ativo a cada 15 segundos;
- backlog no instante da auditoria: zero itens recebidos, zero leases ativos ou expirados e zero retries aguardando;
- índice canônico de claim do worker em uso real.

O deploy de referência foi o run `33452247987`. Contrato, lint, tipos, testes, segurança, build, verificação do Supabase e publicação concluíram com sucesso.

## Evidência operacional agregada

No instante da consulta havia 121 itens sincronizados e 14 erros terminais. Os 14 erros estavam concentrados em uma rajada e associados a sessão de operador (`SQLSTATE 42501`); não havia item preso nem marcado para retry.

Na amostra recente com métrica de fila, cinco sucessos apresentaram `queue_delay_ms` médio de 32.262 ms, p95 de 71.029 ms e máximo de 78.037 ms; o processamento médio foi 5.814 ms. A fila estava totalmente drenada, mas essa amostra pequena indica que latência do wakeup/worker deve continuar sendo observada antes de afirmar SLA de grande escala.

No burst observado, 19 linhas entraram em cerca de 49 ms e o primeiro worker começou aproximadamente 0,6 s depois. Portanto, o trigger/wakeup não foi a origem da espera. Dez chamadas `pg_net` apareceram como `timed_out` com limite de 2 s, embora as mesmas invocações tenham terminado HTTP 200 entre 8,7 e 15,7 s. Dos 19 eventos, 17 passaram por retry, totalizando 108 claims. Os sucessos terminaram em cerca de 6,5 s na primeira tentativa e chegaram a 78 s na quarta.

A causa mais provável é contenção próxima dos limites de `statement_timeout` e `lock_timeout` de 8 s durante a atualização serializada por lote. Essa associação é uma inferência forte pela distribuição dos tempos, não uma prova definitiva, pois o SQLSTATE transitório de cada tentativa ainda não é preservado.

O cron registrou 239 execuções bem-sucedidas na hora consultada e nenhuma falha. Nenhum payload produtivo, identificação de operador ou segredo foi coletado para este relatório.

## Lacunas encontradas e corrigidas neste hardening

1. Cinco migrações já aplicadas no ledger remoto não estavam no `origin/main`. Os SQLs canônicos foram recuperados do histórico do projeto e versionados para alinhar a cadeia incremental v8.7–v8.8. Isso não equivale a uma baseline completa para recriar o banco do zero.
2. O gate do deploy validava v8.5 e v8.8, mas não exigia o release consolidado v9.2.1 e o marcador v8.8 podia refletir uma fotografia antiga. O workflow agora também consulta o probe dinâmico v9.2.3, que recompõe permissões, definições, policies RLS efetivas, verificador criptográfico do segredo, triggers, publicação Realtime, Vault, cron e índices a cada execução.
3. Cada sessão abria dois canais Realtime globais, e o Resumo Diário abria um terceiro. A assinatura passou a ter um único proprietário em `AuthenticatedApp`.
4. Eventos sincronizados nunca eram removidos do IndexedDB e a recuperação de itens antigos fazia varreduras redundantes. A manutenção agora ocorre fora do caminho crítico, percorre o banco v2 existente com cursor e checkpoint em fatias limitadas, tem cooldown e preserva todo evento pendente, em processamento ou com erro. Assim, o rollout não exige upgrade do IndexedDB nem pode ficar bloqueado por uma aba antiga.
5. O cliente desistia de aguardar a finalização em 25 s, abaixo do p95 observado, provocando reenvios idempotentes e consultas de recuperação. O limite passou a 90 s, com polling progressivo, teto de 5 s e jitter determinístico por lote para não sincronizar a carga entre máquinas. O timeout HTTP assíncrono do `pg_net` passou de 2 s para 30 s para eliminar falsos negativos de telemetria; concorrência, rounds, lease e timeout SQL foram preservados até existir teste de carga representativo.

## Limites desta validação

O teste existente de 2.000 usuários virtuais cobre leitura de snapshot, não o ciclo completo autenticado de escrita, worker, Realtime e dashboards. A arquitetura e o estado atual foram verificados, mas um SLA formal para 2.000 operadores exige teste de carga em staging com o mesmo plano/compute de produção e observação de latência, conexões, CPU, I/O e backlog.

O repositório conserva marcadores históricos de reconciliação anteriores à cadeia assíncrona. Esta validação confirma o upgrade incremental e o runtime produtivo; não confirma um reset completo a partir de banco vazio sem uma baseline de schema dedicada.

## Critérios do rollout deste hardening

- auditor estático com a cadeia completa de 52 versões obrigatórias;
- lint, typecheck, testes unitários, segurança e build sem falhas;
- os probes legados e o probe dinâmico v9.2.3 em `ready = true` antes de gerar o artefato;
- publicação somente depois do gate dinâmico v9.2.3;
- confirmação pós-deploy do `build-info.json`, do workflow e dos probes públicos.

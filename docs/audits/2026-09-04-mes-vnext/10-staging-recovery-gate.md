# Gate de recuperação da branch Supabase de staging

Data: 2026-09-04
Escopo autorizado: recuperação/reset controlado da branch Supabase de staging
existente; nenhuma autorização para reset, rebase, merge ou carga em produção.
Decisão do preflight: **HOLD — reset destrutivo ainda não executado**.

## 1. Alvo resolvido antes de qualquer mutação

| Campo | Valor confirmado |
|---|---|
| Nome | `capacity-test` |
| Branch ID | `cf279f17-5cdd-4ec5-b0e4-467f87215ed9` |
| Project ref | `smnsihksrhzbkhcbdjfu` |
| Parent project ref | `uozuzdfvnufsjsonswag` |
| Default | `false` |
| Persistent | `true` |
| With production data | `false` |
| Branch status | `MIGRATIONS_FAILED` |
| Preview database | `ACTIVE_HEALTHY` |

Qualquer operação futura deverá usar o Branch ID explícito. O project ref do
parent não é um alvo permitido.

## 2. Evidência preservada

Antes do reset foram capturados, sem DDL/DML:

- manifesto sanitizado do runtime, migrations, catálogo, extensões,
  publicações, Edge Functions e evidência de capacidade;
- os 10 runs, todas as 498 amostras métricas, 11 erros, 14 comandos e 599
  estados de agentes em uma exportação sanitizada de auditoria;
- agregados e hashes determinísticos das 43.800 entidades sintéticas;
- contagem e hash de projeção sanitizada dos 100.357 registros de auditoria;
- conteúdo literal da única migration exclusiva da branch.

Artefatos:

- [`staging-pre-reset-manifest.json`](staging-pre-reset-manifest.json), SHA-256
  `e7c2546448431e6bbd4f72abcdbb7ccf473ec2be3e69ef7a8b05b2b9c02c4a25`;
- [`staging-capacity-evidence-sanitized.json`](staging-capacity-evidence-sanitized.json),
  SHA-256 `8d6a0c60f9256d0d8408c27feae339e74a9d3f87e8b7acb1de5a6f18a604f0f5`;
- [`staging-branch-only-migration.sql.txt`](staging-branch-only-migration.sql.txt),
  SHA-256 `abb58138c91a8b5b2ac1bab0a2a20eeb09f8d317795394103416d5af1bb13d6b`.

A exportação exclui e-mail, matrícula, IP, JWT, refresh token, service-role,
segredos, identificadores de pessoa/sessão/máquina, payloads e logs brutos. Ela
é restaurável como evidência sanitizada de auditoria, mas não é um backup físico
completo do banco nem permite restaurar os campos deliberadamente excluídos.

### Limitação de backup confirmada

As credenciais atualmente disponíveis no repositório são apenas as duas chaves
públicas do frontend. Não há `SUPABASE_DB_URL`, senha de banco ou secret
equivalente para executar `pg_dump`. A superfície Supabase disponível nesta
auditoria também não expõe criação/listagem/undo de Restore Points. Restore de
branch apenas cancela exclusão agendada; não desfaz um reset.

Assim, o gate de backup integral só pode ser liberado por uma destas vias:

- fornecer uma credencial exclusiva da branch para gerar dumps separados de
  roles/schema/data e validar o restore; ou
- confirmar com a Supabase a habilitação de Restore Points para o projeto e
  validar create/undo antes do reset.

## 3. Por que o reset foi interrompido no preflight

O reset oficial descarta os dados existentes e reaplica as migrations em ordem.
No estado atual, isso não é uma recuperação previsível:

1. staging possui 5 versões no ledger; produção possui 154;
2. há somente 4 versões em comum, 150 somente em produção e 1 somente no
   staging;
3. a `main` contém 167 arquivos para apenas 164 versões únicas;
4. existem versões duplicadas (`040`, `041` e `20260726180000`);
5. existem migrations de alinhamento que contêm apenas `SELECT 1` e não
   reconstroem o DDL do runtime;
6. a cadeia fria possui SQL PL/pgSQL inválido em
   `033_mes_alert_lifecycle.sql` e `036_customer_cover_multi_lot.sql`;
7. `014_production_context_master.sql` pressupõe relações que as migrations
   anteriores não criam;
8. migrations posteriores contêm URLs fixas do parent produtivo em cron,
   Vault e health checks. Reexecutá-las numa branch pode originar tráfego
   cross-environment;
9. o staging contém objetos de capacity test aplicados fora do ledger; o reset
   os apagaria sem possuir uma migration canônica capaz de recriá-los;
10. os logs da falha original já expiraram, portanto não existe evidência que
    justifique pular uma versão com `migration repair`;
11. não existe ref remota `capacity-test` ou `codex/capacity-test`, não houve PR
    dessa branch e o metadata disponível no Supabase não informa `git_branch`,
    repositório ou commit. A branch local homônima aponta seu upstream para
    `origin/main` e não comprova a origem do replay remoto.

Executar reset agora teria resultado esperado `MIGRATIONS_FAILED` ou, pior,
efeito externo para produção. Uma falha destrutiva conhecida não satisfaz a
autorização de recuperação.

## 4. Barreira local já aplicada

O estado local do Supabase CLI estava versionado e apontava para o parent
produtivo. Esta branch de trabalho passa a ignorar `supabase/.temp/` e remove os
três arquivos temporários rastreados. Nenhum fluxo de recuperação poderá usar
`--linked`; banco e branch devem ser informados explicitamente.

## 5. Plano liberado pelo gate

1. congelar e commitar os artefatos pré-reset;
2. obter um backup físico/restaurável restrito do staging e executar restore
   drill para preservar os campos brutos fora do repositório;
3. criar uma lineage Git exclusiva de staging com baseline literal do runtime,
   seed somente sintético e incrementos vNext;
4. neutralizar cron, Vault, worker wakeups e health probes por padrão; nenhum
   endpoint deve apontar para o parent;
5. validar cold replay em PostgreSQL 17 e migrations com versões únicas;
6. associar explicitamente a branch Supabase à lineage/commit validado;
7. confirmar runners parados, sem `idle in transaction`, sem locks aguardando,
   flags desligadas e emergency-stop funcional;
8. executar reset usando somente o Branch ID
   `cf279f17-5cdd-4ec5-b0e4-467f87215ed9`;
9. registrar o workflow run e capturar logs, SQLSTATE, versão e statement em
   qualquer falha;
10. repetir o reset uma segunda vez e exigir o mesmo checksum de catálogo e
    ledger;
11. revalidar RLS/grants, extensões, Functions, isolamento, flags e ausência de
    URLs produtivas;
12. somente então executar smoke funcional; carga permanece bloqueada pelos
    gates gerais da auditoria.

## 6. Rollback e critérios de parada

- Não usar `rebase_branch`, `merge_branch`, `migration repair --status applied`
  ou `db reset --linked` para contornar o erro.
- Não excluir/recriar a branch sem autorização adicional explícita.
- Se qualquer etapa referenciar o parent, perder a associação com o commit
  validado ou falhar no replay, parar, preservar o workflow e manter NO-GO.
- O reset nunca autoriza flags v3/v4, carga, canário ou merge.
- Fatos que já existam em produção permanecem intactos e não entram no plano de
  rollback do staging.

## 7. Base oficial usada

- [GitHub integration e origem das migrations](https://supabase.com/docs/guides/deployment/branching/github-integration)
- [Working with branches e semântica destrutiva do reset](https://supabase.com/docs/guides/deployment/branching/working-with-branches)
- [Troubleshooting de branches](https://supabase.com/docs/guides/deployment/branching/troubleshooting)
- [Management API: reset de branch](https://supabase.com/docs/reference/api/v1-reset-a-branch)
- [Database migrations e repair](https://supabase.com/docs/guides/deployment/database-migrations)
- [Backup lógico em CI](https://supabase.com/docs/guides/deployment/ci/backups)
- [Restore Points](https://supabase.com/docs/guides/integrations/supabase-for-platforms)
- [Restore de branch não substitui backup](https://supabase.com/docs/reference/api/v1-restore-a-branch)

## 8. Estado deste checkpoint

- revalidação read-only às `2026-09-04T20:22:39.754471Z`: produção ainda com
  154 migrations, última versão `20260903165317`, e as quatro flags v3 em
  `false`; não há flag v4 no conjunto retornado;
- metadata do staging revalidado no mesmo fechamento: `MIGRATIONS_FAILED`,
  preview database `ACTIVE_HEALTHY`, mesmo Branch ID/ref/parent;
- produção: **não alterada**;
- staging: **não alterado**;
- reset: **não executado**;
- rebase/merge: **não executados**;
- flags: **não alteradas**;
- teste de carga: **não executado**;
- decisão: **NO-GO/HOLD até baseline reprodutível e backup restaurável**.

Contagens de tabelas operacionais continuam sujeitas a escrita legítima
concorrente e não são usadas para atribuir ausência de mutação ao processo de
auditoria. A afirmação acima refere-se às operações realizadas por esta
recuperação: somente leituras foram enviadas aos dois bancos.

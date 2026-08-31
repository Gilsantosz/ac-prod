## Objetivo

Finalizar o rollout de concorrência, ciclo de lote por célula, turnos, Realtime e correção do Histórico do AC.Prod2 sem reintroduzir as regressões das migrações experimentais.

## Alterações

- remove do diretório ativo as migrações inseguras `20260831100000` e `20260831120000`;
- alinha o ledger local com as versões aplicadas no Supabase;
- adiciona contrato SQL fail-closed e marcador público não sensível do release v7;
- impede a publicação do Pages quando o banco não comprova o release esperado;
- mantém `type="button"` nas ações do Histórico e suspende o foco automático do scanner durante modais;
- adiciona testes estáticos e SQL de integridade.

## Evidências

Consulte `docs/VALIDACAO_COLLECTION_ROLLOUT_2026-08-31.md`.

## Rollback

O banco utiliza migrações aditivas e compatíveis; o rollback do front é feito retornando ao SHA anterior. Não remover colunas/tabelas do release v7 durante rollback do front, pois versões anteriores continuam compatíveis.

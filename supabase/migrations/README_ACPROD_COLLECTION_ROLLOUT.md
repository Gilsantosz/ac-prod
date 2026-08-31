# AC.Prod2 — alinhamento do rollout de coleta de 31/08/2026

As versões `20260831041525` a `20260831051513` foram aplicadas pelo canal controlado do Supabase durante a correção emergencial e já constam no ledger de produção. Os arquivos locais correspondentes são marcadores `SELECT 1` para alinhar o histórico do CLI; eles **não simulam** uma aplicação ainda pendente.

As versões finais contêm comportamento executável e idempotente:

- `20260831052152`: compatibilidade do Histórico para clientes em cache;
- `20260831052721`: contrato fail-closed de concorrência, lotes, turnos e Realtime;
- `20260831052809`: marcador público mínimo usado pelo GitHub Actions.

O workflow não publica o front-end apenas porque o build passou. Antes de criar o artefato, consulta `get_public_collection_release()` e exige simultaneamente:

- `migration_version = 20260831052809`;
- `release_version = 20260831_acprod_collection_db_v7`;
- todos os `schema_flags` obrigatórios em `true`.

Os arquivos experimentais `20260831100000` e `20260831120000` foram retirados do diretório ativo e mantidos apenas em `supabase/migrations_archive/` para auditoria forense.

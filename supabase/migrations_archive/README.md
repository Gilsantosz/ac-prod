# Migrações substituídas — não aplicar

Os arquivos `20260831100000` e `20260831120000` foram removidos do diretório ativo porque continham regressões de rota, sessão e reconciliação. Eles permanecem neste diretório apenas para auditoria forense e **não devem ser executados**.

O estado canônico é comprovado pelas versões `20260831041525` até `20260831052809` e pelo endpoint somente leitura `get_public_collection_release()`.

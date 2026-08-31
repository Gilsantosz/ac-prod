# Validação técnica — reconciliação da reposição AC.Prod2 v8.3

## Motivo da reconciliação

Depois da publicação do v8.2, a migração concorrente `20260831142929_replacement_roles_flow_and_audit_v1` acrescentou um ledger dedicado de auditoria. A verificação pós-deploy detectou que ela também:

- ampliou a autorização para permissões avulsas, além da hierarquia solicitada;
- voltou a classificar a peça substituta como `rework`;
- classificou as etapas forçadas como baixas normais de reposição;
- gravou a auditoria apenas na tabela nova, enquanto o Histórico existente consulta `system_audit_logs`.

A migração `20260831143323_reconcile_replacement_workflow_v8_3` preserva o ledger novo e corrige essas divergências.

## Contrato final

- aprovação e conclusão forçada restritas aos papéis Qualidade, Supervisor/Líder, Gestor e Administrador;
- permissões avulsas não substituem a hierarquia para decisões de reposição;
- aprovação continua sem senha, justificativa, células automáticas ou fatos produtivos;
- peça substituta criada com `source_origin = replacement` e `is_rework = false`;
- conclusão forçada continua sem senha e com justificativa obrigatória;
- etapas forçadas registradas como `manual_adjustment` / `conclusao_forcada_reposicao`;
- ledger dedicado `replacement_action_audit_logs` preservado;
- trigger espelha cada decisão no `system_audit_logs`, mantendo o Histórico já usado pelo front;
- registros já existentes no ledger dedicado foram retroalimentados no Histórico sem duplicação.

## Release do Supabase

```text
migration_version = 20260831143323
release_version = 20260831_acprod_replacement_v8_3
ready = true
```

Indicadores obrigatórios validados:

- `replacement_strict_role_hierarchy = true`;
- `replacement_station_only_approval = true`;
- `replacement_origin_classification = true`;
- `replacement_force_justification_only = true`;
- `replacement_force_adjustment_facts = true`;
- `replacement_audit_mirror = true`;
- `replacement_station_queue = true`;
- `replacement_canonical_lot_close = true`.

## Integridade pós-migração

A reconciliação é aditiva e não destrutiva. Não removeu ordens, peças, leituras ou históricos. O gate de publicação do GitHub foi atualizado para impedir novos deploys quando o Supabase não comprovar exatamente o release v8.3.

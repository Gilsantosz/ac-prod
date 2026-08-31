# Validação técnica final — fluxo de reposição AC.Prod2 v8.4

## Release final do Supabase

```text
Projeto: uozuzdfvnufsjsonswag
Migração: 20260831143850_fix_force_completion_conflict_v8_4
Release: 20260831_acprod_replacement_v8_4
ready: true
```

Todos os indicadores obrigatórios do marcador público retornaram `true`:

- campos de turno;
- lifecycle e contexto ativo por célula;
- coleta transacional v2;
- compatibilidade do Histórico;
- papel Qualidade;
- RBAC de reposição;
- hierarquia estrita por papel;
- aprovação exclusiva para a fila do posto;
- classificação da substituta como `replacement`;
- conclusão forçada apenas com justificativa;
- leituras forçadas classificadas como ajuste;
- tratamento de conflito compatível com índice parcial;
- espelhamento da auditoria no Histórico;
- fila do posto de reposição;
- fechamento canônico do lote.

## Por que o v8.4 foi necessário

Um teste transacional completo detectou que a conclusão forçada usava:

```sql
ON CONFLICT (client_event_id) DO NOTHING
```

O índice único de `client_event_id` é parcial. O PostgreSQL não consegue inferir um índice parcial usando somente esse alvo de conflito, retornando `42P10` antes da conclusão.

O v8.4 substituiu a instrução por:

```sql
ON CONFLICT DO NOTHING
```

O marcador de release agora falha quando a definição antiga reaparece.

## Teste transacional completo com rollback

Foi criada uma ordem sintética com uma peça original reprovada e rota:

```text
Corte → Borda
```

O teste utilizou as RPCs reais de produção e foi encerrado com `ROLLBACK`.

### Aprovação

Resultado:

- `success = true`;
- status da ordem retornado: `released`;
- próxima etapa: `cut`;
- destino: célula Corte;
- `automatic_entries = 0`;
- `approved_cells = []`;
- peça substituta criada com `source_origin = replacement`;
- `is_rework = false`;
- material, cor, espessura e dimensões preservados;
- nenhuma entrada produtiva artificial criada;
- auditoria dedicada `approved_for_production` criada;
- espelho `replacement_approved_for_station` criado no Histórico.

### Conclusão forçada

Justificativa utilizada:

```text
Conclusão excepcional validada no teste v8.4 com rollback.
```

Resultado:

- `success = true`;
- ordem marcada como `completed`;
- justificativa preservada no retorno, na ordem e na auditoria;
- peça original marcada como `replaced`;
- peça substituta marcada como `completed` e `replaced`;
- duas leituras criadas para documentar Corte e Borda;
- `event_type = manual_adjustment`;
- `entry_type = conclusao_forcada_reposicao`;
- entradas produtivas artificiais: `0`;
- auditoria dedicada `force_completed` criada;
- espelho `replacement_force_completed` criado no Histórico.

Contagens do cenário:

```text
production_entries = 0
adjustment_readings = 2
dedicated_audits = 2
history_mirrors = 2
```

## Testes negativos

Também foram validados:

- justificativa vazia: bloqueada;
- Operador tentando concluir forçadamente: bloqueado com SQLSTATE `42501`;
- Operador:
  - `can_manage = false`;
  - `can_approve = false`;
  - `can_force = false`.

## Integridade final

```text
duplicate_approved_groups = 0
lot_lifecycle_drift = 0
stale_processing_events = 0
expired_open_sessions = 0
```

Após todos os testes:

```text
ordens sintéticas = 0
lotes sintéticos = 0
peças sintéticas = 0
reposições sintéticas = 0
leituras sintéticas = 0
auditorias sintéticas dedicadas = 0
espelhos sintéticos no Histórico = 0
```

O perfil administrativo utilizado para a simulação de papéis permaneceu:

```text
role = admin
active = true
```

## Gate de publicação

O GitHub Actions somente pode publicar quando o Supabase comprovar exatamente:

```text
migration_version = 20260831143850
release_version = 20260831_acprod_replacement_v8_4
ready = true
```

O workflow também exige todos os indicadores do contrato v8.4 em `true`.

# Validação técnica — fluxo de reposição AC.Prod2 v8.2

## Escopo implantado

- novo papel de sistema `quality_manager`, exibido como **Qualidade**;
- autoridade de decisão para Qualidade, Supervisor/Líder, Gestor e Administrador;
- aprovação direta, sem senha, justificativa ou seleção de células;
- aprovação sem criação de entradas, leituras ou eventos produtivos artificiais;
- peça substituta liberada na primeira etapa real da rota e exibida no Posto de Reposição da célula correspondente;
- conclusão forçada sem senha adicional e com justificativa obrigatória;
- auditoria da aprovação e da conclusão forçada;
- melhoria visual do Posto de Reposição por Célula, com destaque para dimensões, material/cor e espessura;
- fechamento canônico do lote com `status = closed`, `closed_at` e `actual_end` quando todas as condições forem atendidas.

## Release do Supabase

Projeto: `uozuzdfvnufsjsonswag`

- migração: `20260831135630_finalize_replacement_workflow_v8_2`;
- release: `20260831_acprod_replacement_v8_2`;
- marcador público: `get_public_collection_release()`;
- resultado do marcador: `ready = true`;
- todos os indicadores obrigatórios do schema e do runtime retornaram `true`.

## Edge Function de usuários

A função `admin-users` foi publicada na versão 10 com:

- suporte ao papel `quality_manager`;
- compatibilidade com os aliases legados `quality`, `leader` e `user`;
- posição hierárquica de Qualidade entre Supervisor/Líder e Gestor;
- validação de escalonamento de permissões;
- resolução canônica de células por ID ou nome;
- preservação das configurações de recebimento de relatórios;
- recuperação segura de conta já existente no Supabase Auth;
- `verify_jwt = true`.

Assinatura publicada:

```text
version = 10
status = ACTIVE
sha256 = 6a37ed0e23e23d325b7f1009526f8a2956ba173e5c14bd00cc55b645db919b86
```

## Teste de papéis com rollback

O perfil administrativo foi alterado temporariamente dentro de uma transação e restaurado por `ROLLBACK`.

| Papel | Aprovar reposição | Concluir forçada |
|---|---:|---:|
| Qualidade | permitido | permitido |
| Supervisor/Líder | permitido | permitido |
| Gestor | permitido | permitido |
| Administrador | permitido | permitido |
| Operador | bloqueado | bloqueado |

Todos os critérios retornaram `true`. O perfil real permaneceu como Administrador após o rollback.

## Teste transacional de aprovação

Foi criada uma ordem sintética com uma peça reprovada e rota `Corte → Borda`, executada pela RPC real `approve_piece_replacement`.

Resultado:

- ordem alterada para `released`;
- peça substituta criada com `source_origin = replacement`;
- etapa atual da substituta: `cut`;
- `completed_steps = []`;
- material, cor, espessura e dimensões preservados;
- `approval_entry_count = 0`;
- `approved_cells = []`;
- entradas produtivas criadas durante aprovação: `0`;
- leituras produtivas criadas durante aprovação: `0`;
- eventos de coleta criados durante aprovação: `0`;
- auditoria `replacement_approved_for_station`: `1`;
- modo de aprovação: `station_queue`.

A transação foi encerrada com `ROLLBACK`.

## Teste transacional de conclusão forçada

Na mesma estrutura sintética, a conclusão forçada foi executada com justificativa textual.

Resultado:

- ordem concluída;
- justificativa retornada e registrada no log;
- peça substituta concluída e marcada como reposição efetivada;
- peça original marcada como substituída;
- duas leituras `manual_adjustment` criadas para documentar as duas etapas forçadas;
- entradas produtivas artificiais criadas: `0`;
- auditoria `replacement_force_completed`: `1`;
- senha adicional: inexistente no contrato da RPC e no modal.

A transação foi encerrada com `ROLLBACK`.

## Verificação de resíduos

Após os testes:

- ordens sintéticas restantes: `0`;
- lotes sintéticos restantes: `0`;
- peças sintéticas restantes: `0`;
- reposições sintéticas restantes: `0`;
- leituras sintéticas restantes: `0`;
- logs sintéticos restantes: `0`.

## Contrato de implantação

O GitHub Actions exige simultaneamente:

- `migration_version = 20260831135630`;
- `release_version = 20260831_acprod_replacement_v8_2`;
- papéis de reposição ativos;
- aprovação sem baixa automática;
- conclusão forçada apenas com justificativa;
- fila de reposição por célula disponível;
- fechamento canônico do lote;
- compatibilidade das melhorias anteriores de coleta e Histórico.

Se qualquer condição falhar, o front-end não é publicado.

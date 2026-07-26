---
description: Corrigir e validar consistência entre reprovação na coleta, estado canônico da peça e ordem de reposição.
---

# Fluxo: Consistência de Reprovação e Reposição

Use este fluxo sempre que uma peça aparecer com estados divergentes entre Coleta/Bipagem, Rastreabilidade, Qualidade e Reposição.

## Objetivo

Garantir que, após uma reprovação, todas as telas e relatórios exibam imediatamente a peça como reprovada e que a ordem de reposição preserve o código real de rastreio, lote, pedido, cliente, ambiente e etapa da reprovação.

## Invariantes obrigatórios

1. `production_pieces.status` é a fonte canônica do estado atual da peça.
2. Um evento de coleta aprovado pode permanecer no histórico como evento original, mas a interface deve exibir separadamente:
   - estado do evento/leitura; e
   - estado atual da peça.
3. A lista e o painel de detalhes nunca podem sobrescrever o estado canônico atual com um snapshot antigo do evento.
4. Nunca fabricar código de rastreio a partir de `replacement_code`, data, sequência ou ID da ordem.
5. Os dados da reposição devem ser resolvidos nesta ordem:
   - peça original;
   - lote vinculado à peça;
   - ordem de produção vinculada à peça ou ao lote;
   - última leitura/evento aprovado da peça;
   - snapshots existentes apenas como fallback.
6. A reprovação deve usar uma chave idempotente estável (`client_event_id`) preservada em novas tentativas da mesma ação.
7. A mesma peça não pode gerar mais de uma reposição ativa para o mesmo fluxo.
8. A leitura de reprovação deve ter `status = rejected` e `event_type = rejected_scan`.
9. A aprovação produtiva anterior deve ser marcada como `pending_review` e a entrada produtiva vinculada deve ser estornada/revertida quando houver vínculo confiável.
10. Atualizações em `production_pieces` e `production_stage_readings` devem atualizar a tela em tempo real e invalidar os caches relacionados.

## Diagnóstico

1. Reproduza o erro com um código real.
2. Consulte, pelo mesmo `piece_id`:
   - `production_pieces`;
   - `production_collection_events`;
   - `production_stage_readings`;
   - `production_entries`;
   - `quality_nonconformities`;
   - `replacement_orders`.
3. Compare o estado atual da peça com `result_status` do evento e `status` da leitura.
4. Verifique se o frontend usa snapshots antigos do evento para reconstruir o estado atual.
5. Verifique se os campos de lote/pedido/cliente estão sendo lidos diretamente de colunas nulas da peça em vez das tabelas relacionadas.

## Correção de frontend

1. Ao carregar o histórico, enriquecer cada linha com o estado atual de `production_pieces`.
2. Preservar o status original da leitura em um campo separado, como `reading_status`.
3. Ao selecionar uma peça, mesclar todos os campos canônicos retornados pela consulta de rastreabilidade, não apenas rota e etapas concluídas.
4. Assinar Realtime para:
   - `production_collection_events`;
   - `production_stage_readings`;
   - `production_pieces`.
5. Após a RPC de reprovação:
   - invalidar todas as queries MES relacionadas;
   - recarregar a peça canônica;
   - atualizar lista e painel selecionado;
   - manter o mesmo `client_event_id` caso a tentativa seja repetida.
6. Na página de reposição, exibir somente `piece_uid`, `traceability_code` ou `piece_code` reais. Na ausência deles, mostrar “Rastreio não localizado” e registrar alerta técnico.

## Correção de banco

1. Ajustar a RPC de histórico para calcular o estado exibido com prioridade para o estado canônico da peça.
2. Criar enriquecimento transacional de `replacement_orders` usando peça, lote, ordem, leitura e evento.
3. Garantir `rejected_scan` nas leituras rejeitadas.
4. Vincular a leitura aprovada à `production_entry_id` ou resolver pelo `production_collection_events.production_entry_id`.
5. Estornar somente quando o vínculo for inequívoco; nunca adivinhar uma entrada produtiva.
6. Fazer backfill dos registros históricos incompletos preservando auditoria.
7. Não aplicar migração em produção antes de validar em branch de desenvolvimento ou banco local compatível.

## Cenário de aceitação obrigatório

Usar como regressão o caso:

- rastreio: `09907352`;
- lote: `143352`;
- pedido: `143352`;
- cliente: `PAROQUIA SAO JUDAS TADEU`.

Após reprovar:

1. O card da lista muda imediatamente para **REPROVADA**.
2. O painel direito permanece **REPROVADA** após selecionar outra peça e voltar.
3. Atualizar a página não restaura **APROVADA**.
4. A ordem de reposição mostra rastreio `09907352`, lote `143352`, pedido `143352`, cliente correto e etapa real da reprovação (`cut`/Corte), nunca “Concluída” por snapshot incorreto.
5. Uma repetição da mesma solicitação não cria segunda NC nem segunda reposição ativa.
6. O histórico mantém o evento aprovado original para auditoria, mas informa separadamente que o estado atual da peça é reprovado.

## Validação antes do merge

Executar:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Adicionar testes de integração para as RPCs e teste E2E cobrindo reprovação, troca de seleção, recarga da página e visualização da reposição.

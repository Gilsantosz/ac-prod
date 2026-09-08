# Recuperação e validação da coleta — 8 de setembro de 2026

## Escopo

Sistema publicado AC.Prod, com coletas por sessão operacional, fila local,
ingresso V3 no Supabase, fila de decisão e fila de projeção. O teste local da
API MES com k6 é separado e não comprova a capacidade deste fluxo de coleta.

## Correção da tela publicada

Commit `cd73ba9b8a960e7ae0c26e92394f3509507ec410`.

- A captura aguarda a confirmação da célula e da máquina da sessão atual.
- As solicitações de contexto da mesma sessão são serializadas.
- A confirmação tem limite de 15 segundos, mensagem de erro e nova tentativa.
- Após a confirmação, o posto fica fixo na sessão produtiva. A troca de posto
  exige uma nova sessão operacional, preservando a associação dos reenvios.
- Reabrir a tela recupera o posto confirmado, sem usar preferências antigas
  para sobrescrevê-lo. O fluxo de reposição mantém seu comportamento anterior.

Validação: 51 testes focados e lint aprovados. O workflow completo de publicação
também aprovou testes, tipos, segurança, build e contrato com o banco.
O arquivo público `build-info.json` confirmou o commit publicado.

Workflow: https://github.com/Gilsantosz/ac-prod/actions/runs/34240243382

## Recuperação do banco

O banco ficou indisponível antes da validação pela tela. Após reinício
autorizado, respondeu novamente às 14:41 UTC (11:41 em São Paulo).

A conferência inicial encontrou 182 mensagens na fila de decisão e 34 na fila
de projeção, sem mensagens na fila de erros. Os processadores automáticos
retornavam erro HTTP 500 sem concluir as transações.

A recuperação usa os mesmos processadores canônicos em ciclos seriais de
cinco mensagens, com limite de oito segundos por transação. Não apaga mensagens,
não altera decisões manualmente e não reatribui eventos a operadores.

Resultado: 182 decisões e 216 projeções concluídas; filas de decisão, replay,
projeção, erros e outbox zeradas às 15:03 UTC. Esses totais indicam processamento,
não aprovação de todas as peças. Houve uma pausa preventiva por atividade
transitória, sem falha de processamento nem timeout durante a recuperação.

## Atualização do processamento instalada

Migração `20260908150402_collection_capacity_production_promotion` aplicada
às 15:04 UTC, após confirmar as filas vazias e as 16 definições de origem.
As 20 definições finais, índices, revisão do cache, RLS e permissões passaram
na conferência posterior. Os agendamentos de decisão e projeção foram
reativados com a mesma frequência de 15 segundos.

A atualização reaproveita resumos por lote, agrupa a atualização dos dados
derivados e evita disputas desnecessárias entre processadores. Mantém os
eventos, IDs, históricos, permissões e o contrato de ingresso da coleta.
A instalação e sua reversão foram ensaiadas em PostgreSQL local descartável.
O desempenho sob carga do novo processamento em produção ainda depende
do teste funcional e do ensaio de carga; não foi certificado por esta recuperação.

## Teste por célula

Foi preparado e aberto no simulador um arquivo identificado como teste, com
24 peças sintéticas, quatro lotes e códigos exclusivos. A validação planejada
é conferir cada peça em Corte e Bordo, incluindo recibo, decisão, histórico,
contadores e ausência de aprovação duplicada.

**Pendente:** execução pela tela e conferência dos resultados após o login
principal do sistema. As credenciais operacionais são usadas somente depois
desse acesso. Nenhum teste com 1.000 computadores foi concluído nesta etapa.

# Contagens completas e custo de leitura dos painéis

## Correção

O Kanban solicitava até 5.000 peças, mas o limite da API retornava somente
1.000 linhas. O navegador calculava os totais sobre esse subconjunto. O novo
RPC devolve grupos completos por lote, roteiro, estado e evidências de coleta,
com a contagem exata de cada grupo. A função preserva RLS e SECURITY INVOKER.
O frontend usa os grupos apenas no resumo; detalhes individuais continuam
sendo consultados em suas telas. O fallback de implantação pagina todas as
linhas e não aceita falhas de leitura como totais parciais.

O detalhe de acompanhamento de lotes compartilha as consultas de roteiro e
conclusão. A migração também evita repetir a verificação de escopo para cada
linha, mantendo as políticas de escrita e o resultado das permissões. Funções
alteradas e políticas têm verificações de origem para recusar banco divergente.

## Verificação

- Massa local de 61.031 peças: consulta antiga retornou 1.000; consulta agrupada
  representou todas as 61.031 em 294 grupos.
- 14 comparações do Kanban contra os registros completos, incluindo permissões
  restritas, perfis inativos, aliases, roteiros vazios/nulos e bloqueios.
- Demais ajustes SQL: 387 comparações de escopo produtivo; 44 de progresso e
  10 casos de reposição; 54 de leituras; 60 de políticas de entradas; 54 de
  conclusão; 20 do bundle; 75 de políticas de células; 46 de métricas compartilhadas.
- Reversão/reaplicação local das funções, índices, ACLs e políticas preservou
  o fingerprint 089007d9998d2c5632dbc2a26fd20f00a4a709aa8d5d02499e3e6c52699f87d5.
- Testes locais do produto: 156 arquivos, 976 testes; build aprovado. A CI desta
  branch verifica novamente a integração com a versão pública atual.

## Escopo da publicação

Esta mudança preserva os ajustes recentes do modo foco. Não ativa o gateway
experimental de coleta, não altera o transporte público, não habilita novos
WebSockets e não muda plano ou limite de conexões. O ganho local de uma API
com conexões reservadas não é resultado atribuído a esta publicação.

A homologação global de 2.000 coletas/minuto continua pendente. Correção de
contagem, testes unitários e consultas isoladas não a substituem. O cenário
formal com 200 usuários está sendo medido separadamente no laboratório.

## Reversão

Aplicar supabase/rollbacks/20260926173800_complete_panel_reads.sql somente após
conferir as verificações de origem, e reverter o frontend. O rollback não apaga
peças, coletas ou históricos; remove somente os objetos novos deste pacote e
restaura as definições anteriores.

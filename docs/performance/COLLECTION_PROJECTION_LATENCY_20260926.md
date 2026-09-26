# Coletas: consultas de acesso e atualização de lotes

Durante a validação com 200 sessões, as consultas simultâneas dos painéis disputavam conexões com as gravações. O projetor também percorria repetidamente as mesmas peças ao atualizar o progresso.

Esta alteração agrupa estados equivalentes antes do cálculo por etapa, conta as raízes produtivas uma vez no resumo do lote e reserva a travessia de reposições para raízes com ordens de reposição. As consultas de autorização passam a receber a lista efetiva de células como parâmetro. Três índices cobrem as buscas por célula e identificadores de lote/pedido. A consulta de peças já registradas verifica a autorização uma vez por escopo, preservando inclusive a diferença entre usuário ativo, inativo e atividade nula.

A migração exige as seis definições exatas da versão publicada, aplica as alterações em uma transação e limita a espera por bloqueio a dois segundos. A reversão preserva os dados e restaura funções, permissões e índices anteriores. Não altera políticas de escrita, plano contratado, limite de conexões hospedado ou dados produtivos.

## Validação

- 13 lotes: resumo completo e sete etapas idênticos antes e depois.
- 117 escopos e dez identidades: genealogia e visibilidade idênticas.
- Dez casos de exceção: reposição pendente, concluída, sucessiva e cancelada, baixa manual, rota explícita, flags de fallback e cancelamento da peça original.
- 36 combinações de papel, atividade e escopo: mesmos identificadores de peças visíveis.
- Dez cenários de políticas e 38 comparações da tela de lotes: resultados idênticos, incluindo acesso parcial, cache vencido e usuário inativo.
- Aplicação/reversão/reaplicação: mesmas definições, permissões e índices.

Os relatórios compactos estão em `evidence/projector-20260926`. A sequência formal de capacidade foi reiniciada após estas alterações. A homologação global permanece NO-GO até completar os cenários exigidos; resultados curtos não substituem os ensaios sustentados de 2.000 coletas/minuto.

Duas tentativas foram descartadas: aumentar o pool local de dez para 30 conexões e usar resumos parciais na tela de lotes. Nenhuma trouxe melhora consistente. O pool local foi restaurado a dez conexões, e o código do cache parcial foi revertido. Essas tentativas não integram a entrega.

A configuração de observabilidade do laboratório segue a documentação do [PostgREST 16](https://docs.postgrest.org/en/stable/references/observability.html). As métricas do pool e o cabeçalho Server-Timing registram a disputa entre consultas e gravações; o teste mantém as 200 sessões e a carga original.

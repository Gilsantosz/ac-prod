# Verificação funcional em produção — 20/09/2026

## Publicação verificada

A PR #92 foi incorporada em `e09fc961e007a4df5340042cdb93bcda82dc6c95`.
O GitHub Pages respondeu com esse commit em `build-info.json` (run
`35513598990`). O Cloudflare concluiu o build
`da4e6cda-1ce0-4c2e-9b81-c38209eb95e5` e passou a servir a versão
`82195e97` em 100% do tráfego. O endereço conferido foi
`https://ac-prod2.gilsantos-pereira.workers.dev/`.

O Cloudflare precisava das variáveis públicas do Supabase no ambiente de
compilação. Elas foram configuradas; a tela de configuração ausente deu lugar
ao login normal. Não foram incluídas senhas de banco ou chaves de serviço no
frontend. Nenhum plano foi alterado e nenhum recurso pago foi criado.

## Coletas reais e reconciliação

As coletas foram feitas pela interface de produção, usando os acessos de
operador autorizados. Bordo utilizou uma peça do lote de teste já existente.
Corte utilizou uma peça válida de lote produtivo, dentro do teste solicitado.
Identificadores de eventos e clientes foram omitidos deste relatório público.

| Célula / resultado | Decisão no banco | Decisão até projeção | Apontamentos de produção |
| --- | ---: | ---: | ---: |
| Bordo / aprovada | 389,414 ms | 5.581,313 ms | 1 |
| Bordo / duplicada | 71,658 ms | 4.315,341 ms | 0 |
| Corte / aprovada | 230,655 ms | 3.801,090 ms | 1 |

As durações usam `received_at_db`, `decision_committed_at` e `projected_at`;
não incluem a digitação, a rede do navegador ou a renderização. As três
tentativas estavam sincronizadas, com três leituras e dois apontamentos
distintos. Nenhum registro foi apagado para limpar o teste.

A interface confirmou aprovação e duplicidade, manteve o foco do leitor e
mostrou o lote geral e o lote do cliente nos modos normal e foco. A coleta de
Corte também mudou o lote do cliente mantendo o mesmo lote geral.

Os testes encontraram três detalhes corrigidos na alteração seguinte:

- O recibo V3 usa `step_code`; a apresentação imediata usava a etapa atual da
  peça, que já havia avançado. Agora a etapa da leitura permanece separada.
- Um snapshot incompleto podia apagar o nome conhecido do mesmo lote. A
  interface preserva apenas os nomes cuja identidade é comprovadamente a
  mesma; mudança de lote continua descartando a identificação anterior.
- O card de produção do turno somava leituras bloqueadas. Agora o total soma
  aprovações e reprovações, sem acrescentar duplicatas/bloqueios.

Na abertura de outro operador no mesmo navegador/dispositivo, o servidor
encerrou a sessão anterior com `operator_switch`; a interface bloqueou a
sessão encerrada. As coletas reais acima foram sequenciais. Isso não equivale
a uma prova de operadores simultâneos em dispositivos independentes.

## Limite desta evidência

### Repetição após a PR #93

O commit `741876c270f31867aeea9837cd3ac80783211265` foi confirmado no Pages
(run `35514349633`) e no Cloudflare (versão `5b1ee565`, 100% do tráfego).
Uma repetição em Corte foi classificada como duplicada em 215,217 ms, sem
apontamento de produção. Outra peça foi aprovada em 233,903 ms, gerando um
único apontamento. Os cinco recibos da rodada estavam sincronizados: três
aprovações e duas duplicatas, com três apontamentos distintos.

A repetição confirmou a etapa da leitura e o total de produção corrigidos,
mas reproduziu uma janela adicional: um GET iniciado **depois** da decisão
podia ler o contexto anterior durante os segundos de projeção assíncrona.
Isso revertia temporariamente o lote do cliente no cabeçalho, mesmo com a
peça correta no histórico.

A correção subsequente compara o evento confirmado com o evento do contexto
retornado. Durante uma janela limitada de 30 segundos, preserva o contexto
local se o snapshot ainda for anterior e usa a reconciliação já agrupada em
3/8 segundos. Um evento posterior de outro posto prevalece; após o limite, o
snapshot volta a prevalecer. Não há consulta adicional por ACK comum.

O ensaio funcional não mede capacidade global. A execução k6 de leitura
registrou 28.200 GETs, zero falhas e p95 de 87,17 ms, mas não executou 1.000
logins ou 2.000 gravações por minuto. O teste de navegador com três sessões usa
respostas simuladas. A homologação de escrita em larga escala continua
**NÃO VALIDADA / NO-GO**, conforme o
[relatório de capacidade](../../architecture/collection-fabric-v3-capacity-report.md).

A confirmação local da coleta antecede a projeção secundária. Dados originados
em outro dispositivo continuam sujeitos à reconciliação de 60–90 segundos;
não foi demonstrada atualização instantânea global.

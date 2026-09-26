# Coletas: redução de contenção e custo das consultas

Esta entrega reduz a disputa entre a confirmação de uma coleta e a atualização dos painéis. As rotinas que atualizam lotes usam uma ordem consistente de bloqueios, reaproveitam cálculos por lote e restringem as consultas aos dados autorizados. Reenvios de uma coleta já confirmada leem a decisão gravada sem disputar novamente seu bloqueio exclusivo.

A migração `20260926143631_collection_latency_optimization.sql` reúne 18 alterações ensaiadas em uma única transação, com verificação prévia de 19 definições e quatro políticas do banco real. O limite de espera por bloqueio durante a implantação é dois segundos. A reversão correspondente restaura as definições anteriores e preserva recibos, peças, apontamentos e filas de produção.

## Evidência de latência e integridade

O diagnóstico isolado usou PostgreSQL 17, Supabase Auth/PostgREST/Realtime reais, 61.031 peças sintéticas, 200 sessões autenticadas, 200 conexões WebSocket e dez conexões do PostgREST. Não utilizou respostas simuladas nem dados sintéticos na produção.

| Verificação | Resultado |
|---|---|
| Diagnóstico de 120 segundos, 60 coletas/minuto | 121 coletas confirmadas |
| Confirmação HTTP p50 / p95 / p99 | 99,042 / 373,584 / 699,230 ms |
| Maior confirmação HTTP | 897,281 ms |
| Processamento até o commit real p99 | 179 ms |
| Erros técnicos / deadlocks | 0 / 0 |
| Registros perdidos / produção duplicada | 0 / 0 |
| Comparação dos indicadores de 100 escopos | 100 corretos |
| 100 chamadas simultâneas com o mesmo evento, após correção adicional | 100 respostas sem erro; um recibo, uma leitura, um apontamento e uma peça |
| Reposição por sete etapas e reabertura | Igual ao comportamento anterior |
| Consulta de lotes, acesso completo/parcial e cache inválido | 38 comparações iguais |
| Aplicação e reversão do pacote exato | Definições, permissões e laboratório preservados |

O primeiro teste das 100 chamadas teve 14 timeouts, embora contabilizasse uma única peça. A correção adicional mantém as validações de identidade/dispositivo e limita o bloqueio aos recibos ainda sem decisão. O novo teste passou; ambos os resultados foram preservados.

Os percentis com 200 sessões foram medidos antes dessa correção adicional de reenvio. A correção adicional foi validada pelo teste concorrente de 100 chamadas e pelo ensaio integral da migração. O resultado `DIAGNOSTIC_PASS` não é homologação global: o ensaio de dois minutos não substitui os cenários de 10/15/60 minutos, 2.000+ coletas/minuto, desconexões e saturação. A homologação global continua **NO-GO** até completar essas etapas.

A mudança de Realtime para todas as células e o mapeamento explícito das células físicas continuam no laboratório. As medições locais de notificações não são uma garantia de latência da internet ou do plano gratuito hospedado.

## Verificações do código

- Auditoria do contrato de coleta: aprovada.
- Lint e TypeScript: aprovados.
- Testes unitários: 152 arquivos e 953 testes aprovados.
- Build de produção: aprovado.
- Auditoria de dependências/segredos: passou o limite configurado; permanece um aviso moderado preexistente em `fflate`.
- As 19 definições verificadas na produção correspondiam integralmente ao export usado no ensaio.

## Implantação e conferência

Aplicar a migração transacional pelo gerenciamento de migrações do Supabase. Em seguida, inicializar `private.refresh_shared_collection_batch_snapshot` por lote existente, usando contexto de serviço autorizado e lotes pequenos. O projetor passa a atualizar os resumos a cada processamento; uma revisão ausente ou diferente faz o leitor consultar o cálculo original protegido por RLS.

Conferir `get_public_collection_immediate_release().ready`, os hashes revisados do manifesto, a ausência de erros recentes e a convergência dos registros. A publicação do repositório usa o workflow existente e mantém a versão mais recente da interface. Após a publicação, retomar a sequência formal de capacidade no ambiente isolado.

Os resultados compactos estão em `evidence/latency-20260926`. O laboratório mantém as amostras brutas, o manifesto de fontes, os deltas SQL e os scripts de reprodução. O ensaio ponta a ponta de solicitar uma reposição ainda encontra uma divergência anterior de esquema (`replacement_orders.route_steps`); seu reparo e a homologação desse fluxo seguem pendentes. A regressão de gatilhos desta entrega usa uma fixture transacional e não declara aquele fluxo homologado.

## Aplicação no ambiente hospedado

Aplicada no projeto `ac-prod` em 26/09/2026 às 14:36:31 UTC, versão de migração `20260926143631`. O contrato de confirmação imediata retornou `ready=true`, com o hash revisado `aa4f5381ab5b7514c8d816b48af8f41e`. Os cinco lotes existentes receberam seus resumos derivados (35 linhas por etapa); os cinco resumos de rastreabilidade estavam atualizados. A conferência posterior encontrou zero projeções pendentes e zero erros recentes. Estes são testes de implantação, não prova de capacidade hospedada.

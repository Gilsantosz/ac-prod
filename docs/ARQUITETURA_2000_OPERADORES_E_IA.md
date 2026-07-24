# Arquitetura para 2.000 operadores e motor de IA

## Estado implementado

O AC.Prod mantém `production_pieces` e os eventos produtivos como fontes
canônicas. A coleta usa `client_event_id` idempotente, grava primeiro no
IndexedDB e sincroniza por RPC atômica. A fila local aplica retentativa
exponencial com jitter e recupera eventos que ficaram em processamento após
queda do navegador ou da internet.

O motor de IA usa um catálogo declarativo (`ai_capabilities`) e nunca executa
SQL ou URLs arbitrárias geradas pelo modelo. Toda ação passa pelo RBAC, pelo
escopo de células, pela validação de destinatários cadastrados e pela auditoria
em `ai_action_runs`/`ai_system_logs`.

O lote geral é `promob_import_batches.general_lot_code`; o lote do cliente é
`production_lots.lot_code`. A IA resolve essa hierarquia antes de consultar,
gerar relatório ou navegar. Os links abrem Integridade/Acompanhamento com
`generalLot` e `clientLot` já selecionados.

## Concorrência

A arquitetura é compatível com 2.000 sessões simultâneas quando:

- as coletas passam pela RPC idempotente e não por múltiplos `insert/update`
  independentes no navegador;
- Realtime é filtrado por célula/lote, sem assinaturas globais por operador;
- KPIs usam snapshots/RPCs agregados e índices de lote, célula e horário;
- o pool, compute e limites do plano Supabase são dimensionados com base no
  teste de carga;
- relatórios e integrações pesadas rodam em Edge Functions/filas, fora do
  caminho crítico da coleta.

O arquivo `tests/load/collection-snapshot-2000.js` valida 2.000 usuários
virtuais com meta de menos de 1% de erro, p95 abaixo de 1,5 s e p99 abaixo de
3 s. Compatibilidade arquitetural não substitui um teste no ambiente e plano
que serão usados em produção.

## Consistência entre sistemas

`integration_inbox` recebe eventos externos com chave idempotente. A
`integration_outbox` registra o evento a publicar na mesma transação da
mudança local; um worker envia, confirma e tenta novamente sem duplicar. Não se
implementa transação distribuída entre PCP, e-mail e MES.

## Segurança

- O frontend contém apenas URL e chave `anon` pública; `service_role`, SMTP e
  chaves de provedores ficam em Secrets das Edge Functions/GitHub.
- RLS permanece obrigatória nas tabelas expostas.
- Edge Functions validam JWT, perfil ativo, permissão, origem permitida,
  tamanho da requisição, destinatário cadastrado, limite de envio e chave de
  idempotência.
- Funções `security definer` têm `search_path` explícito.
- Importações limitam extensão, 20 MB, 50.000 linhas e 256 colunas.
- Dependências são verificadas por `npm audit`; o parser XLSX do navegador usa
  o fork mantido `@e965/xlsx`.

## Operação recomendada

1. Executar migrations e testes automatizados no CI.
2. Testar 2.000 VUs em branch Supabase/staging, nunca direto na produção sem
   janela aprovada.
3. Observar latência de RPC, conexões, CPU, I/O, falhas e fila.
4. Ajustar compute/pool somente com os resultados observados.
5. Publicar gradualmente e acompanhar `ai_action_runs`,
   `report_schedule_runs`, `integration_inbox/outbox` e eventos de coleta.


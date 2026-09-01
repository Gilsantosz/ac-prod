# Validação da fila de coleta — 2026-09-01

## Sintoma e evidência

Uma estação exibiu 34 leituras em `Processando` por tempo excessivo, enquanto o painel de histórico repetia chamadas a `get_collection_history`. A fila do PostgreSQL acabou drenando sem perda, mas a experiência local permanecia bloqueada pelo item mais lento do micro-lote.

Na amostra de produção posterior ao runtime v9.2.3, 51 leituras foram concluídas. Quinze exigiram mais de uma tentativa e uma chegou a sete tentativas. A latência de fila apresentou p50 de 8,5 s, p95 de 110,9 s e p99 de 141,7 s. Ao final da coleta da amostra não havia item recebido, processando ou com lease expirado.

Nenhum identificador de operador, peça, lote ou credencial foi incluído nesta análise.

## Causa raiz

Três comportamentos se somavam:

1. O cliente marcava todo o micro-lote como `processing` e só confirmava o IndexedDB quando o último item terminava. Um timeout parcial também devolvia ao estado pendente itens que o servidor já havia concluído.
2. O worker aceitava concorrência oito, embora o hotpath atualize agregados compartilhados por célula e lote. A rajada observada gerou contenção, novas tentativas e backoff exponencial.
3. Cada finalização podia iniciar uma nova leitura do histórico, e cada alteração local podia disparar uma varredura completa das estatísticas do IndexedDB.

## Correção

- o servidor informa ao sincronizador cada item finalizado durante o polling;
- o IndexedDB confirma esses itens progressivamente e nunca os devolve a `pending` por causa de outro item lento;
- somente a parcela não finalizada recebe backoff em um timeout;
- a reconciliação ativa é limitada a uma fatia de 15 segundos, liberando o envio do próximo micro-lote enquanto o worker termina IDs anteriores;
- o worker limita o hotpath a duas transações paralelas;
- eventos Realtime do histórico são consolidados em uma janela de cinco segundos;
- atualizações das estatísticas locais são consolidadas em 100 ms e serializadas;
- logs repetitivos do RPC foram removidos do console de produção.

## Validação

- 95 arquivos e 407 testes unitários aprovados;
- testes específicos para finalização progressiva, timeout parcial, rajada Realtime e rajada do IndexedDB;
- lint, typecheck, auditoria de rollout, auditoria de dependências/segredos e build aprovados;
- zero vulnerabilidades no `npm audit`.

O ganho de latência do worker deve ser acompanhado nos próximos lotes reais comparando p50, p95, p99, tentativas por evento e backlog. A alteração elimina a retenção artificial no cliente mesmo quando uma leitura individual ainda precisa de retry no servidor.

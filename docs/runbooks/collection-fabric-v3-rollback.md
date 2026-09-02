# Runbook de rollback — Collection Fabric v3

Status: **procedimento proposto; precisa ser ensaiado em staging antes do piloto**.

O rollback é operacional e não destrutivo. Ele para novos claims v3, preserva
recibos, filas e outbox e devolve somente novas capturas ao v2. Não use `DELETE`,
`TRUNCATE`, down migration, remoção de fila ou edição de migration aplicada.

## Quando acionar

Acione o rollback quando qualquer gate crítico romper: evento sem estado
determinável, dupla aprovação, deadlock/statement timeout no caminho normal, DLQ
nova, fila sem worker saudável, queue age p99 acima de 2 s no nominal, regressão
de regra produtiva, vazamento de segredo, bypass de autorização ou frontend
indicando aprovação antes da decisão.

Registre o horário, primeiro `client_event_id` afetado, flags/escopo, worker IDs,
fila/msg_id, SQLSTATE, versão do frontend e último health conhecido. Não coloque
JWT, matrícula completa ou payload sensível no incidente.

## Sequência de contenção

1. Congele a expansão e impeça novas mudanças de configuração.
2. Desligue `collection_pipeline_v3_worker` pelo RPC administrativo. Isso para
   novos claims; uma transação já iniciada pode terminar. Não mate o banco.
3. Desligue `collection_pipeline_v3_ingress` e confirme no health. A partir desse
   instante, somente novas capturas não ACKadas pelo v3 podem seguir o v2.
4. Desligue `collection_pipeline_v3_broadcast` se o incidente envolver payload,
   autorização ou estado visual. Broadcast nunca é a fonte de verdade.
5. Mantenha `collection_pipeline_v3_projection` ligada apenas se o incidente não
   envolver projeção e houver decisões já commitadas para drenar. Caso contrário,
   desligue-a e preserve o outbox intacto.
6. Aguarde o limite curto das transações em voo, tire um novo health e registre
   heartbeats, receipts `processando`, visibility timeout e tamanho das filas.

Não habilite v2 e v3 para o mesmo evento. Para um resultado de ingresso incerto,
consulte primeiro o recibo por `client_event_id` e `(device_id, device_sequence)`:

- recibo v3 encontrado: preserve-o e não reenvie ao v2;
- resposta final encontrada: entregue essa decisão ao frontend;
- sem recibo após reconciliação consistente: a captura local pode ser roteada ao
  v2, mantendo seu identificador idempotente;
- consulta indisponível: mantenha `PENDING_REVIEW`; nunca aprove localmente.

## Inventário que deve permanecer intacto

Capture contagens e a mensagem mais antiga, sem consumir ou arquivar manualmente:

- `coletas_producao` com `pipeline_version=3`, por estado e source mode;
- `collection_live_v3` e `collection_replay_v3`, incluindo mensagens invisíveis;
- `collection_projection_v3` e `collection_dead_letter_v3`;
- `collection_processing_attempts`;
- `production_collection_events` e `production_stage_readings` v3;
- `collection_projection_outbox` e `collection_projection_applied`;
- shards e projeções legadas;
- registry/checksum dos triggers guardados.

Exporte apenas metadados sanitizados para o incidente. As filas, seus archives,
recibos e outbox são evidência e mecanismo de recuperação, não lixo transitório.

## Escolher a recuperação

### Decisão íntegra; projeção atrasada

Mantenha ingresso e worker desligados. Corrija o projetor, valide idempotência em
staging, reative somente a projection flag e drene o outbox. Execute reconciliação
do ledger para shards/projeções e compare antes de reabrir tráfego.

### Mensagens recebidas; decisão não iniciada

Preserve PGMQ até a correção. Depois de reproduzir e corrigir a causa em migration
ou código versionado, reative worker em escopo de recuperação e lote pequeno. A
visibility timeout permite novo claim; `client_event_id` e uniques impedem efeito
duplicado. Monitore cada tentativa e pare novamente ao primeiro gate rompido.

### Claim interrompido ou estado `processando`

Não altere o estado à mão. Espere o visibility timeout/lease, execute o reconciler
versionado e permita que outro worker recupere a mensagem. Verifique uma única
decisão e tentativa append-only; mensagens com cinco falhas seguem para DLQ.

### Falha produtiva ou de autorização

Mantenha todos os componentes v3 desligados, preserve evidência e bloqueie o lote
ou escopo afetado pelo procedimento operacional do MES. Nenhum replay ocorre até
aprovação conjunta de banco, segurança e produção.

## Restauração excepcional dos triggers originais

O rollback cotidiano usa flags; o pipeline v2 permanece compatível com os guards.
Restaurar os triggers originais só é necessário ao abandonar a instalação v3 ou
se um guard estiver comprovadamente incorreto.

Em janela de manutenção, como owner PostgreSQL, depois de confirmar worker e
projection desligados, execute `private.restore_collection_v3_projection_triggers()`.
A função desliga novamente worker/projection, remove somente nomes registrados e
recria o DDL capturado. Registre retorno e confirme:

- os checksums/nomes originais;
- zero guard parcial;
- flags worker/projection desligadas;
- v2 funcional;
- nenhum worker v3 capaz de reiniciar.

Não execute `DROP TRIGGER` manual. Não religue o v3 sem reaplicar uma migration
de guards revisada e repetir todos os gates.

## Critérios para encerrar o rollback

- novas capturas seguem exatamente um pipeline;
- todo ACK v3 está finalizado, em fila preservada ou em DLQ explícita;
- nenhum evento está indefinido;
- zero dupla aprovação e reconciliação ledger/projeções documentada;
- frontend mostra estados reais e neutros durante incerteza;
- causa raiz, SQLSTATE, função, teste reproduzível e correção estão registrados;
- rollback de staging e recuperação foram assinados.

## Registro do ensaio

| Campo | Valor |
| --- | --- |
| Staging/compute | a preencher |
| Commit/migrations | a preencher |
| Cenário induzido | a preencher |
| Instante worker/ingress off | a preencher |
| Recibos/filas/outbox preservados | a preencher |
| Tempo até v2 aceitar nova captura | a preencher |
| Tempo de recuperação/drenagem | a preencher |
| Reconciliação | a preencher |
| Resultado | **NÃO EXECUTADO** |
| Aprovadores | a preencher |

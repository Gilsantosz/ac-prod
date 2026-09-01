# Checklist de segurança — Collection Fabric v3

Status: **template de verificação; itens não marcados não foram validados**.

Anexe evidência sanitizada para cada item. Um único item crítico reprovado mantém
o rollout em NO-GO. Não desabilite RLS para fazer um teste passar.

## Identidade, sessão e contexto confiável

- [ ] `ingest_collection_batch_v3` aceita somente `authenticated`; `anon` e
  chamadas sem JWT recebem `42501`.
- [ ] `auth.uid()` corresponde à sessão operacional e a sessão é validada uma vez
  por lote.
- [ ] sessão encerrada/expirada é recusada; replay respeita `sync_grace_until` e o
  instante capturado.
- [ ] `device_id` da sessão corresponde ao equipamento autenticado.
- [ ] célula e máquina estão ativas, relacionadas e autorizadas para o operador.
- [ ] `operator_id`, `cell_id` e `machine_id` enviados no payload são ignorados ou
  recusados; somente o contexto resolvido no servidor é persistido.
- [ ] rollout scope recusa dispositivo/célula fora do piloto.
- [ ] um usuário não consegue ler recibos de outro usuário.

## Segredos e dados sensíveis

- [ ] frontend e IndexedDB não persistem JWT, refresh token, `service_role` ou
  token operacional por evento; guardam somente `operator_session_id`.
- [ ] nenhum token aparece em `coletas_producao.payload`, evento canônico,
  outbox, tentativa, erro sanitizado ou DLQ.
- [ ] Broadcast não inclui token, matrícula completa ou PII desnecessária.
- [ ] logs de Edge Functions mascaram Authorization/cookies e não serializam o
  envelope completo.
- [ ] fixture k6 fica fora do Git, tem permissão mínima e é destruída/rotacionada
  depois do teste.
- [ ] `npm run security:secrets` e revisão do histórico Git passam.
- [ ] chaves de staging e produção são distintas e rotacionáveis.

## RPCs e privilégios do banco

- [ ] funções `SECURITY DEFINER` possuem owner esperado e `search_path` fixo com
  schemas explícitos e `pg_temp` no fim.
- [ ] nomes dinâmicos são allowlisted/quotados; dados do cliente não formam SQL.
- [ ] ingress possui `EXECUTE` somente para `authenticated` e `service_role`.
- [ ] claim, decisão, projeção, retry e archive não são executáveis por navegador,
  `anon` ou `authenticated`.
- [ ] `private` e tabelas de heartbeat/registry não estão expostas ao navegador.
- [ ] `service_role` existe apenas em workers e executor administrativo seguro.
- [ ] nenhuma policy usa `USING (true)` para escrita operacional nova.
- [ ] nenhuma tabela teve RLS desabilitada.

## PGMQ, outbox e DLQ

- [ ] `pgmq`/`pgmq_public`, queues e archives não possuem grants para `anon` ou
  `authenticated`.
- [ ] somente wrappers privados/service worker podem `read`, `set_vt`, `archive`
  ou enviar à DLQ.
- [ ] visibility timeout, máximo de cinco tentativas, backoff e jitter foram
  verificados sem perda.
- [ ] erro não retryable não entra em loop.
- [ ] mensagens DLQ preservam identificadores técnicos e erro sanitizado, sem
  segredo ou payload desnecessário.
- [ ] outbox/applied são idempotentes e não aceitam escrita direta do browser.
- [ ] operador não consegue apagar receipt, attempt, outbox, queue ou ledger.

## Validação de entrada e idempotência

- [ ] lote vazio, lote com 26 eventos e payload acima de 262.144 bytes são
  recusados atomicamente.
- [ ] o fluxo produtivo aceita somente código normalizado com oito dígitos.
- [ ] reader type fora da allowlist e timestamp futuro inválido são recusados.
- [ ] `client_event_id` repetido com o mesmo conteúdo retorna o recibo anterior.
- [ ] `client_event_id` repetido com conteúdo divergente é conflito, não overwrite.
- [ ] `(device_id, device_sequence)` repetido com outro evento é conflito.
- [ ] vinte entregas concorrentes da mesma peça produzem no máximo uma aprovação.
- [ ] unique de peça/etapa/ciclo permanece ativa e foi exercitada.
- [ ] v2 e v3 nunca processam produtivamente o mesmo evento.

## Broadcast privado

- [ ] canais são privados: `collection:device:{device_id}`,
  `collection:cell:{cell_id}` e `collection:event:{client_event_id}`.
- [ ] equipamento autorizado recebe apenas o próprio tópico.
- [ ] usuário de célula recebe somente células às quais possui acesso ativo.
- [ ] usuário sem acesso não consegue assinar, receber replay nem inferir payload.
- [ ] browser não possui policy de `INSERT` em `realtime.messages` para forjar
  decisão.
- [ ] reconexão consulta o banco; Broadcast não é tratado como fonte de verdade.

## Casos negativos obrigatórios

| Ataque/caso | Esperado | Evidência |
| --- | --- | --- |
| sem autenticação | 401/403; zero recibo | a preencher |
| usuário não autorizado | 42501; zero recibo | a preencher |
| célula ou máquina incorreta | 42501; zero recibo | a preencher |
| sessão expirada | 42501; zero recibo | a preencher |
| payload acima do limite | 22023; zero parcial | a preencher |
| 26 eventos | 22023; zero parcial | a preencher |
| código malformado | resultado recusado; zero efeito | a preencher |
| `operator_id` forjado | ignorado/recusado; contexto server-side | a preencher |
| acesso direto à fila | permission denied | a preencher |
| inscrição em tópico alheio | sem autorização/sem mensagem | a preencher |
| reentrega divergente | conflito; dado original intacto | a preencher |

## Supply chain, deploy e operação

- [ ] dependências estão lockadas e auditoria de vulnerabilidade passa conforme a
  política do projeto.
- [ ] migrations revisadas por duas pessoas e aplicadas pelo pipeline auditável.
- [ ] quatro flags começam desligadas e o setter falha fechado sem guards.
- [ ] nenhuma carga k6 pode apontar ao project ref de produção.
- [ ] alertas cobrem DLQ, deadlock, timeout, retry, fila envelhecida, worker ausente
  e divergência de projeção.
- [ ] rollback preserva receipt/queue/outbox e foi ensaiado em staging.
- [ ] credenciais de incidente/teste foram revogadas ou rotacionadas.

## Aprovação

| Área | Responsável | Resultado | Evidência/data |
| --- | --- | --- | --- |
| Segurança de aplicação | a preencher | NÃO AVALIADO | a preencher |
| Banco/RLS | a preencher | NÃO AVALIADO | a preencher |
| Edge/segredos | a preencher | NÃO AVALIADO | a preencher |
| MES/regras produtivas | a preencher | NÃO AVALIADO | a preencher |

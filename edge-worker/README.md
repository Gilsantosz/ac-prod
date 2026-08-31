# AC.Prod2 Edge Collector — Micro-batching

Worker local para scanner, RFID ou sensor conectado ao posto. O hardware recebe
`202 Accepted` assim que a leitura entra no array local e no journal JSONL. A
cada 5 segundos, até 50 leituras são enviadas em um único
`.from('coletas_producao').insert(rows)`.

O servidor local é iniciado antes da autenticação remota. Portanto, se a rede ou
o Supabase estiverem indisponíveis durante a inicialização, as leituras continuam
sendo aceitas e persistidas no journal para sincronização posterior.

## Segurança

Use uma conta Supabase Auth dedicada ao equipamento e uma sessão operacional
válida do AC.Prod2. **Não coloque `service_role`/secret key no equipamento.**
A tabela tem RLS e só permite que o usuário autenticado insira e consulte as
próprias leituras.

Por padrão, a API escuta apenas em `127.0.0.1`. Para receber dados de outro
dispositivo na rede, configure `EDGE_HOST=0.0.0.0` e obrigatoriamente defina um
`EDGE_INGEST_TOKEN` forte. O hardware deve enviá-lo em `x-edge-token` ou
`Authorization: Bearer`.

## Execução

```bash
cd edge-worker
cp .env.example .env
npm install
npm run start
```

Node.js 22 ou superior é obrigatório.

## Entrada do hardware

```bash
curl -X POST http://127.0.0.1:8787/readings \
  -H 'content-type: application/json' \
  -d '{"tag_lida":"09950001"}'
```

Quando `EDGE_INGEST_TOKEN` estiver configurado:

```bash
curl -X POST http://IP-DO-EDGE:8787/readings \
  -H 'content-type: application/json' \
  -H 'x-edge-token: SEU-TOKEN-LOCAL' \
  -d '{"tag_lida":"09950001"}'
```

Resposta imediata:

```json
{
  "accepted": true,
  "client_event_id": "uuid",
  "queue_size": 1,
  "ack_ms": 2.431
}
```

## Simulação segura

```bash
npm run simulate
```

A simulação usa deliberadamente códigos de **7 dígitos**, rejeitados pelo
contrato produtivo de oito dígitos. Assim ela valida recepção local, journal,
micro-lote, RLS e retorno do Supabase sem aprovar ou movimentar uma peça real.

## Tolerância a falhas

- Supabase indisponível na inicialização: o endpoint local continua ativo.
- Internet/Supabase indisponível durante o envio: o lote retirado volta ao início
  do array.
- Reinício do processo: o journal `EDGE_SPOOL_FILE` recupera os eventos.
- Resposta perdida após commit: o `client_event_id` detecta o registro existente
  e evita baixa produtiva duplicada.
- Erro funcional não retentável: fica gravado em `coletas_producao` para
  auditoria, sem bloquear os demais itens do lote.

# AC.Prod2 Edge Collector — Micro-batching

Worker local para scanner, RFID ou sensor conectado ao posto. O hardware recebe
`202 Accepted` assim que a leitura entra no array local e no journal JSONL. A
cada 5 segundos, até 50 leituras são enviadas em um único
`.from('coletas_producao').insert(rows)`.

## Segurança

Use uma conta Supabase Auth dedicada ao equipamento e uma sessão operacional
válida do AC.Prod2. **Não coloque `service_role`/secret key no equipamento.**
A tabela tem RLS e só permite que o usuário autenticado insira e consulte as
próprias leituras.

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

Resposta imediata:

```json
{
  "accepted": true,
  "client_event_id": "uuid",
  "queue_size": 1,
  "ack_ms": 2.431
}
```

## Simulação

```bash
npm run simulate
```

A simulação envia códigos de oito dígitos ao array local no intervalo definido
em `SIMULATE_INTERVAL_MS`. O envio ao Supabase continua independente, pelo timer
`FLUSH_INTERVAL_MS=5000`.

## Tolerância a falhas

- Internet/Supabase indisponível: o lote retirado volta ao início do array.
- Reinício do processo: o journal `EDGE_SPOOL_FILE` recupera os eventos.
- Resposta perdida após commit: o `client_event_id` detecta o registro existente
  e evita baixa produtiva duplicada.
- Erro funcional não retentável: fica gravado em `coletas_producao` para
  auditoria, sem bloquear os demais itens do lote.

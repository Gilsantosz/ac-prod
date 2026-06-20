# Testes do AC.Prod

## Comandos

```bash
npm install
npm run test:unit
npm run test:coverage
npm run test:e2e
```

O Playwright inicia o Vite na porta `4174`. Para reutilizar um servidor existente:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173/ac-prod/ \
npm run test:e2e
```

## Isolamento

- Testes unitários usam fixtures e um repositório em memória.
- O E2E intercepta Auth, REST e RPC do Supabase; nenhuma informação real é criada ou alterada.
- Câmera e `BarcodeDetector` são simulados nos testes automatizados.
- Hardware e condições físicas são validados pelos checklists em `tests/manual-checklists`.

## Massa padrão

- Lote: `LSM-TEST-001`
- Ordem: `OP-TEST-001`
- Peças: `P001` a `P010`
- Rota: Corte, Marcenaria, Montagem, Qualidade e Expedição

Os dados completos ficam em `src/test/fixtures/traceabilityFixtures.js`.

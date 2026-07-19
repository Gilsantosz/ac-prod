# Implantação — Integridade e Acompanhamento de Lotes

## Entrega

- A página **Integridade do Lote** passa a abrir primeiro o lote geral do PCP.
- Ao selecionar o lote geral, aparecem os lotes de clientes e o andamento individual.
- Lotes do mesmo cliente permanecem visualmente agrupados na mesma capa.
- A nova página **Acompanhamento de Lotes** apresenta KPIs, progresso por etapa, gargalo e previsão até ficar pronto para separação.
- A previsão considera Corte, Borda, Usinagem e Marcenaria. Separação, embalagem e expedição não entram no prazo produtivo exibido.
- Os indicadores são atualizados por Realtime e também possuem recarga periódica de segurança.

## Modelo de previsão

O banco calcula a mediana do intervalo entre leituras aprovadas por etapa e dia nos últimos 90 dias. O ritmo de cada etapa é independente, portanto a Marcenaria aprende com o próprio histórico.

Enquanto uma etapa ainda não possui histórico suficiente, o sistema usa uma referência conservadora e exibe **Confiança inicial**. A confiança passa para média e alta automaticamente conforme novas leituras válidas são registradas.

## Banco de dados

As migrações desta entrega são:

- `20260719035709_general_lot_integrity_forecast.sql`
- `20260719041050_allow_general_lot_tracking_read.sql`

Elas criam a consulta segura `get_general_lot_tracking`, o índice do vínculo lote geral/cliente e a política de leitura do cabeçalho do lote geral para usuários que já possuam `view_traceability` ou `view_pcp`. Importação, atualização e exclusão continuam restritas.

## Validação

```bash
npm ci
npm run test:unit
npm run typecheck
npm run lint
npm run build
```

Resultado desta entrega: 133 testes unitários aprovados, typecheck aprovado, lint aprovado e build de produção aprovado.

## Publicação pelo Antigravity ou terminal

Depois de copiar os arquivos desta entrega para o clone do repositório:

```bash
git switch -c agent/lot-integrity-dashboard-forecast
git add src tests/e2e/traceability-flow.spec.js supabase/migrations IMPLANTACAO_ACOMPANHAMENTO_LOTES.md
git commit -m "feat: hierarquia e previsão dos lotes gerais"
git push -u origin agent/lot-integrity-dashboard-forecast

gh pr create \
  --base main \
  --head agent/lot-integrity-dashboard-forecast \
  --title "feat: hierarquia e previsão dos lotes gerais" \
  --body "Exibe o lote geral antes dos lotes de clientes, preserva o agrupamento por cliente e adiciona dashboard com previsão adaptativa até a separação. Validação: 133 testes, typecheck, lint e build aprovados."
```

Após revisar o PR:

```bash
gh pr merge --merge --delete-branch
gh run list --workflow deploy.yml --limit 3
```


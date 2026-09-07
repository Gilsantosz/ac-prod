# Teste de carga da API MES

O comando abaixo inicia PostgreSQL descartável e a API real em HTTP local,
aplica as migrações MES, cria os cadastros de teste, executa o k6 e remove o banco ao terminar. Ignora
qualquer `DATABASE_URL`, `.env`, token ou URL de produção do projeto.

```sh
cd services/mes-api
node --test load-tests/config.test.mjs
node load-tests/run-local.mjs
```

Requer Node.js 22+, dependências da API (`npm ci`), k6 e as ferramentas
PostgreSQL `initdb`/`pg_ctl` no PATH. Não instala nada nem utiliza k6 Cloud.

O cenário padrão oferece **40 novos apontamentos por segundo durante 60 s**,
totalizando pelo menos **2.400 gravações novas**, com até 100 usuários virtuais.
Em paralelo, outros 20 usuários virtuais disponíveis oferecem 5 repetições e
5 conflitos esperados por segundo. Na preparação, 20 requisições com a mesma
chave concorrem entre si e devem produzir apenas uma gravação.

Critérios: zero falhas de contrato, zero falhas HTTP inesperadas, nenhuma
iteração descartada e p95 abaixo de 500 ms em cada operação. Respostas 409
são esperadas apenas no cenário que reutiliza uma chave com dados diferentes.
O runner também compara as respostas 201 com a contagem e quantidades no banco,
confere ausência de duplicação e observa o teto de 30 conexões do pool.
As migrações reais incluem índices, RLS e o trigger de aprendizado. Apenas as
tabelas legadas referenciadas ficam vazias; o cron é substituído por uma função
sem agendamento. O papel da API permanece sem acesso a UPDATE, DELETE e amostras.
Como o payload da carga não informa duração, nenhuma amostra de ciclo pode ser
criada e o OEE deve continuar indisponível após a atualização local das views.

O resultado é salvo em uma pasta temporária `mes-k6-results-*`, informada ao
final, com `k6-summary.json` e `verification.json`, incluindo hashes das migrações.
Não contém credenciais.
O relatório informa explicitamente o escopo local: ele não comprova capacidade
do Render, Supavisor, cron ativo, cálculo do OEE com ciclos medidos ou 1.000 PCs simultaneamente conectados.

## Parâmetros do runner local

| Variável | Padrão | Função |
| --- | --- | --- |
| `MES_LOADTEST_RATE` | `40` | Novas gravações oferecidas por segundo |
| `MES_LOADTEST_DURATION_SECONDS` | `60` | Duração; use 5 apenas para verificar o funcionamento do teste |
| `MES_LOADTEST_VUS` | `100` | Limite de usuários virtuais do cenário de novos eventos |
| `MES_LOADTEST_POOL_MAX` | `30` | Teto local de conexões; não pode exceder o limite do papel mes_api nas migrações (atualmente 30) |
| `MES_LOADTEST_P95_MS` | `500` | Limite de latência p95 |
| `MES_LOADTEST_RESULTS_DIR` | pasta temporária | Diretório dos relatórios; arquivos de mesmo nome são substituídos |
| `MES_LOADTEST_K6_BIN` | `k6` | Caminho do executável |

## Ambiente de homologação isolado

O script `apontamentos.k6.js` também aceita uma API de homologação já
preparada. Exige `MES_LOADTEST_BASE_URL`, `MES_LOADTEST_API_TOKEN`,
`MES_LOADTEST_EQUIPAMENTO_ID` e `MES_LOADTEST_PRODUTO_ID` exclusivos do teste.
Cada execução grava dados; a preparação e a remoção desses cadastros e eventos
ficam a cargo de quem administra esse ambiente. O runner local faz isso sozinho.

O padrão permite somente `localhost`, `127.0.0.1` e `[::1]`. Para uma origem
remota, exige HTTPS, `MES_LOADTEST_ALLOW_REMOTE_STAGING=yes` e hostname com
segmento `staging`, `stage`, `test`, `testing` ou `preview`. Nomes de produção
(`prod`/`production`) e domínios Supabase são recusados mesmo com opt-in.
Essa barreira evita enganos comuns; o administrador ainda deve garantir que
esse hostname e essas credenciais apontem para um ambiente realmente isolado.
Redirecionamentos HTTP são desativados. Nunca usar `--http-debug` com tokens.

Referência: [constant-arrival-rate do k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).

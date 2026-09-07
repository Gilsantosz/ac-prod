# API MES

Serviço Node.js 22+ independente do site estático. `npm ci`, `npm test` e
`npm start` executam a API. O comando start lê `.env` quando ele existir;
em produção as variáveis podem ser injetadas pela hospedagem.

## Contrato de banco

Requer `public.apontamentos_producao` com PK `id uuid`, as quatro colunas
`equipamento_id uuid`, `produto_id uuid`, `qte_boa integer`, `qte_refugo integer`,
e `data_hora timestamptz DEFAULT NOW()`, além das cinco colunas opcionais de
medição adicionadas por `20260907015138_mes_cycle_learning.sql`.
A idempotência usa a própria PK e
não exige tabela adicional. O papel `mes_api` deve ter somente INSERT/SELECT
nessa tabela e SELECT em `public.oee_tempo_real`, além de USAGE no schema.
As políticas RLS precisam permitir os mesmos acessos ao papel dedicado.

A migração configura `ALTER ROLE mes_api SET statement_timeout = '5s'` e
`lock_timeout = '1s'`. A API não envia `SET` de sessão ao Supavisor Transaction.
`DB_STATEMENT_TIMEOUT_MS` documenta o limite instalado no papel para validar
que o timeout de leitura do driver seja maior; não altera o banco.

## Contrato HTTP

`POST /api/apontamentos` exige `Authorization: Bearer <API_TOKEN>` e
`Idempotency-Key: <UUID>`. O JSON exige `equipamento_id`, `produto_id`,
`qte_boa` e `qte_refugo`. O cliente deve guardar uma chave por evento e usar
a mesma chave e o mesmo payload nas novas tentativas após falhas de rede.

Quando o dispositivo ou operador conhece o intervalo real da operação, pode
enviar também os cinco campos abaixo. Devem estar todos presentes ou todos
ausentes; valores `null` e campos parcialmente enviados são recusados.

```json
{
  "inicio_operacao": "2026-09-06T10:00:00.123456-03:00",
  "fim_operacao": "2026-09-06T10:01:00.123456-03:00",
  "origem_tempo": "sensor",
  "teve_interrupcao": false,
  "retrabalho": false
}
```

Esse bloco é acrescentado aos quatro campos obrigatórios. Os horários exigem
fuso explícito e até seis casas decimais; `origem_tempo` aceita `sensor` ou
`operador`. O fim deve ser posterior ao início, não pode estar no futuro e a
medição precisa incluir pelo menos uma peça. O banco valida essas relações.
A API não transforma intervalo entre leituras RFID, chegada de requisições
ou latência de rede em tempo de ciclo. O trigger no PostgreSQL seleciona as
operações elegíveis para o aprendizado. Apontamentos sem medição continuam
sendo aceitos, mas não geram amostras de ciclo.

Todos os campos entram na comparação de idempotência. Os horários são
comparados como instantes no PostgreSQL: fusos equivalentes são aceitos,
mas uma diferença de um microssegundo já representa dados diferentes.

- 201: criado; 200 + `Idempotency-Replayed: true`: já existia com os mesmos dados.
- 409: chave reutilizada com dados diferentes; não tentar novamente com essa chave.
- 400/401/422: dados, autenticação ou cadastro inválidos.
- 503/504: capacidade ou banco indisponível; repetir com a mesma chave e espera crescente.

`GET /api/oee` exige a mesma autenticação e retorna a MV sem cálculos.
`GET /healthz` é apenas uma checagem pública do processo; não comprova conexão com o banco.

O token é destinado à integração de servidores/dispositivos administrados.
Não deve ser embutido no JavaScript do navegador, em variáveis VITE_ ou no Git.
TLS é obrigatório no PostgreSQL remoto, com certificado verificado e a CA
pública oficial `supabase-ca.crt` incluída na imagem. `DB_SSL_ROOT_CERT`
indica esse arquivo. A API
também deve ser publicada por HTTPS no proxy da hospedagem. Em produção a
configuração exige o hostname Supavisor e a porta 6543.

O máximo de 30 conexões padrão (configurável até 50) vale por processo da API;
réplicas multiplicam esse número. `DB_QUEUE_MAX` limita o trabalho aguardando
no processo, e o Supavisor limita separadamente conexões físicas ao PostgreSQL.

## Verificação local

`npm test` cobre autenticação, SQL parametrizado, idempotência, conflitos,
validação, saturação, erros e configuração TLS. `npm run test:integration`
cria um PostgreSQL temporário com `initdb`/`pg_ctl`, testa permissões mínimas,
1.000 solicitações concorrentes, repetição de eventos e o trigger da migration
de aprendizado, e remove o banco ao terminar.
Nenhum teste utiliza DATABASE_URL de produção.

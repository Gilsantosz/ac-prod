# Guia de implantação — Coleta, Bipagem e Lotes PCP

## Resultado desta versão

Esta versão usa a seguinte hierarquia:

1. **Lote geral PCP / carga**: campo 26 da linha (índice técnico 25). Exemplo: `15587`.
2. **Lote do cliente**: campo 29 da linha (índice técnico 28). Exemplo: `143332`.
3. **Peça individual**: uma linha do arquivo equivale a uma peça.
4. **Identificação física**: código de barras do campo 15, conferido com o campo 25.

A quantidade de um lote do cliente é a quantidade de vezes que seu código aparece no arquivo. Não existe limite fixo de 2.500 peças para o lote geral.

## Validação do arquivo fornecido

O arquivo `20260715_13-01-17_15587_A_15587teste(1).xlsx` deve apresentar:

| Informação | Resultado esperado |
|---|---:|
| Lote geral | `15587` |
| Peças/linhas | 2.115 |
| Lotes de clientes | 27 |
| Clientes | 13 |
| Códigos de barras físicos únicos | 2.109 |
| Peças especiais de Marcenaria | 6 |
| Erros estruturais | 0 |
| Peças do lote de cliente `143332` | 106 |
| Cliente do lote `143332` | MARINA MARIA PASETTI DE SOUZA CATANZARO |

As seis peças sem código de barras recebem uma identificação interna única, entram primeiro na fila **Marcenaria** e só depois seguem o roteiro original da linha.

## Implantação obrigatória do banco

Antes de publicar o front-end, aplique no Supabase a migration:

`supabase/migrations/032_collection_realtime_multi_operator.sql`

Em uma base nova, aplique todas as migrations em ordem numérica. Em uma base que já está na versão 031, aplique somente a 032.

A migration é aditiva e inclui:

- histórico permanente de todas as tentativas de coleta;
- idempotência e proteção contra duas baixas simultâneas da mesma peça;
- vínculo das peças ao lote do cliente e ao lote geral PCP;
- progresso consolidado do lote geral por operações feitas em todas as células;
- atualização das entradas de produção, KPIs e gráficos;
- suporte às seis peças especiais de Marcenaria;
- publicação Realtime das peças e dos lotes gerais.

Faça backup do banco antes da implantação, conforme o procedimento normal da empresa.

## Execução local

1. Instale Node.js 20 ou superior.
2. Na pasta do projeto, execute `npm install`.
3. Copie `.env.example` para `.env.local`.
4. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os dados do projeto Supabase.
5. Execute `npm run dev`.
6. Abra o endereço informado pelo Vite no navegador.

Para validar antes da publicação:

```bash
npm run typecheck
npm test -- --run
npm run build
```

## Fluxo operacional

### Importação PCP

1. Abra a integração PCP e selecione o XLSX/CSV.
2. Confira lote geral, total de peças, lotes de clientes, clientes e peças de Marcenaria.
3. Confirme a importação.
4. Se a conexão falhar no meio dos blocos, use **Retomar Importação**; o mesmo lote de importação é reutilizado sem duplicar as peças já gravadas.

### Coleta e bipagem

1. O operador entra com nome e matrícula.
2. Seleciona célula e máquina.
3. Bipa ou digita a identificação da peça.
4. O servidor valida a etapa, registra operador, horário, turno, célula, máquina e os dois níveis de lote.
5. Outros operadores e monitores recebem a atualização em tempo real.

### Peças especiais

1. Abra **Rastreabilidade > Marcenaria**.
2. Faça o login operacional.
3. Na seção **Peças especiais — baixa manual Marcenaria**, clique em **Dar baixa** na peça correta.
4. A baixa passa pela mesma transação da bipagem e alimenta histórico, KPIs, gráficos e progresso dos lotes.

### Busca

A página **Rastreabilidade > Buscar** aceita:

- lote geral, por exemplo `15587`;
- lote do cliente, por exemplo `143332`;
- cliente;
- código/nome da peça;
- código de barras ou tag.

Cada resultado mostra separadamente o lote geral e o lote do cliente, além do cliente, andamento, peças concluídas, pendências, etapa e célula.

## Checklist após publicar

- Importar primeiro um arquivo de homologação.
- Confirmar que a prévia mostra 2.115 peças e 6 peças manuais no arquivo fornecido.
- Bipar uma peça física em duas máquinas quase ao mesmo tempo e confirmar que somente uma entrada é aprovada.
- Dar baixa em uma peça especial na Marcenaria e confirmar o operador no histórico recente.
- Buscar por `15587` e por `143332`.
- Conferir o painel **Andamento dos lotes gerais PCP** no Dashboard.
- Confirmar que os gráficos gerais receberam a entrada da célula correta.


# Exportações e relatórios do Leo Flow

## Finalidades oficiais

- **PDF — Relatório:** documento institucional, fechado, próprio para impressão, apresentação e arquivo. Relatórios PDF operacionais já validados continuam usando seus renderizadores específicos.
- **Excel (`.xlsx`) — Relatório editável:** pasta de trabalho institucional com logo, resumo, KPIs, filtros, células tipadas, dados e análises.
- **CSV — Dados brutos:** cabeçalho e linhas da tabela primária, sem linhas decorativas ou tentativa de simular identidade visual.

Etiquetas, backups, arquivos originais e integrações Promob não são relatórios gerenciais e permanecem em seus fluxos próprios.

## Arquitetura

O fluxo compartilhado é:

```text
consulta filtrada / métricas oficiais
              ↓
       Report Definition
              ↓
         Report Engine
       ↙       ↓       ↘
     PDF      XLSX      CSV
```

- `src/lib/reports/reportDefinition.js`: contrato comum, formatos e validação.
- `src/lib/reports/reportEngine.js`: seleciona o renderizador sob demanda.
- `src/lib/reports/reportPdfRenderer.js`: PDF institucional genérico.
- `src/lib/reports/reportExcelRenderer.js`: Excel profissional com abas `RESUMO`, `DADOS` e `ANÁLISE`.
- `src/lib/reports/reportCsvRenderer.js`: CSV bruto e seguro.
- `src/lib/reports/reportPeriodComparison.js`: período anterior e variações.
- `src/lib/reports/reportDataUtils.js`: datas, nomes, limites, escaping e sanitização.
- `src/lib/reports/reportChartImage.js`: gráficos próprios da exportação, independentes do DOM visível.
- `src/components/reports/ExportReportMenu.jsx`: menu global, feedback, bloqueio de clique duplo e suporte a consulta tardia por `getReport`.

O ExcelJS é carregado por `import()` somente ao solicitar Excel e não entra no precache inicial da PWA. A dependência está fixada em `4.4.0`; o `uuid` transitivo é sobrescrito para uma versão auditada. Não há API exclusiva de Node no caminho usado pelo navegador/PWA/Electron.

## Relatórios migrados

| Área | Classificação | Formatos/política |
| --- | --- | --- |
| Relatórios Analíticos de Produção | RELATÓRIO | PDF, XLSX e CSV pelo motor comum; referência oficial |
| Painel de Produção | RELATÓRIO | PDFs existentes e CSV bruto preservados; XLSX comum adicionado |
| Resumo Diário | RELATÓRIO | PDF existente preservado; XLSX comum |
| OEE | RELATÓRIO | PDF existente preservado; XLSX e CSV comuns |
| Ocorrências e Paradas | RELATÓRIO | PDF existente preservado; XLSX e CSV comuns |
| Qualidade | RELATÓRIO | PDF, XLSX e CSV comuns sobre os mesmos indicadores da tela |
| Reposição | RELATÓRIO | XLSX e CSV paginados; PDFs operacionais e etiquetas preservados |
| Rastreabilidade por Leitura | DADOS | XLSX e CSV comuns |
| Auditoria do Sistema | DADOS | XLSX e CSV paginados |
| Integridade/Rastreabilidade | DADOS | XLSX e CSV paginados |
| Reposição/Promob | ETIQUETA | sem alteração |
| Downloads e cópias de segurança | BACKUP | sem alteração |
| Importação/arquivos Promob | INTEGRAÇÃO | sem alteração |

Expedição, Embalagem e Entrada Manual permanecem em standby conforme a configuração de rotas; seus fluxos técnicos não foram alterados.

## Consultas, volume e segurança

- Período, célula, turno e demais filtros disponíveis são aplicados no Supabase antes do download.
- Consultas de exportação usam paginação de 1.000 linhas e snapshot por data/hora. Não existe corte silencioso.
- Limites explícitos: PDF 5.000 linhas; XLSX/CSV 100.000. Ao exceder, o operador recebe orientação para reduzir período/filtros.
- As chaves do TanStack Query incluem os filtros relevantes. Relatórios históricos não usam polling; painéis operacionais mantêm apenas o polling já necessário à tela.
- Toda consulta continua usando o cliente autenticado e as políticas RLS existentes. Não foi criada view, RPC, credencial ou uso de `service_role`.
- CSV e texto de Excel que começam com `=`, `+`, `-` ou `@` são prefixados para impedir execução como fórmula. Valores numéricos reais continuam numéricos.
- Campos internos sem valor gerencial, payloads completos, tokens e credenciais não entram nos novos relatórios.

## Como adicionar um relatório

1. Reutilize o serviço oficial de métricas da tela; não recalcule KPI no componente de exportação.
2. Se os dados da tela forem parciais, crie uma consulta filtrada e paginada em `src/lib/reports/`. Preserve RLS e capture um `snapshotAt`.
3. Crie uma função `create...ReportDefinition()` com `id`, título, período, filtros, resumo, tabelas e gráficos.
4. Declare cada coluna com `key`, `label` e `type`: `text`, `number`, `integer`, `percentage`, `date`, `datetime`, `duration` ou `boolean`.
5. Percentuais na definição devem ser decimais (`0.925` para `92,5%`). Datas devem ser valores ISO válidos e números devem permanecer números.
6. Marque uma tabela como `primary: true`/`sheet: 'data'`; ela alimenta `DADOS` e o CSV. Tabelas `sheet: 'analysis'` vão para `ANÁLISE`.
7. Gráficos recebem `categories` e `series`; cada série informa `name`, `values` e, opcionalmente, `color`.
8. Renderize `ExportReportMenu` com `report`, ou com `getReport` quando a consulta completa só deve ocorrer após o clique.
9. Para manter um PDF validado, forneça `formatExporters={{ pdf: ... }}` e use o motor comum nos demais formatos.
10. Adicione testes de definição, tipos, totais, limites e compatibilidade do arquivo.

## Validação esperada

Antes de publicar mudanças de relatórios, execute:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run security:check
```

Quando houver ambiente e credenciais adequados, execute também os testes E2E. A validação automatizada abre novamente o `.xlsx` gerado e verifica abas, logo, filtros, tipos, formatos e integridade das linhas.

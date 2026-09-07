# AC.Prod2 — gráficos glass / revisão com Data Analytics

## Escopo e fonte
Camada de apresentação compartilhada para importações Recharts da aplicação em `src/`: Painel, Relatórios, Qualidade, OEE, tendências e demais páginas que usam ResponsiveContainer. As primitivas originais Recharts 2 são reexportadas sem wrappers; somente o container e seus filhos de apresentação são enriquecidos. Componentes não reconhecidos continuam no container original.

Não há mudança em consultas, filtros, Auth, RLS, RPCs, coletas, filas, ingestão, k6 ou dependências. Não houve alteração no Supabase: apenas inspeção read-only do catálogo. `promob_import_batches` continua sendo a fonte do progresso PCP; 7,34% aparece somente na fixture ilustrativa, nunca como valor fixo na produção.

## Contrato visual e analítico
- Cards glass claros/escuros, grade quantitativa tracejada, gradientes de barras/linhas, legendas e tooltips preservando formatação/unidades da origem.
- Expandir/fechar com diálogo Radix, foco e Escape; ocultar com restauração visível; opções, tabela e navegação de 20 registros por página.
- As setas **paginam a tabela**, não a série: o gráfico continua exibindo todo o recorte, sem alterar escalas ou totais.
- Null/undefined/NaN são `—` na tabela; zero continua zero. Valores não são truncados nem arredondados antes de plotar. Não se mistura porcentagem com volume nem diferentes unidades. Não se força escala 0–12 ou limita atingimento a 100%.
- Não se converte perda/refugo em verde: cores semânticas existentes são preservadas. Paint servers já presentes permanecem no mesmo SVG, com IDs distintos por instância. Linhas constantes usam gradiente `userSpaceOnUse`, evitando bounding boxes de altura zero.
- Barras crescem desde sua base por CSS; linhas têm revelação progressiva. Geometria SVG e atualizações numéricas não ficam aguardando animação. Movimento reduzido respeitado; mais de 300 linhas desativa entrada animada; impressão sem animações.
- A tabela oferece acesso aos valores por teclado. Interações originais de clique e `connectNulls` permanecem intactas. Os controles não propagam cliques para cards interativos.

## Validação e limites
Executado localmente: `node scripts/testChartModel.mjs` (5 testes aprovados); análise sintática JS/JSX/MJS; comparação dos hashes Git dos arquivos base de configuração e progresso para verificar que apenas os trechos planejados mudaram.

O container local não tem checkout completo/dependências React/Recharts e não resolve github.com. Portanto, testes React, build e validação em navegador NÃO podem ser declarados aprovados a partir desses testes locais. A PR precisa passar pelo workflow `Charts UI — isolated visual validation` e pela qualidade já existente.

O workflow dedicado não contém credenciais de produção: usa fixture sintética, bloqueia chamadas externas no navegador, testa os quatro gráficos, gradientes, expansão sem duplicação, ocultar/restaurar, tooltips, movimento reduzido e mobile. Captura screenshots em `charts-glass-visual-validation` para revisão humana. Nenhuma execução deste workflow mede capacidade MES ou substitui k6.

Antes do merge: revisar capturas, filtros reais em homologação (setor/célula/turno/período/unidade), gráficos de Qualidade com modais próprios, telas em quiosque e navegadores dos postos. Conferir também gráficos diretos sem ResponsiveContainer e gráficos de bibliotecas diferentes: não há alegação de cobertura visual validada para código não inspecionado.

## Rollback
Reverter esta PR restaura integralmente a apresentação anterior. Para desativar apenas o adaptador em um build, exportar `VITE_CHARTS_GLASS=false` no ambiente do processo Vite/Vitest. Não é flag de banco. O estilo azul/glass do progresso PCP é mudança separada revertida junto com a PR.

## Referência no Figma
Arquivo de trabalho: https://www.figma.com/design/zb7AsEvoEfIKAOiObLm4uw
A referência usa dados ilustrativos e a tipografia Outfit identificada no código. Não é evidência de implantação ou medição da produção.

import { normalizeReportPeriod } from '@/lib/reports/reportPeriodComparison';

export const REPORT_FORMATS = Object.freeze(['pdf', 'xlsx', 'csv']);
export const REPORT_FORMAT_OPTIONS = Object.freeze({
  pdf: { label: 'PDF — Relatório', description: 'Documento institucional para impressão e arquivo' },
  xlsx: { label: 'Excel — Relatório editável', description: 'Planilha profissional com KPIs, filtros e dados' },
  csv: { label: 'CSV — Dados brutos', description: 'Base simples para integração e BI' },
});
export const REPORT_COLUMN_TYPES = Object.freeze([
  'text', 'number', 'integer', 'percentage', 'date', 'datetime', 'duration', 'boolean',
]);

function normalizeFilters(filters) {
  if (!filters) return {};
  if (Array.isArray(filters)) {
    return Object.fromEntries(filters.filter((item) => item?.label).map((item) => [item.label, item.value ?? '']));
  }
  return { ...filters };
}

export function validateReportDefinition(report) {
  if (!report || typeof report !== 'object') throw new Error('Definição de relatório inválida.');
  if (!String(report.id || '').trim()) throw new Error('O relatório precisa de um identificador.');
  if (!String(report.title || '').trim()) throw new Error('O relatório precisa de um título.');
  normalizeReportPeriod(report.period);

  const tableIds = new Set();
  (report.tables || []).forEach((table) => {
    if (!table?.id || tableIds.has(table.id)) throw new Error('As tabelas do relatório precisam de identificadores únicos.');
    tableIds.add(table.id);
    if (!Array.isArray(table.columns) || table.columns.length === 0) throw new Error(`A tabela ${table.id} não possui colunas.`);
    table.columns.forEach((column) => {
      if (!column?.key || !column?.label) throw new Error(`A tabela ${table.id} possui uma coluna inválida.`);
      if (column.type && !REPORT_COLUMN_TYPES.includes(column.type)) throw new Error(`Tipo de coluna não suportado: ${column.type}.`);
    });
    if (!Array.isArray(table.rows)) throw new Error(`A tabela ${table.id} não possui linhas válidas.`);
  });
  return true;
}

export function createReportDefinition(input = {}) {
  const generatedAt = new Date(input.generatedAt || Date.now());
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Data de geração do relatório inválida.');

  const report = {
    id: String(input.id || '').trim(),
    title: String(input.title || '').trim(),
    subtitle: String(input.subtitle || ''),
    generatedAt: generatedAt.toISOString(),
    generatedBy: String(input.generatedBy || ''),
    period: normalizeReportPeriod(input.period),
    comparisonPeriod: input.comparisonPeriod ? normalizeReportPeriod(input.comparisonPeriod) : null,
    filters: normalizeFilters(input.filters),
    summary: Array.isArray(input.summary) ? input.summary : [],
    comparisons: Array.isArray(input.comparisons) ? input.comparisons : [],
    tables: Array.isArray(input.tables) ? input.tables : [],
    charts: Array.isArray(input.charts) ? input.charts : [],
    metadata: { ...(input.metadata || {}) },
  };

  validateReportDefinition(report);
  return report;
}

export function getReportTable(report, tableId) {
  if (tableId) return report?.tables?.find((table) => table.id === tableId) || null;
  return report?.tables?.find((table) => table.primary) || report?.tables?.[0] || null;
}

import { downloadBlob } from '@/lib/reportBranding';
import { getReportTable, validateReportDefinition } from '@/lib/reports/reportDefinition';
import {
  assertReportRowLimit,
  buildRawCsv,
  buildReportFilename,
} from '@/lib/reports/reportDataUtils';

export function createReportCsv(report, { tableId, delimiter = ';', includeBom = true } = {}) {
  validateReportDefinition(report);
  assertReportRowLimit(report, 'csv');
  const table = getReportTable(report, tableId);
  if (!table) throw new Error('O relatório não possui uma tabela de dados para CSV.');
  return buildRawCsv({ columns: table.columns, rows: table.rows, delimiter, includeBom });
}

export function exportReportCsv(report, options = {}) {
  const csv = createReportCsv(report, options);
  const filename = options.filename || buildReportFilename(report, 'csv');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  return { filename, rowCount: getReportTable(report, options.tableId)?.rows?.length || 0 };
}

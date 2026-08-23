import { REPORT_FORMATS, validateReportDefinition } from '@/lib/reports/reportDefinition';

export async function exportReport(report, formatName, options = {}) {
  validateReportDefinition(report);
  const format = String(formatName || '').toLowerCase();
  if (!REPORT_FORMATS.includes(format)) throw new Error(`Formato de relatório não suportado: ${format}.`);
  if (format === 'pdf') {
    const { exportReportPdf } = await import('@/lib/reports/reportPdfRenderer');
    return exportReportPdf(report, options);
  }
  if (format === 'xlsx') {
    const { exportReportExcel } = await import('@/lib/reports/reportExcelRenderer');
    return exportReportExcel(report, options);
  }
  const { exportReportCsv } = await import('@/lib/reports/reportCsvRenderer');
  return exportReportCsv(report, options);
}

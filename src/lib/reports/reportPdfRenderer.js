import { drawBrandedPdfFooter, drawBrandedPdfHeader, downloadBlob, REPORT_BRAND } from '@/lib/reportBranding';
import { validateReportDefinition } from '@/lib/reports/reportDefinition';
import {
  assertReportRowLimit,
  buildReportFilename,
  formatDatePtBr,
  formatDateTimePtBr,
  getColumnValue,
} from '@/lib/reports/reportDataUtils';
import { renderReportChartPng } from '@/lib/reports/reportChartImage';

function formatSummaryValue(item, value) {
  const number = Number(value) || 0;
  if (item.format === 'percentage') return number.toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (item.format === 'duration') return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
  return number.toLocaleString('pt-BR', { maximumFractionDigits: item.format === 'integer' ? 0 : 2 });
}

function summaryRows(report) {
  return report.summary.map((item) => ({
    label: item.label,
    value: `${formatSummaryValue(item, item.value)}${report.comparisonPeriod ? ` (anterior: ${formatSummaryValue(item, item.previous)})` : ''}`,
  }));
}

function pdfColumns(report) {
  const table = report.tables.find((item) => item.primary) || report.tables[0];
  if (!table) return { table: null, columns: [] };
  const explicitlySelected = table.columns.filter((column) => column.pdf === true);
  if (explicitlySelected.length) return { table, columns: explicitlySelected.slice(0, 10) };
  const preferred = new Set(['date', 'shift', 'cell', 'produced', 'target', 'attainment', 'scrap', 'downtime', 'operator', 'notes']);
  const selected = table.columns.filter((column) => column.pdf !== false && preferred.has(column.key));
  return { table, columns: selected.length ? selected : table.columns.filter((column) => column.pdf !== false).slice(0, 10) };
}

function printableCell(value, column) {
  if (value == null || value === '') return '—';
  if (column?.type === 'date') return formatDatePtBr(value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
  if (column?.type === 'datetime') return formatDateTimePtBr(value);
  if (column?.type === 'percentage') return Number(value).toLocaleString('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
  if (column?.type === 'duration') return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
  if (column?.type === 'number' || column?.type === 'integer') return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: column.type === 'integer' ? 0 : 2 });
  if (value instanceof Date) return value.toLocaleDateString('pt-BR');
  return String(value);
}

function drawTable(doc, report, startY) {
  const { table, columns } = pdfColumns(report);
  if (!table || !columns.length) return;
  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const printableWidth = pageWidth - margin * 2;
  const columnWidth = printableWidth / columns.length;
  let y = startY;

  const drawHeader = () => {
    doc.setFillColor(...REPORT_BRAND.primary);
    doc.rect(margin, y, printableWidth, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(6.5);
    columns.forEach((column, index) => {
      doc.text(String(column.label), margin + index * columnWidth + 1, y + 5, { maxWidth: columnWidth - 2 });
    });
    y += 8;
    doc.setTextColor(...REPORT_BRAND.ink);
    doc.setFont(undefined, 'normal');
  };

  if (y > pageHeight - 35) {
    doc.addPage();
    y = 14;
  }
  drawHeader();
  table.rows.forEach((row, rowIndex) => {
    if (y > pageHeight - 20) {
      doc.addPage();
      y = 14;
      drawHeader();
    }
    if (rowIndex % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, printableWidth, 7, 'F');
    }
    doc.setFontSize(6.3);
    columns.forEach((column, index) => {
      const value = printableCell(getColumnValue(row, column), column);
      const line = doc.splitTextToSize(value, columnWidth - 2)[0] || '';
      doc.text(line, margin + index * columnWidth + 1, y + 4.6);
    });
    y += 7;
  });
}

export async function createReportPdf(report, options = {}) {
  validateReportDefinition(report);
  assertReportRowLimit(report, 'pdf');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const periodLabel = `${formatDatePtBr(report.period.from)} a ${formatDatePtBr(report.period.to)}`;
  const comparisonLabel = report.comparisonPeriod
    ? ` · comparação ${formatDatePtBr(report.comparisonPeriod.from)} a ${formatDatePtBr(report.comparisonPeriod.to)}`
    : '';
  let y = await drawBrandedPdfHeader(doc, {
    title: report.title,
    subtitle: `${periodLabel}${comparisonLabel}`,
    summary: summaryRows(report),
    generatedAt: report.generatedAt,
    logoDataUrl: options.logoDataUrl,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  if (options.includeCharts !== false) {
    for (const chart of report.charts || []) {
      const image = await renderReportChartPng(chart, { width: 1400, height: 560 });
      if (!image) continue;
      const imageWidth = pageWidth - 28;
      const imageHeight = imageWidth * 0.4;
      if (y + imageHeight > pageHeight - 18) {
        doc.addPage();
        y = 14;
      }
      doc.addImage(image, 'PNG', 14, y, imageWidth, imageHeight, undefined, 'FAST');
      y += imageHeight + 7;
    }
  }

  drawTable(doc, report, y + 2);
  drawBrandedPdfFooter(doc);
  return doc;
}

export async function createReportPdfBuffer(report, options = {}) {
  const doc = await createReportPdf(report, options);
  return doc.output('arraybuffer');
}

export async function exportReportPdf(report, options = {}) {
  const doc = await createReportPdf(report, options);
  const filename = options.filename || buildReportFilename(report, 'pdf');
  if (options.download === false) {
    const buffer = doc.output('arraybuffer');
    return { filename, buffer };
  }
  if (typeof doc.save === 'function') doc.save(filename);
  else downloadBlob(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' }), filename);
  return { filename, pageCount: doc.getNumberOfPages() };
}

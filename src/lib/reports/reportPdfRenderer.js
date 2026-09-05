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
  if (value == null) return 'Sem base';
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

function drawTable(doc, report, startY, selectedTable) {
  const { table, columns } = selectedTable ? { table: selectedTable, columns: selectedTable.columns } : pdfColumns(report);
  if (!table || !columns.length) return startY;
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
  return y;
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
    summary: report.metadata?.analysis ? [] : summaryRows(report),
    generatedAt: report.generatedAt,
    logoDataUrl: options.logoDataUrl,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const paragraph = (text, bold = false) => {
    doc.setFont(undefined, bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10 : 9);
    doc.setTextColor(...REPORT_BRAND.ink);
    const lines = doc.splitTextToSize(String(text), pageWidth - 28);
    lines.forEach((line) => {
      if (y > pageHeight - 22) { doc.addPage(); y = 16; }
      doc.text(line, 14, y);
      y += 4.8;
    });
    y += 3;
  };
  paragraph(Object.entries(report.filters).map(([key, value]) => `${key}: ${value}`).join(' · '));
  if (report.metadata?.analysis) {
    paragraph('Indicadores do período', true);
    const metrics = report.summary.filter((item) => item.key !== 'downtime');
    const cardWidth = (pageWidth - 46) / 4;
    const cardHeight = report.comparisonPeriod ? 30 : 25;
    metrics.forEach((item, index) => {
      const column = index % 4;
      if (column === 0 && y + cardHeight > pageHeight - 22) { doc.addPage(); y = 16; }
      const x = 14 + column * (cardWidth + 6);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(...REPORT_BRAND.border);
      doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setTextColor(...REPORT_BRAND.muted);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.text(item.label, x + 4, y + 6, { maxWidth: cardWidth - 8 });
      doc.setTextColor(...REPORT_BRAND.primary);
      doc.setFont(undefined, 'bold');
      doc.setFontSize(15);
      doc.text(formatSummaryValue(item, item.value), x + 4, y + 17);
      if (report.comparisonPeriod) {
        doc.setTextColor(...REPORT_BRAND.muted);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(7.5);
        doc.text(`Anterior: ${formatSummaryValue(item, item.previous)}`, x + 4, y + 25);
      }
      if (column === 3 || index === metrics.length - 1) y += cardHeight + 5;
    });
    summaryRows(report).filter((_, index) => report.summary[index].key === 'downtime')
      .forEach((row) => paragraph(`${row.label}: ${row.value}`));
  }
  for (const insight of report.metadata?.insights || []) {
    if (y > pageHeight - 55) { doc.addPage(); y = 16; }
    paragraph(insight.title, true);
    paragraph(insight.evidence);
    paragraph(`Verificar: ${insight.action}`);
  }
  if (report.metadata?.methodology?.length) {
    paragraph('Critérios da análise', true);
    report.metadata.methodology.forEach((text) => paragraph(text));
  }
  const cellTable = report.tables.find((table) => table.id === 'production-by-cell');
  if (cellTable) {
    if (y > pageHeight - 65) { doc.addPage(); y = 16; }
    paragraph(cellTable.title, true);
    y = drawTable(doc, report, y, cellTable) + 10;
  }

  if (options.includeCharts !== false) {
    for (const chart of report.charts || []) {
      const chartHeight = report.metadata?.analysis ? 440 : 560;
      const image = await renderReportChartPng(chart, { width: 1400, height: chartHeight });
      if (!image) continue;
      const imageWidth = pageWidth - 28;
      const imageHeight = imageWidth * chartHeight / 1400;
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

import { jsPDF } from 'jspdf';
import { downloadBlob, drawBrandedPdfFooter, drawBrandedPdfHeader, loadLeoLogoDataUrl, REPORT_BRAND } from '@/lib/reportBranding';
import { createReportDefinition } from '@/lib/reports/reportDefinition';

const entryColumns = [
  { key: 'date', label: 'Data', type: 'date' },
  { key: 'shift', label: 'Turno' },
  { key: 'cell', label: 'Célula' },
  { key: 'hour', label: 'Hora' },
  { key: 'lot_code', label: 'Lote' },
  { key: 'order_number', label: 'Pedido' },
  { key: 'load_number', label: 'Carga' },
  { key: 'customer_trade_name', label: 'Cliente' },
  { key: 'customer_legal_name', label: 'Razão Social' },
  { key: 'product_name', label: 'Produto' },
  { key: 'route_name', label: 'Roteiro' },
  { key: 'finalization_date', label: 'Finalização', type: 'date' },
  { key: 'pallet_number', label: 'Pallet' },
  { key: 'process_step', label: 'Etapa' },
  { key: 'produced', label: 'Produzido', type: 'number' },
  { key: 'approved_quantity', label: 'Aprovado', type: 'number' },
  { key: 'rejected_quantity', label: 'Reprovado', type: 'number' },
  { key: 'pending_quantity', label: 'Pendente', type: 'number' },
  { key: 'target', label: 'Meta', type: 'number' },
  { key: 'scrap', label: 'Refugo', type: 'number' },
  { key: 'downtime', label: 'Parada (min)', type: 'duration' },
  { key: 'operator', label: 'Operador' },
  { key: 'occurrence_count', label: 'Ocorrências', type: 'integer' },
  { key: 'status', label: 'Status' },
];

function reportRows(report) {
  const occurrences = report.context.occurrences || [];
  return report.context.entries.map((entry) => {
    const produced = Number(entry.produced) || 0;
    const rejected = Number(entry.rejected_quantity ?? entry.scrap) || 0;
    const approved = Number(entry.approved_quantity) || Math.max(produced - rejected, 0);
    const pending = Number(entry.pending_quantity) || Math.max((Number(entry.target) || 0) - produced, 0);
    const occurrenceCount = occurrences.filter((item) => item.date === entry.date && item.shift === entry.shift && item.cell === entry.cell && (!entry.lot_code || !item.lot_code || item.lot_code === entry.lot_code)).length;
    return {
      ...entry,
      customer_trade_name: entry.customer_trade_name || entry.customer_name || '',
      approved_quantity: approved,
      rejected_quantity: rejected,
      pending_quantity: pending,
      occurrence_count: occurrenceCount,
      status: entry.traceability_status === 'limited' || (!entry.order_number && !entry.lot_code) ? 'Rastreabilidade limitada' : (entry.approval_status || 'valid'),
    };
  });
}

function safeName(value) {
  return String(value || 'relatorio-industrial').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function summaryRows(report) {
  const kpi = report.analysis.kpis;
  return [
    { label: 'Período', value: `${report.filters.startDate} a ${report.filters.endDate}` },
    { label: 'Produzido / Meta', value: `${kpi.produced.toLocaleString('pt-BR')} / ${kpi.target.toLocaleString('pt-BR')}` },
    { label: 'Eficiência', value: `${kpi.efficiency.toFixed(1)}%` },
    { label: 'Refugo', value: `${kpi.scrap.toLocaleString('pt-BR')} (${kpi.scrapRate.toFixed(1)}%)` },
    { label: 'Paradas', value: `${kpi.downtime.toLocaleString('pt-BR')} min` },
    { label: 'Rastreio', value: report.traceId },
  ];
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function buildReportHtml(report, logoDataUrl = '') {
  const rows = reportRows(report).slice(0, 5000);
  const summary = summaryRows(report);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(report.title)}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;margin:24px"><header style="background:#00522d;color:white;padding:20px;border-radius:6px;display:flex;align-items:center;gap:14px">${logoDataUrl ? `<img src="${logoDataUrl}" alt="Leo Madeiras" width="56" height="56" style="display:block;border-radius:6px">` : ''}<div><strong style="color:#fff200;font-size:24px">Leo Madeiras</strong><div>Leo Flow - Controle e Rastreabilidade</div></div></header><h1>${htmlEscape(report.title)}</h1><p>Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR')} por ${htmlEscape(report.generatedBy)}</p><table style="border-collapse:collapse;margin:16px 0">${summary.map((item) => `<tr><td style="padding:5px 16px 5px 0;color:#64748b">${htmlEscape(item.label)}</td><td style="font-weight:bold">${htmlEscape(item.value)}</td></tr>`).join('')}</table><h2>Recomendações</h2><ul>${report.analysis.recommendations.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul><h2>Dados</h2><table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${entryColumns.map((column) => `<th style="text-align:left;background:#f1f5f9;border:1px solid #cbd5e1;padding:6px">${htmlEscape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${entryColumns.map((column) => `<td style="border:1px solid #e2e8f0;padding:5px">${htmlEscape(row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}

export function toOperationalReportDefinition(report) {
  const generatedDate = new Date(report.generatedAt || Date.now());
  const fallbackDate = Number.isNaN(generatedDate.getTime()) ? new Date().toISOString().slice(0, 10) : generatedDate.toISOString().slice(0, 10);
  const startDate = report.filters?.startDate || fallbackDate;
  const endDate = report.filters?.endDate || startDate;
  const kpi = report.analysis?.kpis || {};
  return createReportDefinition({
    id: report.reportType || safeName(report.title),
    title: report.title,
    subtitle: `${startDate} a ${endDate}`,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy,
    period: { from: startDate, to: endDate },
    filters: report.filters || {},
    summary: [
      { key: 'produced', label: 'Produzido', value: Number(kpi.produced) || 0, format: 'integer' },
      { key: 'target', label: 'Meta', value: Number(kpi.target) || 0, format: 'integer' },
      { key: 'efficiency', label: 'Eficiência', value: (Number(kpi.efficiency) || 0) / 100, format: 'percentage' },
      { key: 'scrapRate', label: 'Taxa de refugo', value: (Number(kpi.scrapRate) || 0) / 100, format: 'percentage' },
      { key: 'downtime', label: 'Paradas', value: Number(kpi.downtime) || 0, format: 'duration' },
    ],
    tables: [{
      id: 'operational-data',
      title: 'Dados operacionais',
      sheet: 'data',
      primary: true,
      columns: entryColumns,
      rows: reportRows(report),
    }],
    metadata: { traceId: report.traceId, source: 'operational-report' },
  });
}

async function exportCsv(report) {
  const { exportReportCsv } = await import('@/lib/reports/reportCsvRenderer');
  return exportReportCsv(toOperationalReportDefinition(report));
}

async function exportExcel(report) {
  const { exportReportExcel } = await import('@/lib/reports/reportExcelRenderer');
  return exportReportExcel(toOperationalReportDefinition(report));
}

async function exportPdf(report) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let y = await drawBrandedPdfHeader(doc, { title: report.title, subtitle: `${report.filters.startDate} a ${report.filters.endDate}`, summary: summaryRows(report).slice(1) });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('Recomendações', margin, y);
  y += 5;
  doc.setFont(undefined, 'normal');
  report.analysis.recommendations.slice(0, 4).forEach((item) => {
    doc.text(`• ${item}`, margin, y, { maxWidth: pageW - margin * 2 });
    y += 5;
  });
  y += 3;

  const columns = entryColumns.filter((column) => [
    'order_number', 'lot_code', 'load_number', 'customer_legal_name', 'product_name',
    'route_name', 'pallet_number', 'cell', 'process_step', 'produced',
    'approved_quantity', 'rejected_quantity',
  ].includes(column.key));
  const widths = [22, 22, 16, 34, 36, 22, 18, 22, 22, 18, 18, 18];
  const drawHeader = () => {
    doc.setFillColor(...REPORT_BRAND.primary);
    doc.rect(margin, y, pageW - margin * 2, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    let x = margin + 1;
    columns.forEach((column, index) => { doc.text(column.label, x, y + 4.5); x += widths[index]; });
    y += 7;
    doc.setTextColor(...REPORT_BRAND.ink);
    doc.setFont(undefined, 'normal');
  };
  drawHeader();
  reportRows(report).slice(0, 1000).forEach((row, rowIndex) => {
    if (y > pageH - 20) { doc.addPage(); y = 15; drawHeader(); }
    if (rowIndex % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y, pageW - margin * 2, 6, 'F'); }
    let x = margin + 1;
    columns.forEach((column, index) => {
      const value = String(row[column.key] ?? '').slice(0, index === 6 ? 28 : 14);
      doc.text(value, x, y + 4, { maxWidth: widths[index] - 2 });
      x += widths[index];
    });
    y += 6;
  });
  drawBrandedPdfFooter(doc);
  doc.save(`${safeName(report.title)}.pdf`);
}

export async function exportOperationalReport(report, format = report.format) {
  if (!report) throw new Error('Gere o relatório antes de exportar.');
  if (format === 'pdf') return exportPdf(report);
  if (format === 'xlsx') return exportExcel(report);
  if (format === 'html') return downloadBlob(new Blob([buildReportHtml(report, await loadLeoLogoDataUrl())], { type: 'text/html;charset=utf-8' }), `${safeName(report.title)}.html`);
  return exportCsv(report);
}

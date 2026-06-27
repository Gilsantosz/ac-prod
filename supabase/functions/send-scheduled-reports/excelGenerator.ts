import { REPORT_TYPE_LABELS, LEO_LOGO_URL } from "./labels.ts";

export function safeFilename(value: string) {
  return (value || 'relatorio')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'relatorio';
}
function csvCell(value: any) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}
export function brandedAttachmentHeader(reportType: string, schedule: any) {
  return [
    ['Logomarca', 'Leo Madeiras'],
    ['Sistema', 'AC.Prod - Relatorios Industriais'],
    ['Relatorio', REPORT_TYPE_LABELS[reportType] || reportType],
    ['Agendamento', schedule?.name || ''],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    []
  ];
}
export function reportTable(reportType: string, data: any) {
  if (reportType === 'daily_production' || reportType === 'shift_closure' || reportType === 'oee') {
    const entries = data as any[];
    return {
      columns: ['Celula', 'Turno', 'Data', 'Produzido', 'Meta', 'Refugo', 'ParadasMinutos'],
      rows: entries.map(e => [e.cell || '', e.shift || '', e.date || '', e.produced || 0, e.target || 0, e.scrap || 0, e.downtime || 0])
    };
  }

  if (reportType === 'traceability_pending' || reportType === 'lots_delayed' || reportType === 'packaging_pending') {
    const lots = data as any[];
    return {
      columns: ['CodigoLote', 'OrdemProducao', 'Status', 'PrazoEntrega'],
      rows: lots.map(l => [l.lot_code || '', l.production_orders?.order_code || '', l.status || '', l.delivery_date || ''])
    };
  }

  if (reportType === 'shipping_pending') {
    const packages = data as any[];
    return {
      columns: ['CodigoEmbalagem', 'Volume', 'Status', 'Remessa', 'CriadoEm'],
      rows: packages.map(p => [p.package_code || '', p.volume_number || 1, p.status || '', p.shipments?.shipment_code || '', p.created_at || ''])
    };
  }

  if (reportType === 'executive_summary') {
    const summary = data as any;
    const occurrences = summary.activeOccurrences as any[];
    return {
      columns: ['Indicador', 'Celula', 'Motivo', 'ParadaMinutos', 'Notas'],
      rows: [
        ['Lotes em atraso', '', '', summary.delayedCount || 0, ''],
        ...occurrences.map(o => ['Ocorrencia aberta', o.cell || '', o.reason || '', o.downtime || 0, o.notes || ''])
      ]
    };
  }

  return {
    columns: ['Relatorio', 'GeradoEm'],
    rows: [[reportType, new Date().toISOString()]]
  };
}
export function generateReportCsv(reportType: string, data: any, schedule: any) {
  const table = reportTable(reportType, data);
  const rows = [
    ...brandedAttachmentHeader(reportType, schedule),
    table.columns,
    ...table.rows
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\n');
}
export function generateReportExcelHtml(reportType: string, data: any, schedule: any) {
  const table = reportTable(reportType, data);
  const headerRows = brandedAttachmentHeader(reportType, schedule).filter(row => row.length);
  const cell = (value: any) => String(value ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));

  return `<!doctype html>
  <html>
    <head><meta charset="utf-8" /></head>
    <body>
      <table>
        <tr>
          <td colspan="${Math.max(table.columns.length, 2)}" style="background:#00522d;color:#ffed00;font-size:20px;font-weight:bold;padding:12px;">
            <img src="${LEO_LOGO_URL}" width="54" height="54" style="vertical-align:middle;margin-right:12px;" />
            Leo Madeiras
          </td>
        </tr>
        ${headerRows.map(row => `<tr><td style="font-weight:bold;background:#f8fafc;">${cell(row[0])}</td><td colspan="${Math.max(table.columns.length - 1, 1)}">${cell(row[1])}</td></tr>`).join('')}
        <tr></tr>
        <tr>${table.columns.map(col => `<th style="background:#0f172a;color:#fff;padding:6px;">${cell(col)}</th>`).join('')}</tr>
        ${table.rows.map(row => `<tr>${row.map(value => `<td style="border:1px solid #dbe3ea;padding:6px;">${cell(value)}</td>`).join('')}</tr>`).join('')}
      </table>
    </body>
  </html>`;
}

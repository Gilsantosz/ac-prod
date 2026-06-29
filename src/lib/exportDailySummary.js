// Gera PDF do Resumo Diário com KPIs e tabelas por unidade.
import { jsPDF } from 'jspdf';
import { drawBrandedPdfFooter, drawBrandedPdfHeader } from '@/lib/reportBranding';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const attain = (t) => (Number(t.target) > 0 ? Math.round((Number(t.realized ?? t.produced) / Number(t.target)) * 100) : 0);

export async function exportDailySummaryPdf({ date, shift, cell, summary }) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  const shiftStr = Array.isArray(shift)
    ? (shift.length === 0 || shift.length === 3 ? 'Todos' : shift.join(', '))
    : (shift === 'all' ? 'Todos' : shift);

  const cellStr = Array.isArray(cell)
    ? (cell.length === 0 ? 'Todas' : cell.join(', '))
    : (cell === 'all' ? 'Todas' : cell);

  const t = summary.total;
  const totalsByUnit = summary.totalsByUnit || [];
  const totalTarget = totalsByUnit.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
  const totalRealized = totalsByUnit.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);
  const totalAttainment = totalTarget > 0 ? Math.round((totalRealized / totalTarget) * 100) : 0;
  let y = await drawBrandedPdfHeader(doc, {
    title: 'Resumo Diario de Producao',
    subtitle: `Data: ${date} | Turnos: ${shiftStr} | Celulas: ${cellStr}`,
    summary: [
      { label: 'Atingimento', value: `${totalAttainment}%` },
      ...totalsByUnit.slice(0, 3).map((row) => ({ label: `Realizado (${row.unitLabel})`, value: fmt(row.realized) })),
      { label: 'Refugo', value: `${fmt(t.scrap)} (${t.scrapRate}%)` },
      { label: 'Paradas (min)', value: fmt(t.downtime) },
    ],
  });

  // KPIs
  const kpis = [
    ['Atingimento', `${totalAttainment}%`],
    ...totalsByUnit.map((row) => [`Realizado (${row.unitLabel})`, fmt(row.realized)]),
    ['Refugo', `${fmt(t.scrap)} (${t.scrapRate}%)`],
    ['Paradas (min)', fmt(t.downtime)],
  ].slice(0, 6);
  y += 10;
  const colW = (pageW - 28) / kpis.length;
  kpis.forEach((k, i) => {
    const x = 14 + i * colW;
    doc.setDrawColor(226);
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y, colW - 3, 18, 'FD');
    doc.setFontSize(7.5);
    doc.setTextColor(100);
    doc.text(k[0], x + 3, y + 6);
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont(undefined, 'bold');
    doc.text(String(k[1]), x + 3, y + 13);
    doc.setFont(undefined, 'normal');
  });
  y += 28;

  const drawTable = (title, rows, keyField, keyLabel) => {
    if (y > 250) { doc.addPage(); y = 18; }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(title, 14, y);
    y += 6;

    const cols = [keyLabel, 'Unid.', 'Meta', 'Realizado', 'Dif.', 'Ef.', 'Paradas'];
    const widths = [42, 20, 25, 28, 25, 22, 24];
    doc.setFontSize(8);
    doc.setFillColor(15, 23, 42);
    doc.setTextColor(255);
    doc.rect(14, y, pageW - 28, 7, 'F');
    let x = 14;
    cols.forEach((c, i) => {
      doc.text(c, x + 2, y + 5);
      x += widths[i];
    });
    y += 7;
    doc.setTextColor(0);
    doc.setFont(undefined, 'normal');

    if (!rows.length) {
      doc.text('Sem dados', 16, y + 5);
      y += 10;
      return;
    }
    rows.forEach((r) => {
      if (y > 280) { doc.addPage(); y = 18; }
      const vals = [
        String(r[keyField]),
        r.unitLabel || '-',
        fmt(r.target),
        fmt(r.realized ?? r.produced),
        fmt(r.differenceTarget ?? ((Number(r.realized ?? r.produced) || 0) - (Number(r.target) || 0))),
        `${attain(r)}%`,
        fmt(r.downtime),
      ];
      let xx = 14;
      vals.forEach((v, i) => {
        doc.text(v, xx + 2, y + 5);
        xx += widths[i];
      });
      doc.setDrawColor(235);
      doc.line(14, y + 7, pageW - 14, y + 7);
      y += 7;
    });
    y += 8;
  };

  drawTable('Producao por Celula', summary.byCell, 'cell', 'Celula');
  drawTable('Producao por Turno', summary.byShift, 'shift', 'Turno');

  drawBrandedPdfFooter(doc);
  doc.save(`resumo-diario-${date}.pdf`);
}

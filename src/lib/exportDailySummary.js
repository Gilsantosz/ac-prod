// Gera PDF do Resumo Diário com KPIs e tabelas (por célula e por turno).
import { jsPDF } from 'jspdf';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const attain = (t) => (t.target > 0 ? Math.round((t.produced / t.target) * 100) : 0);

export function exportDailySummaryPdf({ date, shift, cell, summary }) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('Resumo Diário de Produção', 14, y);

  y += 7;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(100);

  const shiftStr = Array.isArray(shift)
    ? (shift.length === 0 || shift.length === 3 ? 'Todos' : shift.join(', '))
    : (shift === 'all' ? 'Todos' : shift);

  const cellStr = Array.isArray(cell)
    ? (cell.length === 0 ? 'Todas' : cell.join(', '))
    : (cell === 'all' ? 'Todas' : cell);

  doc.text(`Data: ${date}   |   Turnos: ${shiftStr}   |   Células: ${cellStr}`, 14, y);
  doc.setTextColor(0);

  // KPIs
  const t = summary.total;
  const kpis = [
    ['Meta Diária', `${fmt(t.target)} (${attain(t)}%)`],
    ['Produzido', fmt(t.produced)],
    ['Peças Boas', fmt(t.good)],
    ['Refugo', `${fmt(t.scrap)} (${t.scrapRate}%)`],
    ['Paradas (min)', fmt(t.downtime)],
  ];
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

    const cols = [keyLabel, 'Meta', 'Produzido', 'Boas', 'Refugo', '% Refugo', 'Paradas'];
    const widths = [50, 25, 28, 25, 22, 22, 22];
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
      const vals = [String(r[keyField]), fmt(r.target), fmt(r.produced), fmt(r.good), fmt(r.scrap), `${r.scrapRate}%`, fmt(r.downtime)];
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

  drawTable('Produção por Célula', summary.byCell, 'cell', 'Célula');
  drawTable('Produção por Turno', summary.byShift, 'shift', 'Turno');

  doc.save(`resumo-diario-${date}.pdf`);
}
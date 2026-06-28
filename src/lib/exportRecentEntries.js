import { jsPDF } from 'jspdf';
import { efficiency, sumBy } from '@/lib/productionMetrics';
import {
  buildBrandedCsv,
  downloadBlob,
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
} from '@/lib/reportBranding';

const COLS = [
  { key: 'date_time', label: 'Data/Hora' },
  { key: 'cell', label: 'Célula' },
  { key: 'shift', label: 'Turno' },
  { key: 'order_number', label: 'OP' },
  { key: 'lot_code', label: 'Lote' },
  { key: 'product_name', label: 'Produto' },
  { key: 'process_step', label: 'Etapa' },
  { key: 'produced', label: 'Prod' },
  { key: 'target', label: 'Meta' },
  { key: 'efficiency', label: 'Efic.' },
  { key: 'scrap', label: 'Refugo' },
];

export function exportRecentEntriesCSV(entries, filterLabel = 'Todos') {
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  const rows = entries.map(e => ({
    ...e,
    date_time: `${e.date} ${e.hour}`,
    order_number: e.order_number || '—',
    lot_code: e.lot_code || '—',
    product_name: e.product_name || '—',
    process_step: e.process_step || e.cell || '—',
    target: e.target || '—',
    efficiency: `${efficiency(e.produced, e.target)}%`,
    scrap: e.scrap || 0,
  }));

  const csv = buildBrandedCsv({
    title: 'Histórico Recente de Apontamentos',
    subtitle: `Filtro ativo: ${filterLabel}`,
    summary: [
      { label: 'Total Apontamentos', value: entries.length },
      { label: 'Total Produzido', value: totalProduced },
      { label: 'Total Refugo', value: totalScrap },
      { label: 'Eficiência Média', value: `${efficiency(totalProduced, totalTarget)}%` },
    ],
    columns: COLS,
    rows,
  });

  const timestamp = new Date().toISOString().split('T')[0];
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `historico-apontamentos-${timestamp}.csv`);
}

export async function exportRecentEntriesPDF(entries, filterLabel = 'Todos') {
  // Configura paisagem (landscape)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  const yStart = await drawBrandedPdfHeader(doc, {
    title: 'Histórico Recente de Apontamentos',
    subtitle: `Filtro ativo: ${filterLabel}`,
    summary: [
      { label: 'Total Apontamentos', value: entries.length },
      { label: 'Total Produzido', value: totalProduced },
      { label: 'Total Refugo', value: totalScrap },
      { label: 'Eficiência Média', value: `${efficiency(totalProduced, totalTarget)}%` },
    ],
  });

  let y = yStart;
  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();

  // Cabeçalho da Tabela
  doc.setFillColor(30, 30, 30);
  doc.setTextColor(255);
  doc.setFontSize(8.5);

  // printable area = 297 - 28 = 269mm. Posições X
  const xs = [14, 46, 68, 90, 125, 160, 210, 235, 247, 259, 271];
  const widths = [32, 22, 22, 35, 35, 50, 25, 12, 12, 12, 12];

  doc.rect(margin, y - 5, pageW - margin * 2, 7, 'F');
  COLS.forEach((c, i) => {
    if (['produced', 'target', 'efficiency', 'scrap'].includes(c.key)) {
      doc.text(c.label, xs[i] + widths[i] - 2, y, { align: 'right' });
    } else {
      doc.text(c.label, xs[i] + 1, y);
    }
  });
  y += 7;

  doc.setTextColor(40);
  doc.setFontSize(8);

  if (entries.length === 0) {
    doc.setTextColor(110);
    doc.text('Nenhum registro correspondente ao filtro ativo.', margin + 2, y);
  } else {
    entries.forEach((e) => {
      if (y > 185) {
        doc.addPage();
        y = 20;

        // Repete o cabeçalho
        doc.setFillColor(30, 30, 30);
        doc.setTextColor(255);
        doc.setFontSize(8.5);
        doc.rect(margin, y - 5, pageW - margin * 2, 7, 'F');
        COLS.forEach((c, i) => {
          if (['produced', 'target', 'efficiency', 'scrap'].includes(c.key)) {
            doc.text(c.label, xs[i] + widths[i] - 2, y, { align: 'right' });
          } else {
            doc.text(c.label, xs[i] + 1, y);
          }
        });
        y += 7;
        doc.setTextColor(40);
        doc.setFontSize(8);
      }

      const dateTime = `${e.date} ${e.hour}`;
      const cell = String(e.cell || '—');
      const shift = String(e.shift || '—');
      const op = String(e.order_number || '—');
      const lot = String(e.lot_code || '—');
      const product = String(e.product_name || '—').slice(0, 24);
      const step = String(e.process_step || e.cell || '—').slice(0, 13);
      const produced = String(e.produced);
      const target = String(e.target || '—');
      const eff = `${efficiency(e.produced, e.target)}%`;
      const scrap = String(e.scrap || 0);

      doc.text(dateTime, xs[0] + 1, y);
      doc.text(cell, xs[1] + 1, y);
      doc.text(shift, xs[2] + 1, y);
      doc.text(op, xs[3] + 1, y);
      doc.text(lot, xs[4] + 1, y);
      doc.text(product, xs[5] + 1, y);
      doc.text(step, xs[6] + 1, y);
      
      doc.text(produced, xs[7] + widths[7] - 2, y, { align: 'right' });
      doc.text(target, xs[8] + widths[8] - 2, y, { align: 'right' });
      doc.text(eff, xs[9] + widths[9] - 2, y, { align: 'right' });
      doc.text(scrap, xs[10] + widths[10] - 2, y, { align: 'right' });

      y += 6;
    });
  }

  drawBrandedPdfFooter(doc);
  const timestamp = new Date().toISOString().split('T')[0];
  doc.save(`historico-apontamentos-${timestamp}.pdf`);
}

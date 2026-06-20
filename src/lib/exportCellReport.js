import { jsPDF } from 'jspdf';
import { efficiency, scrapRate, sumBy } from '@/lib/productionMetrics';
import { drawBrandedPdfFooter, drawBrandedPdfHeader } from '@/lib/reportBranding';

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

// Gera um PDF formatado com o resumo diário de uma célula:
// eficiência, metas alcançadas e observações por turno.
export async function exportCellReport(cell, date, entries, filename) {
  const doc = new jsPDF();
  const cellEntries = entries.filter((e) => e.cell === cell && (!date || e.date === date));

  const totalProduced = sumBy(cellEntries, 'produced');
  const totalTarget = sumBy(cellEntries, 'target');
  const totalScrap = sumBy(cellEntries, 'scrap');
  const totalDowntime = sumBy(cellEntries, 'downtime');
  const overallEff = efficiency(totalProduced, totalTarget);

  let y = await drawBrandedPdfHeader(doc, {
    title: 'Relatorio de Producao por Celula',
    subtitle: `Celula: ${cell} | Data: ${date || 'Todas as datas'}`,
    summary: [
      { label: 'Produzido', value: totalProduced },
      { label: 'Meta', value: totalTarget },
      { label: 'Eficiencia', value: `${overallEff}%` },
      { label: 'Refugo', value: `${scrapRate(totalScrap, totalProduced)}%` },
      { label: 'Parada total', value: `${totalDowntime} min` },
    ],
  });

  // Resumo geral
  doc.setDrawColor(220);
  doc.setFillColor(245, 245, 245);
  doc.rect(14, y, 182, 16, 'F');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(
    `Produzido: ${totalProduced}    Meta: ${totalTarget}    Eficiência: ${overallEff}%`,
    18, y + 8
  );
  doc.text(
    `Refugo: ${scrapRate(totalScrap, totalProduced)}%    Parada total: ${totalDowntime} min    Registros: ${cellEntries.length}`,
    18, y + 14
  );

  y += 26;

  // Resumo por turno
  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.text('Resumo por Turno', 14, y);
  y += 8;

  SHIFTS.forEach((shift) => {
    const se = cellEntries.filter((e) => e.shift === shift);
    if (!se.length) return;

    if (y > 265) { doc.addPage(); y = 20; }

    const prod = sumBy(se, 'produced');
    const tgt = sumBy(se, 'target');
    const eff = efficiency(prod, tgt);
    const goalMet = tgt > 0 && prod >= tgt;

    doc.setFillColor(30, 30, 30);
    doc.rect(14, y - 5, 182, 7, 'F');
    doc.setTextColor(255);
    doc.setFontSize(10);
    doc.text(shift, 18, y);
    doc.text(goalMet ? 'META ATINGIDA' : 'META NÃO ATINGIDA', 150, y);
    y += 10;

    doc.setTextColor(40);
    doc.setFontSize(10);
    doc.text(`Produzido: ${prod}   Meta: ${tgt}   Eficiência: ${eff}%   Refugo: ${scrapRate(sumBy(se, 'scrap'), prod)}%`, 18, y);
    y += 7;

    // Observações do turno
    const notes = se.map((e) => e.notes).filter(Boolean);
    if (notes.length) {
      doc.setTextColor(90);
      doc.setFontSize(9);
      doc.text('Observações:', 18, y);
      y += 5;
      notes.forEach((n) => {
        if (y > 280) { doc.addPage(); y = 20; }
        const lines = doc.splitTextToSize(`• ${n}`, 174);
        doc.text(lines, 20, y);
        y += lines.length * 4.5;
      });
    }
    y += 6;
  });

  drawBrandedPdfFooter(doc);
  doc.save(filename || `relatorio-${cell}-${date || 'geral'}.pdf`);
}

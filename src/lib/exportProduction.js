import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { efficiency, scrapRate, sumBy } from '@/lib/productionMetrics';
import {
  buildBrandedCsv,
  downloadBlob,
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
} from '@/lib/reportBranding';

const COLS = [
  { key: 'date', label: 'Data' },
  { key: 'shift', label: 'Turno' },
  { key: 'cell', label: 'Célula' },
  { key: 'hour', label: 'Hora' },
  { key: 'produced', label: 'Produzido' },
  { key: 'target', label: 'Meta' },
  { key: 'scrap', label: 'Refugos' },
  { key: 'downtime', label: 'Parada (min)' },
  { key: 'operator', label: 'Operador' },
];

export function exportCSV(entries, filename = 'relatorio-producao.csv', meta = {}) {
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  const csv = buildBrandedCsv({
    title: meta.title || 'Relatorio de Producao',
    subtitle: meta.subtitle || '',
    summary: [
      { label: 'Produzido', value: totalProduced },
      { label: 'Meta', value: totalTarget },
      { label: 'Eficiencia', value: `${efficiency(totalProduced, totalTarget)}%` },
      { label: 'Refugo', value: `${scrapRate(totalScrap, totalProduced)}%` },
    ],
    columns: COLS,
    rows: entries,
  });

  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

function writeTable(doc, entries, startY) {
  let y = startY;
  doc.setFillColor(30, 30, 30);
  doc.setTextColor(255);
  doc.setFontSize(8);
  const xs = [14, 38, 58, 86, 102, 122, 142, 162, 188];
  doc.rect(14, y - 5, 182, 7, 'F');
  COLS.forEach((c, i) => doc.text(c.label, xs[i], y));
  y += 7;

  doc.setTextColor(40);
  entries.forEach((e) => {
    if (y > 285) {
      doc.addPage();
      y = 20;
    }
    COLS.forEach((c, i) => doc.text(String(e[c.key] ?? '—'), xs[i], y));
    y += 6;
  });
}

// Gera PDF incluindo a imagem dos gráficos do dashboard (elemento DOM)
export async function exportPDFWithCharts(entries, meta = {}, chartsEl, filename = 'relatorio-producao.pdf') {
  const doc = new jsPDF();
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  let y = await drawBrandedPdfHeader(doc, {
    title: meta.title || 'Relatorio de Producao',
    subtitle: meta.subtitle || '',
    summary: [
      { label: 'Produzido', value: totalProduced },
      { label: 'Meta', value: totalTarget },
      { label: 'Eficiencia', value: `${efficiency(totalProduced, totalTarget)}%` },
      { label: 'Refugo', value: `${scrapRate(totalScrap, totalProduced)}%` },
    ],
  });

  if (chartsEl) {
    const canvas = await html2canvas(chartsEl, { scale: 2, backgroundColor: '#ffffff', logging: false });
    const img = canvas.toDataURL('image/png');
    const pageW = 182;
    const imgH = (canvas.height * pageW) / canvas.width;
    doc.addImage(img, 'PNG', 14, y, pageW, imgH);
    y += imgH + 8;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
  }

  writeTable(doc, entries, y);
  drawBrandedPdfFooter(doc);
  doc.save(filename);
}

export async function exportPDF(entries, meta = {}, filename = 'relatorio-producao.pdf') {
  const doc = new jsPDF();
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  const y = await drawBrandedPdfHeader(doc, {
    title: meta.title || 'Relatorio de Producao',
    subtitle: meta.subtitle || '',
    summary: [
      { label: 'Produzido', value: totalProduced },
      { label: 'Meta', value: totalTarget },
      { label: 'Eficiencia', value: `${efficiency(totalProduced, totalTarget)}%` },
      { label: 'Refugo', value: `${scrapRate(totalScrap, totalProduced)}%` },
    ],
  });

  writeTable(doc, entries, y);
  drawBrandedPdfFooter(doc);
  doc.save(filename);
}

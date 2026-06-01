import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { efficiency, scrapRate, sumBy } from '@/lib/productionMetrics';

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

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(entries, filename = 'relatorio-producao.csv') {
  const header = COLS.map((c) => c.label).join(';');
  const rows = entries.map((e) =>
    COLS.map((c) => {
      const v = e[c.key] ?? '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(';')
  );
  const csv = '\uFEFF' + [header, ...rows].join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

function writeHeader(doc, entries, meta) {
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  doc.setFontSize(18);
  doc.setTextColor(20);
  doc.text(meta.title || 'Relatório de Produção', 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(meta.subtitle || '', 14, 25);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);

  doc.setTextColor(20);
  doc.setFontSize(11);
  doc.text(
    `Produzido: ${totalProduced}   Meta: ${totalTarget}   Eficiência: ${efficiency(totalProduced, totalTarget)}%   Refugo: ${scrapRate(totalScrap, totalProduced)}%`,
    14, 40
  );
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
  writeHeader(doc, entries, meta);

  let y = 50;
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
  doc.save(filename);
}

export function exportPDF(entries, meta = {}, filename = 'relatorio-producao.pdf') {
  const doc = new jsPDF();
  const totalProduced = sumBy(entries, 'produced');
  const totalTarget = sumBy(entries, 'target');
  const totalScrap = sumBy(entries, 'scrap');

  doc.setFontSize(18);
  doc.text(meta.title || 'Relatório de Produção', 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(meta.subtitle || '', 14, 25);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 30);

  doc.setTextColor(20);
  doc.setFontSize(11);
  doc.text(
    `Produzido: ${totalProduced}   Meta: ${totalTarget}   Eficiência: ${efficiency(totalProduced, totalTarget)}%   Refugo: ${scrapRate(totalScrap, totalProduced)}%`,
    14, 40
  );

  // Cabeçalho da tabela
  let y = 50;
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

  doc.save(filename);
}
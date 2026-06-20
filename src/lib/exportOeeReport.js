import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { worstFactor } from '@/lib/oeeMetrics';
import { drawBrandedPdfFooter, drawBrandedPdfHeader } from '@/lib/reportBranding';

// Gera um relatório de OEE + Ocorrências do turno em PDF.
// Pronto para impressão ou envio por e-mail. Se `chartsEl` for informado,
// os gráficos do dashboard são incluídos como imagem.
export async function exportOeeReport({ overall, byCell, occurrences = [], meta = {}, chartsEl }, filename = 'relatorio-oee.pdf') {
  const doc = new jsPDF();
  const M = 14;
  let y = await drawBrandedPdfHeader(doc, {
    title: meta.title || 'Relatorio de OEE',
    subtitle: meta.subtitle || '',
    summary: [
      { label: 'OEE global', value: `${overall.oee}%` },
      { label: 'Disponibilidade', value: `${overall.availability}%` },
      { label: 'Performance', value: `${overall.performance}%` },
      { label: 'Qualidade', value: `${overall.quality}%` },
    ],
  });

  // Resumo OEE global
  doc.setFillColor(30, 30, 30);
  doc.rect(M, y - 5, 182, 8, 'F');
  doc.setTextColor(255);
  doc.setFontSize(11);
  doc.text('Resumo Geral do Turno', M + 2, y);
  y += 10;

  doc.setTextColor(20);
  doc.setFontSize(11);
  const cards = [
    ['OEE Global', `${overall.oee}%`],
    ['Disponibilidade', `${overall.availability}%`],
    ['Performance', `${overall.performance}%`],
    ['Qualidade', `${overall.quality}%`],
  ];
  cards.forEach(([label, value], i) => {
    const x = M + i * 46;
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(label, x, y);
    doc.setFontSize(14);
    doc.setTextColor(20);
    doc.text(value, x, y + 7);
  });
  y += 16;

  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(
    `Produzido: ${overall.produced.toLocaleString('pt-BR')}   Meta: ${overall.target.toLocaleString('pt-BR')}   Refugos: ${overall.scrap}   Parada: ${Math.round(overall.downtimeMin)} min`,
    M, y
  );
  y += 12;

  // Tabela por célula
  doc.setFillColor(30, 30, 30);
  doc.setTextColor(255);
  doc.setFontSize(11);
  doc.rect(M, y - 5, 182, 8, 'F');
  doc.text('OEE por Célula', M + 2, y);
  y += 10;

  const cols = [
    { label: 'Célula', x: M },
    { label: 'OEE', x: M + 70 },
    { label: 'Disp.', x: M + 92 },
    { label: 'Perf.', x: M + 116 },
    { label: 'Qual.', x: M + 140 },
    { label: 'Pior fator', x: M + 162 },
  ];
  doc.setFontSize(8);
  doc.setTextColor(120);
  cols.forEach((c) => doc.text(c.label, c.x, y));
  y += 5;
  doc.setDrawColor(220);
  doc.line(M, y - 2, M + 182, y - 2);

  doc.setTextColor(40);
  byCell.forEach((r) => {
    if (y > 280) { doc.addPage(); y = 20; }
    const wf = worstFactor(r);
    doc.text(String(r.cell), cols[0].x, y);
    doc.text(`${r.oee}%`, cols[1].x, y);
    doc.text(`${r.availability}%`, cols[2].x, y);
    doc.text(`${r.performance}%`, cols[3].x, y);
    doc.text(`${r.quality}%`, cols[4].x, y);
    doc.text(`${wf.label}`, cols[5].x, y);
    y += 6;
  });
  y += 8;

  // Ocorrências do turno
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFillColor(30, 30, 30);
  doc.setTextColor(255);
  doc.setFontSize(11);
  doc.rect(M, y - 5, 182, 8, 'F');
  doc.text(`Ocorrências (${occurrences.length})`, M + 2, y);
  y += 10;

  if (occurrences.length === 0) {
    doc.setTextColor(120);
    doc.setFontSize(9);
    doc.text('Nenhuma ocorrência registrada para o período.', M, y);
  } else {
    const oc = [
      { label: 'Célula', x: M },
      { label: 'Motivo', x: M + 50 },
      { label: 'Parada', x: M + 130 },
      { label: 'Turno', x: M + 158 },
    ];
    doc.setFontSize(8);
    doc.setTextColor(120);
    oc.forEach((c) => doc.text(c.label, c.x, y));
    y += 5;
    doc.line(M, y - 2, M + 182, y - 2);
    doc.setTextColor(40);
    occurrences.forEach((o) => {
      if (y > 285) { doc.addPage(); y = 20; }
      doc.text(String(o.cell ?? '—'), oc[0].x, y);
      doc.text(String(o.reason ?? '—').slice(0, 40), oc[1].x, y);
      doc.text(`${o.downtime ?? 0} min`, oc[2].x, y);
      doc.text(String(o.shift ?? '—'), oc[3].x, y);
      y += 6;
    });
  }

  // Gráficos (imagem capturada do dashboard)
  if (chartsEl) {
    const canvas = await html2canvas(chartsEl, { scale: 2, backgroundColor: '#ffffff', logging: false });
    const img = canvas.toDataURL('image/png');
    const pageW = 182;
    const imgH = (canvas.height * pageW) / canvas.width;
    doc.addPage();
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text('Gráficos', M, 18);
    const imgY = 26;
    const maxH = 260;
    if (imgH <= maxH) {
      doc.addImage(img, 'PNG', M, imgY, pageW, imgH);
    } else {
      // Fallback simples: encaixa proporcionalmente na página.
      const scaled = maxH;
      const scaledW = (canvas.width * scaled) / canvas.height;
      doc.addImage(img, 'PNG', M, imgY, Math.min(pageW, scaledW), scaled);
    }
  }

  drawBrandedPdfFooter(doc);
  doc.save(filename);
}

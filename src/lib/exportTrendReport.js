// Gera PDF da Análise de Tendência capturando os gráficos da tela via html2canvas.
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { drawBrandedPdfFooter, drawBrandedPdfHeader } from '@/lib/reportBranding';

export async function exportTrendPdf({ month, containerEl }) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const startY = await drawBrandedPdfHeader(doc, {
    title: 'Analise de Tendencia',
    subtitle: `Mes: ${month}`,
  });

  const canvas = await html2canvas(containerEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const imgData = canvas.toDataURL('image/png');

  const imgW = pageW - 20;
  const imgH = (canvas.height * imgW) / canvas.width;

  let remaining = imgH;
  let position = startY;
  let srcY = 0;

  // Quebra em páginas se a imagem for maior que a página
  const pxPerMm = canvas.width / imgW;
  while (remaining > 0) {
    const availH = pageH - position - 10;
    const sliceH = Math.min(availH, remaining);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceH * pxPerMm;
    const ctx = sliceCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, srcY, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
    doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 10, position, imgW, sliceH);

    remaining -= sliceH;
    srcY += sliceCanvas.height;
    if (remaining > 0) {
      doc.addPage();
      position = 18;
    }
  }

  drawBrandedPdfFooter(doc);
  doc.save(`analise-tendencia-${month}.pdf`);
}

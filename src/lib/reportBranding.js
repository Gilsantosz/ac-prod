import leoLogoUrl from '@/assets/leo-madeiras-logo.jpg';
import { buildRawCsv, escapeCsvCell } from '@/lib/reports/reportDataUtils';

export const REPORT_BRAND = {
  company: 'Leo Madeiras',
  system: 'Leo Flow',
  primary: [0, 82, 45],
  yellow: [255, 237, 0],
  ink: [15, 23, 42],
  muted: [100, 116, 139],
  border: [226, 232, 240],
};

let logoDataUrlPromise = null;

export async function loadLeoLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(leoLogoUrl)
      .then((res) => res.blob())
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .catch(() => null);
  }
  return logoDataUrlPromise;
}

export async function drawBrandedPdfHeader(doc, {
  title,
  subtitle = '',
  summary = [],
  generatedAt = new Date(),
  logoDataUrl,
} = {}) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const logo = logoDataUrl === undefined ? await loadLeoLogoDataUrl() : logoDataUrl;

  doc.setFillColor(...REPORT_BRAND.primary);
  doc.roundedRect(margin, 10, pageW - margin * 2, 28, 4, 4, 'F');

  if (logo) {
    // Card flutuante com borda branca proeminente para destacar do fundo verde
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.8);
    doc.roundedRect(margin + 4, 13, 22, 22, 3.5, 3.5, 'FD');
    doc.addImage(logo, 'PNG', margin + 5, 14, 20, 20);
  }

  doc.setTextColor(...REPORT_BRAND.yellow);
  doc.setFontSize(15);
  doc.setFont(undefined, 'bold');
  doc.text(REPORT_BRAND.company, margin + 30, 21);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text(`${REPORT_BRAND.system} - Relatorios Industriais`, margin + 30, 28);

  let y = 48;
  doc.setTextColor(...REPORT_BRAND.ink);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  const titleLines = doc.splitTextToSize(title || 'Relatório Industrial', pageW - margin * 2);
  doc.text(titleLines, margin, y);

  y += Math.max(7, titleLines.length * 7);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...REPORT_BRAND.muted);
  if (subtitle) {
    const subtitleLines = doc.splitTextToSize(String(subtitle), pageW - margin * 2);
    doc.text(subtitleLines, margin, y);
    y += Math.max(5, subtitleLines.length * 5);
  }
  const generatedDate = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  doc.text(`Gerado em: ${(Number.isNaN(generatedDate.getTime()) ? new Date() : generatedDate).toLocaleString('pt-BR')}`, margin, y);
  y += 9;

  const rows = summary.filter((row) => row?.label);
  if (rows.length) {
    doc.setDrawColor(...REPORT_BRAND.border);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, pageW - margin * 2, 12 + rows.length * 5, 3, 3, 'FD');
    y += 8;
    rows.forEach((row) => {
      doc.setFontSize(8.5);
      doc.setTextColor(...REPORT_BRAND.muted);
      doc.text(`${row.label}:`, margin + 4, y);
      doc.setTextColor(...REPORT_BRAND.ink);
      doc.setFont(undefined, 'bold');
      doc.text(String(row.value ?? ''), margin + 36, y);
      doc.setFont(undefined, 'normal');
      y += 5;
    });
    y += 8;
  }

  doc.setTextColor(...REPORT_BRAND.ink);
  return y;
}

export function drawBrandedPdfFooter(doc) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...REPORT_BRAND.border);
    doc.line(14, pageH - 13, pageW - 14, pageH - 13);
    doc.setFontSize(8);
    doc.setTextColor(...REPORT_BRAND.muted);
    doc.text(`${REPORT_BRAND.company} - ${REPORT_BRAND.system}`, 14, pageH - 8);
    doc.text(`Pagina ${i}/${pageCount}`, pageW - 34, pageH - 8);
  }
}

export function escapeCsv(value, delimiter = ';') {
  return escapeCsvCell(value, delimiter);
}

export function buildBrandedCsv({ columns = [], rows = [], delimiter = ';' }) {
  // Compatibilidade para consumidores legados: CSV agora representa somente dados brutos.
  return buildRawCsv({ columns, rows, delimiter, includeBom: true });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

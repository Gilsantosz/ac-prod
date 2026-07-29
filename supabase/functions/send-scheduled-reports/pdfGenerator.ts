import { Buffer } from "node:buffer";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { REPORT_TYPE_LABELS, LEO_LOGO_URL } from "./labels.ts";
import { reportTable, brandedAttachmentHeader } from "./excelGenerator.ts";

async function embedReportLogo(pdf: PDFDocument) {
  try {
    const response = await fetch(LEO_LOGO_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const isPng = bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47;
    const isJpeg = bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;

    if (isPng) return await pdf.embedPng(bytes);
    if (isJpeg) return await pdf.embedJpg(bytes);
    throw new Error('formato de imagem não reconhecido');
  } catch (error) {
    // O relatório continua válido mesmo se o ativo externo estiver
    // temporariamente indisponível. O cabeçalho textual preserva a marca.
    console.warn(
      '[MES Scheduler] Logotipo não incorporado ao PDF:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function generateReportPdf(reportType: string, data: any, schedule: any) {
  const table = reportTable(reportType, data);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedReportLogo(pdf);
  let page = pdf.addPage([595, 842]);
  let y = 792;

  const addPage = () => {
    page = pdf.addPage([595, 842]);
    y = 792;
  };

  page.drawRectangle({ x: 40, y: 772, width: 515, height: 48, color: rgb(0, 0.32, 0.18) });
  if (logo) {
    page.drawImage(logo, { x: 48, y: 778, width: 36, height: 36 });
  } else {
    page.drawRectangle({ x: 48, y: 778, width: 36, height: 36, color: rgb(0, 0.22, 0.12) });
    page.drawText('LEO', { x: 54, y: 790, size: 9, font: bold, color: rgb(1, 0.93, 0) });
  }
  page.drawText('Leo Madeiras', { x: 96, y: 800, size: 16, font: bold, color: rgb(1, 0.93, 0) });
  page.drawText('Leo Flow - Relatorios Industriais', { x: 96, y: 784, size: 10, font, color: rgb(1, 1, 1) });

  y = 742;
  page.drawText(REPORT_TYPE_LABELS[reportType] || reportType, { x: 40, y, size: 16, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 18;
  page.drawText(`Agendamento: ${schedule?.name || ''}`, { x: 40, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) });
  y -= 14;
  page.drawText(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { x: 40, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) });
  y -= 24;

  const colCount = table.columns.length || 1;
  const colW = 515 / colCount;
  table.columns.forEach((col, i) => {
    page.drawRectangle({ x: 40 + i * colW, y: y - 5, width: colW, height: 16, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(String(col).slice(0, 16), { x: 44 + i * colW, y, size: 7, font: bold, color: rgb(1, 1, 1) });
  });
  y -= 18;

  table.rows.slice(0, 120).forEach((row) => {
    if (y < 50) {
      addPage();
    }
    row.forEach((value, i) => {
      page.drawText(String(value ?? '').slice(0, 24), { x: 44 + i * colW, y, size: 7, font, color: rgb(0.12, 0.16, 0.22) });
    });
    y -= 13;
  });

  if (table.rows.length > 120) {
    if (y < 50) addPage();
    page.drawText(`Exibidas 120 de ${table.rows.length} linhas. Use CSV/Excel para a base completa.`, { x: 40, y, size: 8, font, color: rgb(0.39, 0.45, 0.55) });
  }

  return pdf.save();
}

import { downloadBlob, loadLeoLogoDataUrl, REPORT_BRAND } from '@/lib/reportBranding';
import { validateReportDefinition } from '@/lib/reports/reportDefinition';
import {
  assertReportRowLimit,
  buildReportFilename,
  formatDatePtBr,
  formatDateTimePtBr,
  getColumnValue,
  parseIsoDateLocal,
  sanitizeSpreadsheetText,
} from '@/lib/reports/reportDataUtils';
import { renderReportChartPng } from '@/lib/reports/reportChartImage';

const BORDER = { style: 'thin', color: { argb: 'FFE2E8F0' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00522D' } };
const SUBTLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

function rgbToArgb(rgb) {
  return `FF${rgb.map((value) => Number(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

async function loadExcelJs() {
  const module = await import('exceljs');
  return module.default || module;
}

function formatFilterValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value === '' || value == null) return 'Todos';
  return String(value);
}

function valueForExcel(value, column) {
  if (value == null || value === '') return null;
  if (column.type === 'date') return parseIsoDateLocal(value);
  if (column.type === 'datetime') {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? sanitizeSpreadsheetText(String(value)) : date;
  }
  if (['number', 'integer', 'percentage', 'duration'].includes(column.type)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (column.type === 'boolean') return Boolean(value);
  return sanitizeSpreadsheetText(String(value));
}

function applyNumberFormat(cell, formatName) {
  if (formatName === 'percentage') cell.numFmt = '0.0%';
  else if (formatName === 'integer') cell.numFmt = '#,##0';
  else if (formatName === 'duration') cell.numFmt = '#,##0.0 "min"';
  else if (formatName === 'number') cell.numFmt = '#,##0.00';
  else if (formatName === 'date') cell.numFmt = 'dd/mm/yyyy';
  else if (formatName === 'datetime') cell.numFmt = 'dd/mm/yyyy hh:mm';
}

function styleHeaderRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  });
}

function comparisonCellValue(comparison) {
  if (!comparison || comparison.delta == null) return { value: 'Sem base comparativa', numFmt: null };
  if (comparison.mode === 'points') {
    return { value: comparison.delta, numFmt: '+0.0 "p.p.";-0.0 "p.p.";0.0 "p.p."' };
  }
  return { value: comparison.delta / 100, numFmt: '+0.0%;-0.0%;0.0%' };
}

function assessmentLabel(comparison) {
  if (!comparison || comparison.delta == null) return 'Sem base comparativa';
  const arrow = comparison?.direction === 'up' ? '▲' : comparison?.direction === 'down' ? '▼' : '■';
  const label = comparison?.assessment === 'positive' ? 'Favorável' : comparison?.assessment === 'negative' ? 'Desfavorável' : 'Neutro';
  return `${arrow} ${label}`;
}

async function addSummaryWorksheet(workbook, report, options) {
  const worksheet = workbook.addWorksheet('RESUMO', {
    properties: { tabColor: { argb: rgbToArgb(REPORT_BRAND.primary) } },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  worksheet.columns = [32, 22, 22, 20, 26, 18, 18, 18].map((width) => ({ width }));

  for (let rowNumber = 1; rowNumber <= 5; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = rowNumber === 1 ? 27 : 22;
    for (let column = 1; column <= 8; column += 1) row.getCell(column).fill = HEADER_FILL;
  }
  worksheet.mergeCells('C1:H1');
  worksheet.mergeCells('C2:H2');
  worksheet.mergeCells('C3:H3');
  worksheet.mergeCells('C4:H4');
  worksheet.mergeCells('C5:H5');
  worksheet.getCell('C1').value = REPORT_BRAND.company;
  worksheet.getCell('C1').font = { bold: true, size: 20, color: { argb: rgbToArgb(REPORT_BRAND.yellow) } };
  worksheet.getCell('C2').value = `${REPORT_BRAND.system} — Relatórios Industriais`;
  worksheet.getCell('C2').font = { size: 11, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell('C3').value = report.title;
  worksheet.getCell('C3').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell('C4').value = report.subtitle;
  worksheet.getCell('C4').font = { size: 10, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell('C5').value = `Gerado em ${formatDateTimePtBr(report.generatedAt)}${report.generatedBy ? ` por ${sanitizeSpreadsheetText(report.generatedBy)}` : ''}`;
  worksheet.getCell('C5').font = { size: 9, color: { argb: 'FFFFFFFF' } };

  if (options.includeLogo !== false) {
    const logo = options.logoDataUrl === undefined ? await loadLeoLogoDataUrl() : options.logoDataUrl;
    if (logo) {
      const extension = /^data:image\/(jpe?g)/i.test(logo) ? 'jpeg' : 'png';
      const imageId = workbook.addImage({ base64: logo, extension });
      worksheet.addImage(imageId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 125, height: 75 } });
    }
  }

  let rowNumber = 7;
  worksheet.getCell(rowNumber, 1).value = 'Período analisado';
  worksheet.getCell(rowNumber, 2).value = `${formatDatePtBr(report.period.from)} a ${formatDatePtBr(report.period.to)}`;
  worksheet.getCell(rowNumber, 4).value = 'Período comparativo';
  worksheet.getCell(rowNumber, 5).value = report.comparisonPeriod
    ? `${formatDatePtBr(report.comparisonPeriod.from)} a ${formatDatePtBr(report.comparisonPeriod.to)}`
    : 'Não aplicável';
  worksheet.getRow(rowNumber).font = { bold: true, color: { argb: 'FF334155' } };
  rowNumber += 2;

  worksheet.getCell(rowNumber, 1).value = 'Filtros aplicados';
  worksheet.getCell(rowNumber, 1).font = { bold: true, size: 12, color: { argb: rgbToArgb(REPORT_BRAND.primary) } };
  rowNumber += 1;
  Object.entries(report.filters || {}).forEach(([label, value]) => {
    worksheet.getCell(rowNumber, 1).value = sanitizeSpreadsheetText(label);
    worksheet.getCell(rowNumber, 2).value = sanitizeSpreadsheetText(formatFilterValue(value));
    worksheet.getCell(rowNumber, 1).font = { bold: true };
    rowNumber += 1;
  });

  rowNumber += 1;
  const header = worksheet.getRow(rowNumber);
  ['Indicador', 'Atual', 'Anterior', 'Variação', 'Leitura'].forEach((label, index) => { header.getCell(index + 1).value = label; });
  styleHeaderRow(header);
  const comparisonByKey = new Map(report.comparisons.map((item) => [item.key, item]));

  report.summary.forEach((item) => {
    const comparison = comparisonByKey.get(item.key);
    const row = worksheet.getRow(++rowNumber);
    row.getCell(1).value = sanitizeSpreadsheetText(item.label);
    row.getCell(2).value = item.value;
    row.getCell(3).value = item.previous ?? null;
    applyNumberFormat(row.getCell(2), item.format);
    applyNumberFormat(row.getCell(3), item.format);
    const variation = comparisonCellValue(comparison);
    row.getCell(4).value = variation.value;
    if (variation.numFmt) row.getCell(4).numFmt = variation.numFmt;
    row.getCell(5).value = assessmentLabel(comparison);
    row.height = 30;
    row.alignment = { wrapText: true, vertical: 'middle' };
    row.getCell(1).font = { bold: true };
    row.eachCell((cell) => { cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }; });
    if (rowNumber % 2 === 0) row.eachCell((cell) => { cell.fill = SUBTLE_FILL; });
  });

  if (options.includeCharts !== false) {
    let chartRow = rowNumber + 3;
    for (const chart of report.charts || []) {
      const imageData = await renderReportChartPng(chart);
      if (!imageData) continue;
      const imageId = workbook.addImage({ base64: imageData, extension: 'png' });
      worksheet.addImage(imageId, { tl: { col: 0, row: chartRow - 1 }, ext: { width: 760, height: 340 } });
      chartRow += 19;
    }
  }

  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return worksheet;
}

function styleDataCell(cell, column, rowNumber) {
  applyNumberFormat(cell, column.type);
  cell.alignment = { vertical: 'top', wrapText: column.type === 'text' };
  cell.border = { bottom: BORDER };
  if (rowNumber % 2 === 1) cell.fill = ALT_FILL;
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function addDataWorksheet(workbook, table) {
  const worksheet = workbook.addWorksheet('DADOS', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: 'FF2563EB' } },
  });
  worksheet.columns = table.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: column.width || 16,
  }));
  styleHeaderRow(worksheet.getRow(1));
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: table.columns.length },
  };

  for (let offset = 0; offset < table.rows.length; offset += 2_000) {
    const chunk = table.rows.slice(offset, offset + 2_000);
    chunk.forEach((source) => {
      const values = table.columns.map((column) => valueForExcel(getColumnValue(source, column), column));
      const row = worksheet.addRow(values);
      if (table.id === 'production-data') {
        const address = (key) => row.getCell(table.columns.findIndex((c) => c.key === key) + 1).address;
        const p = address('produced'), t = address('target'), s = address('scrap');
        for (const [key, formula] of [
          ['attainment', `IF(${t}>0,${p}/${t},"")`],
          ['scrapRate', `IF((${p}+${s})>0,${s}/(${p}+${s}),"")`],
          ['gap', `IF(${t}>0,MAX(0,${t}-${p}),"")`],
        ]) {
          row.getCell(table.columns.findIndex((c) => c.key === key) + 1).value = { formula, result: source[key] ?? '' };
        }
      }
      row.eachCell({ includeEmpty: true }, (cell, columnIndex) => styleDataCell(cell, table.columns[columnIndex - 1], row.number));
    });
    if (offset + 2_000 < table.rows.length) await yieldToBrowser();
  }
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return worksheet;
}

async function addAnalysisWorksheet(workbook, tables) {
  if (!tables.length) return null;
  const worksheet = workbook.addWorksheet('ANÁLISE', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { tabColor: { argb: rgbToArgb(REPORT_BRAND.yellow) } },
  });
  let rowNumber = 1;

  for (const table of tables) {
    worksheet.mergeCells(rowNumber, 1, rowNumber, table.columns.length);
    const titleCell = worksheet.getCell(rowNumber, 1);
    titleCell.value = sanitizeSpreadsheetText(table.title || table.id);
    titleCell.font = { bold: true, size: 13, color: { argb: rgbToArgb(REPORT_BRAND.primary) } };
    rowNumber += 1;
    const header = worksheet.getRow(rowNumber);
    table.columns.forEach((column, index) => {
      header.getCell(index + 1).value = column.label;
      const currentWidth = worksheet.getColumn(index + 1).width || 0;
      worksheet.getColumn(index + 1).width = Math.max(currentWidth, column.width || 16);
    });
    styleHeaderRow(header);
    rowNumber += 1;

    for (const source of table.rows) {
      const row = worksheet.getRow(rowNumber);
      table.columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        cell.value = valueForExcel(getColumnValue(source, column), column);
        styleDataCell(cell, column, rowNumber);
      });
      rowNumber += 1;
    }
    rowNumber += 2;
  }
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return worksheet;
}

function addInsightsWorksheet(workbook, report) {
  if (!report.metadata?.insights?.length && !report.metadata?.methodology?.length) return;
  const sheet = workbook.addWorksheet('LEITURA E AÇÕES', { views: [{ state: 'frozen', ySplit: 2 }] });
  sheet.columns = [32, 65, 75, 24, 18, 22].map((width) => ({ width }));
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = 'Observações do período e acompanhamento das ações';
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF00522D' } };
  sheet.getRow(1).height = 30;
  sheet.addRow(['Observação', 'Evidência nos dados', 'Próxima verificação sugerida', 'Responsável', 'Prazo', 'Situação']);
  styleHeaderRow(sheet.getRow(2));
  for (const item of report.metadata.insights || []) {
    const row = sheet.addRow([item.title, item.evidence, item.action, '', '', 'A avaliar'].map(sanitizeSpreadsheetText));
    row.height = 84;
    row.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' }; cell.border = { bottom: BORDER }; });
    row.getCell(5).numFmt = 'dd/mm/yyyy';
    row.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"A avaliar,Em andamento,Concluída"'] };
  }
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, sheet.rowCount), column: 6 } };
  sheet.addRow([]);
  for (const text of [...(report.metadata.methodology || []),
    'Resumo, gráficos e observações representam a exportação. Edite a base DADOS para simular valores: atingimento, saldo e refugo da linha são recalculados. Gere um novo relatório no sistema para atualizar o resumo e as observações.']) {
    const row = sheet.addRow([sanitizeSpreadsheetText(text)]);
    sheet.mergeCells(row.number, 1, row.number, 6);
    row.height = 32;
    row.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
  }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

export async function createReportWorkbook(report, options = {}) {
  validateReportDefinition(report);
  assertReportRowLimit(report, 'xlsx');
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${REPORT_BRAND.company} — ${REPORT_BRAND.system}`;
  workbook.company = REPORT_BRAND.company;
  workbook.created = new Date(report.generatedAt);
  workbook.modified = new Date(report.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;

  await addSummaryWorksheet(workbook, report, options);
  const dataTable = report.tables.find((table) => table.sheet === 'data' || table.primary);
  if (dataTable) await addDataWorksheet(workbook, dataTable);
  await addAnalysisWorksheet(workbook, report.tables.filter((table) => table !== dataTable && table.sheet === 'analysis'));
  addInsightsWorksheet(workbook, report);
  return workbook;
}

export async function createReportXlsxBuffer(report, options = {}) {
  const workbook = await createReportWorkbook(report, options);
  return workbook.xlsx.writeBuffer();
}

export async function exportReportExcel(report, options = {}) {
  const buffer = await createReportXlsxBuffer(report, options);
  const filename = options.filename || buildReportFilename(report, 'xlsx');
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  return { filename, byteLength: buffer.byteLength };
}

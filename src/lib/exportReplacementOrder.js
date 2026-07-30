import { jsPDF } from 'jspdf';
import {
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
  REPORT_BRAND,
} from '@/lib/reportBranding';
import {
  formatStageName,
  REPLACEMENT_PRIORITY_LABELS,
  REPLACEMENT_STATUS_LABELS,
} from '@/lib/replacementService';

export const PROMOB_LABEL_SIZE_MM = Object.freeze({
  width: 100,
  height: 70,
});

const CODE39_PATTERNS = Object.freeze({
  0: 'nnwwnwnnn',
  1: 'wnnwnnnnw',
  2: 'nnwwnnnnw',
  3: 'wnwwnnnnn',
  4: 'nnnwwnnnw',
  5: 'wnnwwnnnn',
  6: 'nnwwwnnnn',
  7: 'nnnwnnwnw',
  8: 'wnnwnnwnn',
  9: 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
});

const safeText = (value, fallback = 'Não informado') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const safeDateTime = (value, fallback = 'Pendente') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('pt-BR');
};

const numericText = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
};

const joinAvailable = (values, separator = ' • ') =>
  values.filter((value) => value != null && value !== '').join(separator);

function normalizeBarcode(value) {
  const normalized = String(value || '')
    .toUpperCase()
    .replace(/[^0-9A-Z .\-$\/+%]/g, '-')
    .slice(0, 42);
  return normalized || 'SEM-CODIGO';
}

export function buildReplacementDocumentData(order = {}) {
  const original = order.original_piece || {};
  const replacement = order.replacement_piece || {};
  const route = Array.isArray(order.route_steps) && order.route_steps.length
    ? order.route_steps
    : (Array.isArray(original.route_steps) ? original.route_steps : []);
  const completedSteps = Array.isArray(replacement.completed_steps) && replacement.completed_steps.length
    ? replacement.completed_steps
    : (Array.isArray(original.completed_steps) ? original.completed_steps : []);

  const pieceName = safeText(
    original.piece_name || original.description || original.module_name,
    'Peça de produção',
  );
  const pieceCode = safeText(
    original.piece_uid
      || original.traceability_code
      || original.piece_code
      || order.original_piece_id,
    'SEM-CÓDIGO',
  );
  const traceabilityCode = safeText(
    original.traceability_code || original.piece_uid || original.piece_code || pieceCode,
    pieceCode,
  );
  const traceabilityEvents = Array.isArray(order.traceability_readings)
    ? order.traceability_readings.map((reading) => ({
        timestamp: safeDateTime(reading.created_at, 'Data não informada'),
        pieceType: reading.piece_id === replacement.id ? 'Substituta' : 'Original',
        tag: safeText(reading.tag_value, pieceCode),
        stage: formatStageName(reading.step_name),
        cell: safeText(reading.cell_name || reading.station_name, 'Célula não informada'),
        machine: safeText(reading.machine_name, '—'),
        operator: safeText(
          reading.operator_name_snapshot || reading.operator,
          'Operador não informado',
        ),
        shift: safeText(reading.shift, '—'),
        status: safeText(reading.status),
        eventType: safeText(reading.entry_type || reading.event_type),
        traceabilityType: safeText(reading.traceability_type, 'unitária'),
        notes: safeText(reading.notes, '—'),
      }))
    : [];
  const thickness = numericText(original.thickness);
  const width = numericText(original.width);
  const length = numericText(original.length || original.height);
  const cuttingDimensions = joinAvailable([
    length,
    width,
    thickness,
  ], ' × ');

  return {
    replacementCode: safeText(order.replacement_code || order.id, 'SEM-ORDEM'),
    status: REPLACEMENT_STATUS_LABELS[order.status]?.label || safeText(order.status),
    priority: REPLACEMENT_PRIORITY_LABELS[order.priority]?.label || safeText(order.priority, 'Normal'),
    requestedAt: safeDateTime(order.created_at),
    approvedAt: safeDateTime(order.approved_at),
    completedAt: safeDateTime(order.completed_at, 'Em andamento'),
    reason: safeText(order.reason),
    defect: safeText(order.defect_name || order.reason),
    notes: safeText(order.notes, 'Sem observações'),
    operator: safeText(order.operator_name, 'Operador não informado'),
    originCell: safeText(order.origin_cell_name, 'Célula não informada'),
    rejectionStage: formatStageName(order.rejection_stage || original.current_stage || 'Corte'),
    generalLot: safeText(
      order.resolved_general_lot || order.general_lot_code || original.general_lot_code,
      'Não informado',
    ),
    clientLot: safeText(
      order.resolved_client_lot || order.lot_code || original.lot_code,
      'Não informado',
    ),
    orderNumber: safeText(order.order_number || original.order_number),
    customerName: safeText(order.customer_name || original.customer_name),
    environmentName: safeText(
      order.environment_name || original.environment_name || original.environment,
      'Geral / Produção',
    ),
    pieceName,
    pieceCode,
    traceabilityCode,
    replacementPieceCode: safeText(
      replacement.piece_uid || replacement.traceability_code || replacement.piece_code,
      'Aguardando geração',
    ),
    material: safeText(original.material),
    color: safeText(original.color),
    thickness: thickness ? `${thickness} mm` : 'Não informada',
    width: width ? `${width} mm` : 'Não informada',
    length: length ? `${length} mm` : 'Não informada',
    cuttingDimensions: cuttingDimensions ? `${cuttingDimensions} mm` : 'Não informadas',
    grainDirection: safeText(original.grain_direction, 'Não informado'),
    edges: {
      front: safeText(original.edge_front, '—'),
      back: safeText(original.edge_back, '—'),
      left: safeText(original.edge_left, '—'),
      right: safeText(original.edge_right, '—'),
    },
    route: route.map(formatStageName),
    completedSteps: completedSteps.map(formatStageName),
    traceabilityEvents,
  };
}

function ensurePage(doc, y, requiredHeight = 20) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + requiredHeight <= pageHeight - 18) return y;
  doc.addPage();
  return 18;
}

function drawSectionTitle(doc, title, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(...REPORT_BRAND.border);
  doc.roundedRect(14, y, pageWidth - 28, 9, 2, 2, 'FD');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...REPORT_BRAND.ink);
  doc.text(title, 18, y + 6);
  return y + 14;
}

function drawKeyValueGrid(doc, rows, y) {
  const columns = 2;
  const gap = 6;
  const pageWidth = doc.internal.pageSize.getWidth();
  const cellWidth = (pageWidth - 28 - gap) / columns;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += columns) {
    const pair = rows.slice(rowIndex, rowIndex + columns).map((row) => {
      const valueLines = doc.splitTextToSize(safeText(row.value), cellWidth - 8);
      return {
        ...row,
        valueLines,
        height: Math.max(15, 10 + valueLines.length * 4),
      };
    });
    const pairHeight = Math.max(...pair.map((row) => row.height));
    y = ensurePage(doc, y, pairHeight + 4);

    pair.forEach((row, column) => {
      const x = 14 + column * (cellWidth + gap);
      doc.setDrawColor(...REPORT_BRAND.border);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, cellWidth, pairHeight, 2, 2, 'FD');
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...REPORT_BRAND.muted);
      doc.text(row.label.toUpperCase(), x + 4, y + 5);
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...REPORT_BRAND.ink);
      doc.text(row.valueLines, x + 4, y + 10);
    });

    y += pairHeight + 4;
  }

  return y;
}

function drawCode39(doc, value, x, y, maxWidth, height) {
  const encoded = `*${normalizeBarcode(value)}*`;
  const modules = [];

  [...encoded].forEach((character, characterIndex) => {
    const pattern = CODE39_PATTERNS[character] || CODE39_PATTERNS['-'];
    [...pattern].forEach((width, elementIndex) => {
      modules.push({
        bar: elementIndex % 2 === 0,
        width: width === 'w' ? 2.5 : 1,
      });
    });
    if (characterIndex < encoded.length - 1) modules.push({ bar: false, width: 1 });
  });

  const totalModules = modules.reduce((total, module) => total + module.width, 0);
  const scale = maxWidth / totalModules;
  let cursor = x;
  doc.setFillColor(0, 0, 0);
  modules.forEach((module) => {
    const width = module.width * scale;
    if (module.bar) doc.rect(cursor, y, width, height, 'F');
    cursor += width;
  });
}

export async function createReplacementTechnicalPdf(order) {
  const data = buildReplacementDocumentData(order);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = await drawBrandedPdfHeader(doc, {
    title: 'Relatório Técnico de Reposição',
    subtitle: 'Dados de fabricação, não conformidade e rastreabilidade da peça',
    summary: [
      { label: 'Ordem de reposição', value: data.replacementCode },
      { label: 'Status', value: data.status },
      { label: 'Prioridade', value: data.priority },
      { label: 'Lote geral', value: data.generalLot },
      { label: 'Lote do cliente', value: data.clientLot },
    ],
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  const pieceLines = doc.splitTextToSize(data.pieceName.toUpperCase(), pageWidth - 38);
  const highlightHeight = Math.max(25, 13 + pieceLines.length * 6);
  y = ensurePage(doc, y, highlightHeight + 5);
  doc.setFillColor(255, 249, 196);
  doc.setDrawColor(245, 158, 11);
  doc.setLineWidth(0.7);
  doc.roundedRect(14, y, pageWidth - 28, highlightHeight, 3, 3, 'FD');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(146, 64, 14);
  doc.text('PEÇA A REFAZER', 19, y + 7);
  doc.setFontSize(13);
  doc.setTextColor(...REPORT_BRAND.ink);
  doc.text(pieceLines, 19, y + 15);
  y += highlightHeight + 7;

  y = drawSectionTitle(doc, 'Identificação e rastreabilidade', y);
  y = drawKeyValueGrid(doc, [
    { label: 'Código / UID original', value: data.pieceCode },
    { label: 'Código de rastreio', value: data.traceabilityCode },
    { label: 'Código da substituta', value: data.replacementPieceCode },
    { label: 'Pedido', value: data.orderNumber },
    { label: 'Cliente', value: data.customerName },
    { label: 'Ambiente', value: data.environmentName },
  ], y);

  y = drawSectionTitle(doc, 'Informações de corte e acabamento', y);
  y = drawKeyValueGrid(doc, [
    { label: 'Material', value: data.material },
    { label: 'Cor / padrão', value: data.color },
    { label: 'Dimensões C × L × E', value: data.cuttingDimensions },
    { label: 'Sentido do veio', value: data.grainDirection },
    { label: 'Borda frontal / traseira', value: `${data.edges.front} / ${data.edges.back}` },
    { label: 'Borda esquerda / direita', value: `${data.edges.left} / ${data.edges.right}` },
  ], y);

  y = drawSectionTitle(doc, 'Não conformidade e reposição', y);
  y = drawKeyValueGrid(doc, [
    { label: 'Motivo / defeito', value: data.defect },
    { label: 'Célula de origem', value: data.originCell },
    { label: 'Etapa reprovada', value: data.rejectionStage },
    { label: 'Operador', value: data.operator },
    { label: 'Solicitada em', value: data.requestedAt },
    { label: 'Concluída em', value: data.completedAt },
  ], y);

  y = ensurePage(doc, y, 35);
  y = drawSectionTitle(doc, 'Rota produtiva e histórico de etapas', y);
  const routeText = data.route.length ? data.route.join('  >  ') : 'Rota não informada';
  const completedText = data.completedSteps.length
    ? data.completedSteps.join('  >  ')
    : 'Nenhuma etapa concluída na peça substituta';
  y = drawKeyValueGrid(doc, [
    { label: 'Rota completa', value: routeText },
    { label: 'Etapas concluídas', value: completedText },
  ], y);

  y = ensurePage(doc, y, 24);
  y = drawSectionTitle(doc, `Rastreabilidade física (${data.traceabilityEvents.length} eventos)`, y);
  if (data.traceabilityEvents.length === 0) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'italic');
    doc.setTextColor(...REPORT_BRAND.muted);
    doc.text('Nenhum apontamento físico foi localizado para as peças vinculadas.', 18, y);
    y += 10;
  } else {
    data.traceabilityEvents.forEach((event, index) => {
      y = ensurePage(doc, y, 19);
      const headline = `${index + 1}. ${event.timestamp} | ${event.pieceType} | ${event.stage} | ${event.status}`;
      const detail = `${event.cell} | ${event.machine} | ${event.operator} | ${event.shift} | ${event.eventType}`;
      const noteLines = doc.splitTextToSize(`Rastreio: ${event.tag} | ${event.notes}`, pageWidth - 40);

      doc.setDrawColor(...REPORT_BRAND.border);
      doc.setFillColor(index % 2 === 0 ? 248 : 255, index % 2 === 0 ? 250 : 255, index % 2 === 0 ? 252 : 255);
      const eventHeight = Math.max(16, 12 + noteLines.length * 3.5);
      doc.roundedRect(14, y, pageWidth - 28, eventHeight, 2, 2, 'FD');
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...REPORT_BRAND.ink);
      doc.text(headline, 18, y + 5);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(...REPORT_BRAND.muted);
      doc.text(detail, 18, y + 9);
      doc.text(noteLines, 18, y + 13);
      y += eventHeight + 3;
    });
  }

  y = ensurePage(doc, y, 30);
  y = drawSectionTitle(doc, 'Observações', y);
  const noteLines = doc.splitTextToSize(data.notes, pageWidth - 36);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...REPORT_BRAND.ink);
  doc.text(noteLines, 18, y);

  drawBrandedPdfFooter(doc);
  return doc;
}

export function createPromobReplacementLabelPdf(order) {
  const data = buildReplacementDocumentData(order);
  const { width, height } = PROMOB_LABEL_SIZE_MM;
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [height, width],
  });

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(2, 2, width - 4, height - 4);

  doc.setFillColor(...REPORT_BRAND.primary);
  doc.rect(2, 2, width - 4, 9, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(255, 255, 255);
  doc.text('LEO FLOW | ETIQUETA PROMOB - REPOSIÇÃO', 5, 8);
  doc.setTextColor(...REPORT_BRAND.yellow);
  doc.setFontSize(6.5);
  doc.text(data.replacementCode, width - 5, 8, { align: 'right' });

  doc.setFontSize(8.5);
  doc.setFont(undefined, 'bold');
  const pieceLines = doc.splitTextToSize(data.pieceName.toUpperCase(), width - 10).slice(0, 3);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(pieceLines.length > 2 ? 8.5 : 10);
  doc.text(pieceLines, 5, 16);

  const pieceBlockBottom = 16 + pieceLines.length * 4.2;
  doc.setDrawColor(0, 0, 0);
  doc.line(5, pieceBlockBottom + 1, width - 5, pieceBlockBottom + 1);

  const detailsY = pieceBlockBottom + 5;
  doc.setFontSize(5.8);
  doc.setFont(undefined, 'normal');
  const materialLines = doc.splitTextToSize(`MATERIAL: ${data.material}`, 42).slice(0, 2);
  doc.text(materialLines, 5, detailsY);
  const materialBottom = detailsY + materialLines.length * 3;
  doc.text(`COR: ${data.color}`, 5, materialBottom + 1);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8.5);
  doc.text(`CORTE: ${data.cuttingDimensions}`, 5, materialBottom + 5);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(5.8);
  doc.text(`VEIO: ${data.grainDirection}`, 5, materialBottom + 9);
  doc.text(`LOTE GERAL: ${data.generalLot}`, 53, detailsY);
  doc.text(`LOTE CLIENTE: ${data.clientLot}`, 53, detailsY + 3.5);
  doc.text(`PEDIDO: ${data.orderNumber}`, 53, detailsY + 7);
  doc.text(`BORDAS F/T: ${data.edges.front} / ${data.edges.back}`, 53, detailsY + 10.5);
  doc.text(`BORDAS E/D: ${data.edges.left} / ${data.edges.right}`, 53, detailsY + 14);

  const barcodeY = 51;
  drawCode39(doc, data.traceabilityCode, 5, barcodeY, width - 10, 8.5);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(6.5);
  doc.text(data.traceabilityCode, width / 2, barcodeY + 12, { align: 'center' });

  doc.setFont(undefined, 'normal');
  doc.setFontSize(5.2);
  const footerLine = doc.splitTextToSize(
    `Origem: ${data.originCell} | Etapa: ${data.rejectionStage} | Cliente: ${data.customerName}`,
    width - 10,
  )[0];
  doc.text(footerLine, 5, height - 4.2);

  return doc;
}

export async function downloadReplacementTechnicalPdf(order) {
  const doc = await createReplacementTechnicalPdf(order);
  const data = buildReplacementDocumentData(order);
  doc.save(`reposicao-${data.replacementCode}.pdf`);
}

export function printPromobReplacementLabel(order) {
  const doc = createPromobReplacementLabelPdf(order);
  const data = buildReplacementDocumentData(order);

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    doc.autoPrint();
    const printWindow = window.open(doc.output('bloburl'), '_blank', 'noopener,noreferrer');
    if (printWindow) return;
  }

  doc.save(`etiqueta-promob-${data.replacementCode}.pdf`);
}

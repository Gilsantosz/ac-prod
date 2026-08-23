// Gera PDF e Excel do Resumo Diário com KPIs, matriz por célula/turno e tabelas por unidade.
import { jsPDF } from 'jspdf';
import { drawBrandedPdfFooter, drawBrandedPdfHeader } from '@/lib/reportBranding';
import { createReportDefinition } from '@/lib/reports/reportDefinition';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const attain = (t) => (Number(t.target) > 0 ? Math.round((Number(t.realized ?? t.produced) / Number(t.target)) * 100) : 0);

const SHIFT_HOUR_KEYS = {
  '1º Turno': ['hoursShift1', 'shift1'],
  '2º Turno': ['hoursShift2', 'shift2'],
  '3º Turno': ['hoursShift3', 'shift3'],
};

function configuredShiftHours(cell, shift) {
  const [frontendKey, databaseKey] = SHIFT_HOUR_KEYS[shift] || [];
  const configured = frontendKey
    ? cell?.[frontendKey] ?? cell?.shift_hours?.[databaseKey]
    : null;
  const hours = Number(configured);
  return Number.isFinite(hours) && hours >= 0 ? hours : 8;
}

export function calculatePlannedMinutes(summary, cells = []) {
  const cellsByName = new Map(cells.map((item) => [String(item.name || '').trim(), item]));
  const activeCellShifts = new Set();

  (summary?.matrixByCell || []).forEach((row) => {
    Object.entries(row.shifts || {}).forEach(([shift, bucket]) => {
      if (
        Number(bucket?.entries) > 0
        || Number(bucket?.target) > 0
        || Number(bucket?.capacity) > 0
      ) {
        activeCellShifts.add(`${row.cell}||${shift}`);
      }
    });
  });

  return [...activeCellShifts].reduce((minutes, key) => {
    const separator = key.lastIndexOf('||');
    const cellName = key.slice(0, separator);
    const shift = key.slice(separator + 2);
    return minutes + (configuredShiftHours(cellsByName.get(cellName), shift) * 60);
  }, 0);
}

export function calculateDailyReportMetrics(summary, cells = []) {
  const total = summary?.total || {};
  const totalsByUnit = summary?.totalsByUnit || [];
  const totalTarget = totalsByUnit.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
  const totalRealized = totalsByUnit.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);
  const totalAttainment = totalTarget > 0 ? Math.round((totalRealized / totalTarget) * 100) : 0;
  const plannedMinutes = calculatePlannedMinutes(summary, cells);
  const availability = plannedMinutes > 0 ? Math.max((plannedMinutes - Number(total.downtime || 0)) / plannedMinutes, 0) : 0;
  const performance = totalTarget > 0 ? Math.min(totalRealized / totalTarget, 1.5) : 0;
  const quality = Number(total.produced) > 0 ? Math.max(Number(total.good) / Number(total.produced), 0) : 0;
  const oee = Math.round(availability * performance * quality * 1000) / 10;
  return { total, totalsByUnit, totalTarget, totalRealized, totalAttainment, plannedMinutes, availability, performance, quality, oee };
}

export async function exportDailySummaryPdf({ date, shift, cell, summary, cells = [] }) {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  const shiftStr = Array.isArray(shift)
    ? (shift.length === 0 || shift.length === 3 ? 'Todos' : shift.join(', '))
    : (shift === 'all' ? 'Todos' : shift);

  const cellStr = Array.isArray(cell)
    ? (cell.length === 0 ? 'Todas' : cell.join(', '))
    : (cell === 'all' ? 'Todas' : cell);

  const { total: t, totalsByUnit, totalAttainment, oee } = calculateDailyReportMetrics(summary, cells);
  let y = await drawBrandedPdfHeader(doc, {
    title: 'Resumo Diário de Produção',
    subtitle: `Data: ${date.split('-').reverse().join('/')} | Turnos: ${shiftStr} | Células: ${cellStr}`,
    summary: [
      { label: 'Atingimento', value: `${totalAttainment}%` },
      { label: 'OEE', value: `${oee}%` },
      ...totalsByUnit.slice(0, 3).map((row) => ({ label: `Realizado (${row.unitLabel})`, value: fmt(row.realized) })),
      { label: 'Refugo', value: `${fmt(t.scrap)} (${t.scrapRate}%)` },
      { label: 'Paradas (min)', value: fmt(t.downtime) },
    ],
  });

  // KPIs
  const kpis = [
    ['Atingimento', `${totalAttainment}%`],
    ['OEE', `${oee}%`],
    ...totalsByUnit.map((row) => [`Realizado (${row.unitLabel})`, fmt(row.realized)]),
    ['Refugo', `${fmt(t.scrap)} (${t.scrapRate}%)`],
    ['Paradas (min)', fmt(t.downtime)],
  ];
  y += 10;
  const columns = 3;
  const colW = (pageW - 28) / columns;
  kpis.forEach((k, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const x = 14 + column * colW;
    const cardY = y + row * 21;
    doc.setDrawColor(226);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(x, cardY, colW - 3, 18, 2, 2, 'FD');
    doc.setFontSize(7.5);
    doc.setTextColor(100);
    doc.text(k[0], x + 3, cardY + 6);
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.setFont(undefined, 'bold');
    doc.text(String(k[1]), x + 3, cardY + 13);
    doc.setFont(undefined, 'normal');
  });
  y += Math.ceil(kpis.length / columns) * 21 + 8;

  const drawProgress = (label, value, color = [22, 163, 74]) => {
    if (y > 260) { doc.addPage(); y = 18; }
    const width = pageW - 56;
    doc.setFontSize(8);
    doc.setTextColor(51);
    doc.text(label, 14, y + 4);
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(42, y, width, 5, 2, 2, 'F');
    doc.setFillColor(...color);
    const filledWidth = width * Math.min(Math.max(Number(value) || 0, 0), 100) / 100;
    if (filledWidth > 0) doc.roundedRect(42, y, filledWidth, 5, 2, 2, 'F');
    doc.text(`${Math.round((Number(value) || 0) * 10) / 10}%`, pageW - 13, y + 4, { align: 'right' });
    y += 9;
  };

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Indicadores e gráficos', 14, y);
  doc.setFont(undefined, 'normal');
  y += 7;
  drawProgress('Atingimento geral', totalAttainment);
  drawProgress('OEE', oee, oee >= 85 ? [22, 163, 74] : oee >= 60 ? [245, 158, 11] : [220, 38, 38]);
  totalsByUnit.forEach((row) => drawProgress(`Atingimento - ${row.unitLabel}`, attain(row)));
  y += 5;

  // 1. Tabela Detalhada: Produção por Célula, Turno e Unidade
  const drawCellShiftUnitTable = (title, rows) => {
    if (y > 240) { doc.addPage(); y = 18; }
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(title, 14, y);
    y += 6;

    const cols = ['Célula', 'Turno', 'Unid.', 'Meta', 'Realizado', 'Dif.', 'Ef. Meta', 'Paradas'];
    const widths = [34, 24, 18, 24, 25, 21, 18, 18];
    doc.setFontSize(8);
    doc.setFillColor(15, 23, 42);
    doc.setTextColor(255);
    doc.rect(14, y, pageW - 28, 7, 'F');
    let x = 14;
    cols.forEach((c, i) => {
      doc.text(c, x + 2, y + 5);
      x += widths[i];
    });
    y += 7;
    doc.setTextColor(0);
    doc.setFont(undefined, 'normal');

    if (!rows || !rows.length) {
      doc.text('Sem registros de produção para os filtros selecionados.', 16, y + 5);
      y += 10;
      return;
    }

    rows.forEach((r) => {
      if (y > 275) { doc.addPage(); y = 18; }
      const targetVal = Number(r.target) || 0;
      const realizedVal = Number(r.realized ?? r.produced) || 0;
      const diff = r.differenceTarget ?? (realizedVal - targetVal);
      const eff = r.efficiencyTarget ?? attain(r);
      const isGoalMet = targetVal > 0 ? realizedVal >= targetVal : (eff >= 100);

      const vals = [
        String(r.cell || '-'),
        String(r.shift || '-'),
        String(r.unitLabel || '-'),
        fmt(targetVal),
        fmt(realizedVal),
        fmt(diff),
        `${eff}%`,
        fmt(r.downtime),
      ];

      let xx = 14;
      vals.forEach((v, i) => {
        // Regras de Cores solicitadas:
        // Meta (i=3): Azul [37, 99, 235]
        // Realizado (i=4): Verde [22, 163, 74] se bateu meta, Preto [15, 23, 42] se não bateu
        // Diferença (i=5): Vermelho [220, 38, 38]
        // Eficiência (i=6): Verde [22, 163, 74] se bateu meta (>=100%), Preto [15, 23, 42] se não bateu
        if (i === 3) {
          doc.setTextColor(37, 99, 235); // AZUL nas metas
          doc.setFont(undefined, 'bold');
        } else if (i === 4) {
          if (isGoalMet) {
            doc.setTextColor(22, 163, 74); // VERDE para metas atingidas
          } else {
            doc.setTextColor(15, 23, 42); // PRETO para metas não batidas
          }
          doc.setFont(undefined, 'bold');
        } else if (i === 5) {
          doc.setTextColor(220, 38, 38); // VERMELHO para diferença
          doc.setFont(undefined, 'bold');
        } else if (i === 6) {
          if (eff >= 100 || isGoalMet) {
            doc.setTextColor(22, 163, 74); // VERDE para metas atingidas
          } else {
            doc.setTextColor(15, 23, 42); // PRETO para metas não batidas
          }
          doc.setFont(undefined, 'bold');
        } else {
          doc.setTextColor(15, 23, 42); // PRETO para texto padrão
          doc.setFont(undefined, 'normal');
        }

        doc.text(v, xx + 2, y + 5);
        xx += widths[i];
      });
      doc.setDrawColor(235);
      doc.line(14, y + 7, pageW - 14, y + 7);
      y += 7;
    });
    y += 8;
  };

  const drawTable = (title, rows, keyField, keyLabel) => {
    if (y > 250) { doc.addPage(); y = 18; }
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(title, 14, y);
    y += 6;

    const cols = [keyLabel, 'Unid.', 'Meta', 'Realizado', 'Dif.', 'Ef.', 'Paradas'];
    const widths = [42, 20, 25, 28, 25, 22, 24];
    doc.setFontSize(8);
    doc.setFillColor(15, 23, 42);
    doc.setTextColor(255);
    doc.rect(14, y, pageW - 28, 7, 'F');
    let x = 14;
    cols.forEach((c, i) => {
      doc.text(c, x + 2, y + 5);
      x += widths[i];
    });
    y += 7;
    doc.setTextColor(0);
    doc.setFont(undefined, 'normal');

    if (!rows.length) {
      doc.text('Sem dados', 16, y + 5);
      y += 10;
      return;
    }

    rows.forEach((r) => {
      if (y > 280) { doc.addPage(); y = 18; }
      const targetVal = Number(r.target) || 0;
      const realizedVal = Number(r.realized ?? r.produced) || 0;
      const diff = r.differenceTarget ?? (realizedVal - targetVal);
      const eff = attain(r);
      const isGoalMet = targetVal > 0 ? realizedVal >= targetVal : (eff >= 100);

      const vals = [
        String(r[keyField]),
        r.unitLabel || '-',
        fmt(targetVal),
        fmt(realizedVal),
        fmt(diff),
        `${eff}%`,
        fmt(r.downtime),
      ];

      let xx = 14;
      vals.forEach((v, i) => {
        // Regras de Cores solicitadas:
        // Meta (i=2): Azul [37, 99, 235]
        // Realizado (i=3): Verde [22, 163, 74] se bateu meta, Preto [15, 23, 42] se não bateu
        // Diferença (i=4): Vermelho [220, 38, 38]
        // Eficiência (i=5): Verde [22, 163, 74] se bateu meta (>=100%), Preto [15, 23, 42] se não bateu
        if (i === 2) {
          doc.setTextColor(37, 99, 235); // AZUL nas metas
          doc.setFont(undefined, 'bold');
        } else if (i === 3) {
          if (isGoalMet) {
            doc.setTextColor(22, 163, 74); // VERDE para metas atingidas
          } else {
            doc.setTextColor(15, 23, 42); // PRETO para metas não batidas
          }
          doc.setFont(undefined, 'bold');
        } else if (i === 4) {
          doc.setTextColor(220, 38, 38); // VERMELHO para diferença
          doc.setFont(undefined, 'bold');
        } else if (i === 5) {
          if (eff >= 100 || isGoalMet) {
            doc.setTextColor(22, 163, 74); // VERDE para metas atingidas
          } else {
            doc.setTextColor(15, 23, 42); // PRETO para metas não batidas
          }
          doc.setFont(undefined, 'bold');
        } else {
          doc.setTextColor(15, 23, 42); // PRETO para texto padrão
          doc.setFont(undefined, 'normal');
        }

        doc.text(v, xx + 2, y + 5);
        xx += widths[i];
      });
      doc.setDrawColor(235);
      doc.line(14, y + 7, pageW - 14, y + 7);
      y += 7;
    });
    y += 8;
  };

  // Renderizar tabelas em ordem lógica de detalhamento
  drawCellShiftUnitTable('Produção por Célula, Turno e Unidade de Medida', summary.byCellShift || []);
  drawTable('Totais por Unidade de Medida', summary.totalsByUnit || [], 'unitLabel', 'Unidade');
  drawTable('Produção Consolidada por Célula', summary.byCell || [], 'cell', 'Célula');
  drawTable('Produção Consolidada por Turno', summary.byShift || [], 'shift', 'Turno');

  drawBrandedPdfFooter(doc);
  doc.save(`resumo-diario-${date}.pdf`);
}

function selectionLabel(value, allLabel) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : allLabel;
  return !value || value === 'all' ? allLabel : value;
}

function normalizedSummaryRow(row = {}) {
  return {
    ...row,
    capacity: Number(row.capacity) || 0,
    target: Number(row.target) || 0,
    realized: Number(row.realized ?? row.produced) || 0,
    differenceTarget: Number(row.differenceTarget ?? ((row.realized ?? row.produced) - row.target)) || 0,
    efficiency: Number(row.efficiencyTarget ?? attain(row)) / 100,
    good: Number(row.good) || 0,
    scrap: Number(row.scrap) || 0,
    scrapRate: (Number(row.scrapRate) || 0) / 100,
    downtime: Number(row.downtime) || 0,
  };
}

export function createDailySummaryReport({ date, shift, cell, summary, cells = [], generatedBy = '' }) {
  const metrics = calculateDailyReportMetrics(summary, cells);
  const detailedRows = (summary.byCellShift || []).map(normalizedSummaryRow);
  const totalsByUnit = (summary.totalsByUnit || []).map(normalizedSummaryRow);
  const byCell = (summary.byCell || []).map(normalizedSummaryRow);
  const byShift = (summary.byShift || []).map(normalizedSummaryRow);
  const detailedColumns = [
    { key: 'cell', label: 'Célula', type: 'text', width: 22 },
    { key: 'shift', label: 'Turno', type: 'text', width: 16 },
    { key: 'unitLabel', label: 'Unidade de medida', type: 'text', width: 20 },
    { key: 'capacity', label: 'Capacidade', type: 'number', width: 14 },
    { key: 'target', label: 'Meta planejada', type: 'number', width: 16 },
    { key: 'realized', label: 'Produção realizada', type: 'number', width: 18 },
    { key: 'differenceTarget', label: 'Diferença da meta', type: 'number', width: 18 },
    { key: 'efficiency', label: 'Atingimento', type: 'percentage', width: 15 },
    { key: 'good', label: 'Peças boas', type: 'number', width: 14 },
    { key: 'scrap', label: 'Refugo', type: 'number', width: 12 },
    { key: 'scrapRate', label: 'Taxa de refugo', type: 'percentage', width: 16 },
    { key: 'downtime', label: 'Parada (min)', type: 'duration', width: 15 },
  ];
  const aggregateColumns = [
    { key: 'label', label: 'Agrupamento', type: 'text', width: 24 },
    { key: 'unitLabel', label: 'Unidade', type: 'text', width: 18 },
    { key: 'target', label: 'Meta', type: 'number', width: 14 },
    { key: 'realized', label: 'Realizado', type: 'number', width: 14 },
    { key: 'differenceTarget', label: 'Diferença', type: 'number', width: 14 },
    { key: 'efficiency', label: 'Atingimento', type: 'percentage', width: 15 },
    { key: 'scrap', label: 'Refugo', type: 'number', width: 12 },
    { key: 'downtime', label: 'Parada (min)', type: 'duration', width: 15 },
  ];
  const withLabel = (rows, field) => rows.map((row) => ({ ...row, label: row[field] || '—' }));

  return createReportDefinition({
    id: 'resumo-diario',
    title: 'Resumo Diário de Produção',
    subtitle: `Produção de ${date.split('-').reverse().join('/')}`,
    generatedAt: new Date().toISOString(),
    generatedBy,
    period: { from: date, to: date },
    filters: { Turnos: selectionLabel(shift, 'Todos'), Células: selectionLabel(cell, 'Todas') },
    summary: [
      { key: 'attainment', label: 'Atingimento', value: metrics.totalAttainment / 100, format: 'percentage' },
      { key: 'oee', label: 'OEE', value: metrics.oee / 100, format: 'percentage' },
      { key: 'scrapRate', label: 'Taxa de refugo', value: (Number(metrics.total.scrapRate) || 0) / 100, format: 'percentage' },
      { key: 'downtime', label: 'Paradas', value: Number(metrics.total.downtime) || 0, format: 'duration' },
      ...totalsByUnit.map((row, index) => ({ key: `realized-${index}`, label: `Realizado (${row.unitLabel})`, value: row.realized, format: 'number' })),
    ],
    tables: [
      { id: 'daily-detail', title: 'Produção por célula, turno e unidade', sheet: 'data', primary: true, columns: detailedColumns, rows: detailedRows },
      { id: 'daily-units', title: 'Totais por unidade', sheet: 'analysis', columns: aggregateColumns, rows: withLabel(totalsByUnit, 'unitLabel') },
      { id: 'daily-cells', title: 'Produção por célula', sheet: 'analysis', columns: aggregateColumns, rows: withLabel(byCell, 'cell') },
      { id: 'daily-shifts', title: 'Produção por turno', sheet: 'analysis', columns: aggregateColumns, rows: withLabel(byShift, 'shift') },
    ],
    charts: [{
      id: 'daily-production-target', title: 'Produção × Meta por unidade', type: 'line',
      categories: totalsByUnit.map((row) => row.unitLabel),
      series: [
        { name: 'Realizado', color: '#00522d', values: totalsByUnit.map((row) => row.realized) },
        { name: 'Meta', color: '#d6a900', values: totalsByUnit.map((row) => row.target) },
      ],
    }],
    metadata: { currentMetrics: metrics, source: 'daily-summary' },
  });
}

export async function exportDailySummaryExcel(payload) {
  const { exportReportExcel } = await import('@/lib/reports/reportExcelRenderer');
  return exportReportExcel(createDailySummaryReport(payload));
}

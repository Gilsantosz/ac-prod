import {
  cellBenchmark,
  executiveSummary,
  monthOverMonth,
  monthlyByCell,
  monthlySeries,
  nextMonthProjection,
  seasonalityAlerts,
} from '@/lib/reportMetrics';
import { efficiency, groupByCellUnit, scrapRate, sumBy } from '@/lib/productionMetrics';
import { createReportDefinition } from '@/lib/reports/reportDefinition';
import { buildMetricComparison } from '@/lib/reports/reportPeriodComparison';
import { formatDatePtBr } from '@/lib/reports/reportDataUtils';

const DATA_COLUMNS = [
  { key: 'date', label: 'Data', type: 'date', width: 13 },
  { key: 'shift', label: 'Turno', type: 'text', width: 16 },
  { key: 'cell', label: 'Célula', type: 'text', width: 22 },
  { key: 'hour', label: 'Hora', type: 'text', width: 10 },
  { key: 'produced', label: 'Produzido', type: 'number', width: 14 },
  { key: 'target', label: 'Meta', type: 'number', width: 14 },
  { key: 'attainment', label: 'Atingimento', type: 'percentage', width: 15 },
  { key: 'scrap', label: 'Refugo', type: 'number', width: 12 },
  { key: 'scrapRate', label: 'Taxa de refugo', type: 'percentage', width: 16 },
  { key: 'downtime', label: 'Parada (min)', type: 'duration', width: 15 },
  { key: 'operator', label: 'Operador', type: 'text', width: 22 },
  { key: 'notes', label: 'Observações', type: 'text', width: 36 },
];

const CELL_COLUMNS = [
  { key: 'cell', label: 'Célula', type: 'text', width: 24 },
  { key: 'unitLabel', label: 'Unidade', type: 'text', width: 18 },
  { key: 'produced', label: 'Produzido', type: 'number', width: 14 },
  { key: 'target', label: 'Meta', type: 'number', width: 14 },
  { key: 'efficiency', label: 'Atingimento', type: 'percentage', width: 15 },
  { key: 'scrap', label: 'Refugo', type: 'number', width: 12 },
  { key: 'scrapRate', label: 'Taxa de refugo', type: 'percentage', width: 16 },
  { key: 'downtime', label: 'Parada (min)', type: 'duration', width: 15 },
];

const MONTH_COLUMNS = [
  { key: 'label', label: 'Mês', type: 'text', width: 14 },
  { key: 'produced', label: 'Produzido', type: 'number', width: 14 },
  { key: 'target', label: 'Meta', type: 'number', width: 14 },
  { key: 'efficiency', label: 'Atingimento', type: 'percentage', width: 15 },
  { key: 'scrapRate', label: 'Taxa de refugo', type: 'percentage', width: 16 },
  { key: 'downtime', label: 'Parada (min)', type: 'duration', width: 15 },
];

function buildAnalysis(entries) {
  const series = monthlySeries(entries);
  return {
    series,
    byCell: monthlyByCell(entries),
    mom: monthOverMonth(series),
    alerts: seasonalityAlerts(entries, 15),
    summary: executiveSummary(entries),
    forecast: nextMonthProjection(series),
    benchmark: cellBenchmark(entries),
  };
}

function buildMetrics(entries) {
  const summary = executiveSummary(entries);
  const target = sumBy(entries, 'target');
  return { ...summary, target };
}

function filterLabel(filters, key, fallback) {
  const value = filters?.[key];
  return !value || value === 'all' ? fallback : value;
}

export function createProductionAnalysisReport(snapshot, { generatedBy = '' } = {}) {
  if (!snapshot?.period) throw new Error('Snapshot de produção inválido.');
  const entries = snapshot.entries || [];
  const comparisonEntries = snapshot.comparisonEntries || [];
  const currentMetrics = buildMetrics(entries);
  const previousMetrics = buildMetrics(comparisonEntries);
  const analysis = buildAnalysis(entries);

  const comparisons = [
    buildMetricComparison({ key: 'produced', label: 'Produção', current: currentMetrics.produced, previous: previousMetrics.produced }),
    buildMetricComparison({ key: 'target', label: 'Meta', current: currentMetrics.target, previous: previousMetrics.target }),
    buildMetricComparison({ key: 'oee', label: 'OEE', current: currentMetrics.oee, previous: previousMetrics.oee, mode: 'points' }),
    buildMetricComparison({ key: 'scrapRate', label: 'Taxa de refugo', current: currentMetrics.scrapRate, previous: previousMetrics.scrapRate, mode: 'points', lowerIsBetter: true }),
    buildMetricComparison({ key: 'downtime', label: 'Downtime', current: currentMetrics.downtime, previous: previousMetrics.downtime, lowerIsBetter: true }),
  ];

  const summary = [
    { key: 'produced', label: 'Produção', value: currentMetrics.produced, previous: previousMetrics.produced, format: 'integer', lowerIsBetter: false },
    { key: 'target', label: 'Meta', value: currentMetrics.target, previous: previousMetrics.target, format: 'integer', lowerIsBetter: false },
    { key: 'oee', label: 'OEE', value: currentMetrics.oee / 100, previous: previousMetrics.oee / 100, format: 'percentage', lowerIsBetter: false },
    { key: 'scrapRate', label: 'Taxa de refugo', value: currentMetrics.scrapRate / 100, previous: previousMetrics.scrapRate / 100, format: 'percentage', lowerIsBetter: true },
    { key: 'downtime', label: 'Downtime', value: currentMetrics.downtime, previous: previousMetrics.downtime, format: 'duration', lowerIsBetter: true },
  ];

  const dataRows = entries.map((entry) => ({
    ...entry,
    attainment: efficiency(entry.produced, entry.target) / 100,
    scrapRate: scrapRate(entry.scrap, entry.produced) / 100,
  }));
  const cellRows = groupByCellUnit(entries).map((row) => ({
    ...row,
    efficiency: row.efficiency / 100,
    scrapRate: row.scrapRate / 100,
  }));
  const monthRows = analysis.series.map((row) => ({
    ...row,
    efficiency: row.efficiency / 100,
    scrapRate: row.scrapRate / 100,
  }));

  return createReportDefinition({
    id: 'producao',
    title: 'Relatório Analítico de Produção',
    subtitle: `Período de ${formatDatePtBr(snapshot.period.from)} a ${formatDatePtBr(snapshot.period.to)}`,
    generatedAt: snapshot.generatedAt,
    generatedBy,
    period: snapshot.period,
    comparisonPeriod: snapshot.comparisonPeriod,
    filters: {
      Células: filterLabel(snapshot.filters, 'cell', 'Todas'),
      Turnos: filterLabel(snapshot.filters, 'shift', 'Todos'),
      ...(snapshot.filters?.sectorId ? { Setor: snapshot.filters.sectorId } : {}),
    },
    summary,
    comparisons,
    tables: [
      { id: 'production-data', title: 'Base detalhada de produção', sheet: 'data', primary: true, columns: DATA_COLUMNS, rows: dataRows },
      { id: 'production-by-cell', title: 'Comparativo por célula', sheet: 'analysis', columns: CELL_COLUMNS, rows: cellRows },
      { id: 'production-by-month', title: 'Evolução mensal', sheet: 'analysis', columns: MONTH_COLUMNS, rows: monthRows },
    ],
    charts: [
      {
        id: 'production-vs-target',
        title: 'Produção × Meta',
        type: 'line',
        categories: analysis.series.map((row) => row.label),
        series: [
          { name: 'Produzido', color: '#00522d', values: analysis.series.map((row) => row.produced) },
          { name: 'Meta', color: '#d6a900', values: analysis.series.map((row) => row.target) },
        ],
      },
      {
        id: 'oee-evolution',
        title: 'Evolução do OEE',
        type: 'line',
        unit: '%',
        categories: analysis.series.map((row) => row.label),
        series: [{ name: 'OEE', color: '#2563eb', values: analysis.series.map((row) => row.efficiency) }],
      },
    ],
    metadata: {
      source: 'production_entries',
      generatedAt: snapshot.generatedAt,
      fetchedRowCount: snapshot.fetchedRowCount,
      rowCount: entries.length,
      analysis,
      currentMetrics,
      previousMetrics,
    },
  });
}


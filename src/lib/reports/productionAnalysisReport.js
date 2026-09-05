import { buildOperationalAnalysis, aggregateAnalysis, ratio } from '@/lib/operationalAnalysis';
import { createReportDefinition } from '@/lib/reports/reportDefinition';
import { buildMetricComparison } from '@/lib/reports/reportPeriodComparison';
import { formatDatePtBr } from '@/lib/reports/reportDataUtils';

const METRIC_COLUMNS = [
  { key: 'unitLabel', label: 'Unidade', type: 'text', width: 14 },
  { key: 'produced', label: 'Produzido', type: 'number', width: 16 },
  { key: 'target', label: 'Meta', type: 'number', width: 16 },
  { key: 'attainment', label: 'Atingimento', type: 'percentage', width: 16 },
  { key: 'gap', label: 'Saldo para meta', type: 'number', width: 18 },
  { key: 'scrap', label: 'Refugo', type: 'number', width: 14 },
  { key: 'scrapRate', label: 'Taxa de refugo', type: 'percentage', width: 16 },
  { key: 'downtime', label: 'Parada (min)', type: 'duration', width: 17 },
];
const fractions = (row) => ({ ...row, attainment: row.attainment == null ? null : row.attainment / 100,
  scrapRate: row.scrapRate == null ? null : row.scrapRate / 100 });

export function createProductionAnalysisReport(snapshot, { generatedBy = '' } = {}) {
  if (!snapshot?.period) throw new Error('Snapshot de produção inválido.');
  const analysis = buildOperationalAnalysis(snapshot.entries || [], snapshot.comparisonPeriod ? snapshot.comparisonEntries || [] : []);
  const { entries, cells, units, previousUnits } = analysis;
  const comparisons = [];
  const summary = [];
  units.forEach((unit) => {
    const prev = previousUnits.find((p) => p.key === unit.key);
    for (const [metric, label, format, mode, lowerIsBetter] of [
      ['produced', 'Produzido', 'number', 'percent', false],
      ['target', 'Meta', 'number', 'percent', false],
      ['attainment', 'Atingimento', 'percentage', 'points', false],
      ['scrapRate', 'Refugo', 'percentage', 'points', true],
    ]) {
      const key = `${metric}-${unit.key}`;
      const divisor = format === 'percentage' ? 100 : 1;
      summary.push({ key, label: `${label} · ${unit.unitLabel}`, value: unit[metric] == null ? null : unit[metric] / divisor,
        previous: prev?.[metric] == null ? null : prev[metric] / divisor, format, lowerIsBetter });
      if (prev && unit[metric] != null && prev[metric] != null) comparisons.push(buildMetricComparison({ key, label,
        current: unit[metric], previous: prev[metric], mode, lowerIsBetter }));
    }
  });
  summary.push({ key: 'downtime', label: 'Paradas registradas', value: analysis.downtime,
    previous: previousUnits.length ? previousUnits.reduce((sum, r) => sum + r.downtime, 0) : null, format: 'duration', lowerIsBetter: true });
  const dataRows = entries.map((entry) => fractions({ ...entry, attainment: ratio(entry.produced, entry.target), scrapRate: ratio(entry.scrap, entry.produced + entry.scrap), gap: entry.target > 0 ? Math.max(0, entry.target - entry.produced) : null }));
  const monthlyRows = units.flatMap((unit) => aggregateAnalysis(entries.filter((e) => e.metric_unit === unit.key), (e) => e.date.slice(0, 7))
    .map((r) => ({ ...r, label: r.key.split('-').reverse().join('/') })).sort((a, b) => a.key.localeCompare(b.key)));
  const charts = units.map((unit) => {
    const rows = monthlyRows.filter((r) => r.metric_unit === unit.key);
    return { id: `volume-${unit.key}`, title: `Produzido × meta · ${unit.unitLabel}`, type: 'bar', unit: ` ${unit.unitLabel}`,
      categories: rows.map((r) => r.label), series: [
        { name: 'Produzido', color: '#15803d', values: rows.map((r) => r.produced) },
        { name: 'Meta', color: '#94a3b8', values: rows.map((r) => r.target) },
      ] };
  });
  return createReportDefinition({
    id: 'producao', title: 'Relatório Analítico de Produção',
    subtitle: `Período de ${formatDatePtBr(snapshot.period.from)} a ${formatDatePtBr(snapshot.period.to)}`,
    generatedAt: snapshot.generatedAt, generatedBy, period: snapshot.period, comparisonPeriod: snapshot.comparisonPeriod,
    filters: { Células: !snapshot.filters?.cell || snapshot.filters.cell === 'all' ? 'Todas' : snapshot.filters.cell,
      Turnos: !snapshot.filters?.shift || snapshot.filters.shift === 'all' ? 'Todos' : snapshot.filters.shift },
    summary, comparisons, charts,
    tables: [
      { id: 'production-data', title: 'Base detalhada de produção válida', sheet: 'data', primary: true, rows: dataRows,
        columns: [
          { key: 'date', label: 'Data', type: 'date', width: 13 },
          { key: 'shift', label: 'Turno', type: 'text', width: 16 },
          { key: 'cell', label: 'Célula', type: 'text', width: 24 },
          { key: 'hour', label: 'Hora', type: 'text', width: 12 },
          ...METRIC_COLUMNS.map((c) => ({ ...c, pdf: ['unitLabel', 'produced', 'target', 'attainment', 'scrap', 'downtime'].includes(c.key) })),
          { key: 'operator', label: 'Operador', type: 'text', width: 24 },
          { key: 'notes', label: 'Observações', type: 'text', width: 40 },
        ].map((c) => ['date', 'cell', 'hour'].includes(c.key) ? { ...c, pdf: true } : c) },
      { id: 'production-by-cell', title: 'Diagnóstico por célula e unidade', sheet: 'analysis',
        columns: [{ key: 'cell', label: 'Célula', type: 'text', width: 24 }, ...METRIC_COLUMNS], rows: cells.map(fractions) },
      { id: 'production-by-month', title: 'Evolução mensal por unidade', sheet: 'analysis',
        columns: [{ key: 'label', label: 'Mês', type: 'text', width: 16 }, ...METRIC_COLUMNS], rows: monthlyRows.map(fractions) },
    ],
    metadata: { source: 'production_entries', generatedAt: snapshot.generatedAt, fetchedRowCount: snapshot.fetchedRowCount,
      rowCount: entries.length, analysis, insights: analysis.insights, methodology: analysis.methodology,
      excludedCount: analysis.excludedCount, monthlyRows },
  });
}

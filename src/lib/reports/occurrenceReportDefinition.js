import { buildPareto } from '@/lib/paretoMetrics';
import { createReportDefinition } from '@/lib/reports/reportDefinition';

export function createOccurrenceReportDefinition({ occurrences = [], date, cell = 'all', shift = 'all', generatedBy = '' }) {
  const filtered = occurrences.filter((item) => {
    if (date && item.date !== date) return false;
    if (cell !== 'all' && item.cell !== cell) return false;
    if (shift !== 'all' && item.shift !== shift) return false;
    return true;
  });
  const totalDowntime = filtered.reduce((sum, item) => sum + (Number(item.downtime) || 0), 0);
  const pareto = buildPareto(filtered);
  const periodDate = date || new Date().toISOString().slice(0, 10);

  return createReportDefinition({
    id: 'ocorrencias-paradas',
    title: 'Relatório de Ocorrências e Paradas',
    subtitle: 'Análise de gargalos produtivos',
    generatedAt: new Date().toISOString(),
    generatedBy,
    period: { from: periodDate, to: periodDate },
    filters: { Célula: cell === 'all' ? 'Todas' : cell, Turno: shift === 'all' ? 'Todos' : shift },
    summary: [
      { key: 'count', label: 'Total de paradas', value: filtered.length, format: 'integer' },
      { key: 'downtime', label: 'Tempo total parado', value: totalDowntime, format: 'duration' },
      { key: 'mttr', label: 'Tempo médio por parada', value: filtered.length ? totalDowntime / filtered.length : 0, format: 'duration' },
    ],
    tables: [
      {
        id: 'occurrence-data', title: 'Ocorrências detalhadas', sheet: 'data', primary: true,
        columns: [
          { key: 'date', label: 'Data', type: 'date' }, { key: 'shift', label: 'Turno', type: 'text' },
          { key: 'cell', label: 'Célula', type: 'text' }, { key: 'reason', label: 'Motivo', type: 'text', width: 28 },
          { key: 'downtime', label: 'Tempo parado (min)', type: 'duration' }, { key: 'operator', label: 'Operador', type: 'text' },
          { key: 'notes', label: 'Observações', type: 'text', width: 34 },
        ],
        rows: filtered.map((item) => ({ ...item, downtime: Number(item.downtime) || 0 })),
      },
      {
        id: 'occurrence-pareto', title: 'Pareto de motivos', sheet: 'analysis',
        columns: [
          { key: 'reason', label: 'Motivo', type: 'text', width: 28 },
          { key: 'value', label: 'Tempo parado (min)', type: 'duration' },
          { key: 'cumulativeValue', label: 'Acumulado', type: 'percentage' },
        ],
        rows: pareto.map((row) => ({ ...row, cumulativeValue: (Number(row.cumulative) || 0) / 100 })),
      },
    ],
    charts: [{
      id: 'occurrence-pareto-chart', title: 'Impacto dos motivos de parada', type: 'line', unit: ' min',
      categories: pareto.map((row) => row.reason),
      series: [{ name: 'Tempo parado', color: '#d6a900', values: pareto.map((row) => row.value) }],
    }],
    metadata: { rowCount: filtered.length, source: 'occurrences' },
  });
}


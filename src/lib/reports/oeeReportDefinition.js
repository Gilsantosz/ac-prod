import { worstFactor } from '@/lib/oeeMetrics';
import { createReportDefinition } from '@/lib/reports/reportDefinition';

export function createOeeReportDefinition({ overall, byCell = [], occurrences = [], filters = {}, generatedBy = '' }) {
  const date = filters.date || new Date().toISOString().slice(0, 10);
  const rows = byCell.map((row) => ({
    ...row,
    oee: (Number(row.oee) || 0) / 100,
    availability: (Number(row.availability) || 0) / 100,
    performance: (Number(row.performance) || 0) / 100,
    quality: (Number(row.quality) || 0) / 100,
    worstFactor: worstFactor(row).label,
  }));
  const occurrenceRows = occurrences.map((item) => ({
    date: item.date,
    shift: item.shift,
    cell: item.cell,
    reason: item.reason,
    downtime: Number(item.downtime) || 0,
    operator: item.operator || '',
    notes: item.notes || '',
  }));

  return createReportDefinition({
    id: 'oee',
    title: 'Relatório de OEE',
    subtitle: 'Disponibilidade × Performance × Qualidade',
    generatedAt: new Date().toISOString(),
    generatedBy,
    period: { from: date, to: date },
    filters: {
      Turno: !filters.shift || filters.shift === 'all' ? 'Todos' : filters.shift,
      Célula: !filters.cell || filters.cell === 'all' ? 'Todas' : filters.cell,
    },
    summary: [
      { key: 'oee', label: 'OEE global', value: (Number(overall?.oee) || 0) / 100, format: 'percentage' },
      { key: 'availability', label: 'Disponibilidade', value: (Number(overall?.availability) || 0) / 100, format: 'percentage' },
      { key: 'performance', label: 'Performance', value: (Number(overall?.performance) || 0) / 100, format: 'percentage' },
      { key: 'quality', label: 'Qualidade', value: (Number(overall?.quality) || 0) / 100, format: 'percentage' },
      { key: 'downtime', label: 'Downtime', value: Number(overall?.downtimeMin) || 0, format: 'duration' },
    ],
    tables: [
      {
        id: 'oee-by-cell', title: 'OEE por célula', sheet: 'data', primary: true,
        columns: [
          { key: 'cell', label: 'Célula', type: 'text', width: 22 },
          { key: 'oee', label: 'OEE', type: 'percentage', width: 13 },
          { key: 'availability', label: 'Disponibilidade', type: 'percentage', width: 16 },
          { key: 'performance', label: 'Performance', type: 'percentage', width: 15 },
          { key: 'quality', label: 'Qualidade', type: 'percentage', width: 14 },
          { key: 'produced', label: 'Produzido', type: 'number', width: 14 },
          { key: 'target', label: 'Meta', type: 'number', width: 14 },
          { key: 'scrap', label: 'Refugo', type: 'number', width: 12 },
          { key: 'downtimeMin', label: 'Parada (min)', type: 'duration', width: 15 },
          { key: 'worstFactor', label: 'Pior fator', type: 'text', width: 18 },
        ],
        rows,
      },
      {
        id: 'oee-occurrences', title: 'Ocorrências do período', sheet: 'analysis',
        columns: [
          { key: 'date', label: 'Data', type: 'date' }, { key: 'shift', label: 'Turno', type: 'text' },
          { key: 'cell', label: 'Célula', type: 'text' }, { key: 'reason', label: 'Motivo', type: 'text' },
          { key: 'downtime', label: 'Parada (min)', type: 'duration' }, { key: 'operator', label: 'Operador', type: 'text' },
          { key: 'notes', label: 'Observações', type: 'text', width: 30 },
        ],
        rows: occurrenceRows,
      },
    ],
    charts: [{
      id: 'oee-by-cell-chart', title: 'OEE por célula', type: 'line', unit: '%',
      categories: byCell.map((row) => row.cell),
      series: [{ name: 'OEE', color: '#00522d', values: byCell.map((row) => Number(row.oee) || 0) }],
    }],
    metadata: { currentMetrics: overall, source: 'oee-metrics' },
  });
}


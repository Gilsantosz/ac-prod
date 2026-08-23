import { createReportDefinition } from '@/lib/reports/reportDefinition';

export function createTraceabilityReportDefinition({ rows = [], filters = {}, generatedBy = '' }) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  const from = filters.date || dates[0] || today;
  const to = filters.date || dates[dates.length - 1] || from;
  return createReportDefinition({
    id: 'rastreabilidade-leituras',
    title: 'Relatório de Rastreabilidade por Leitura',
    subtitle: 'Histórico operacional de leituras produtivas',
    generatedAt: new Date().toISOString(),
    generatedBy,
    period: { from, to },
    filters: {
      Busca: filters.search || 'Sem filtro',
      'Tipo de tag': filters.tagType === 'all' ? 'Todos' : filters.tagType,
      Célula: filters.cell === 'all' ? 'Todas' : filters.cell,
      Etapa: filters.step === 'all' ? 'Todas' : filters.step,
      Operador: filters.operator || 'Todos',
      Status: filters.status === 'all' ? 'Todos' : filters.status,
      Turno: filters.shift === 'all' ? 'Todos' : filters.shift,
      Leitor: filters.readerType === 'all' ? 'Todos' : filters.readerType,
    },
    summary: [{ key: 'readings', label: 'Leituras', value: rows.length, format: 'integer' }],
    tables: [{
      id: 'traceability-readings', title: 'Leituras detalhadas', sheet: 'data', primary: true,
      columns: [
        { key: 'date', label: 'Data', type: 'date' }, { key: 'hour', label: 'Hora', type: 'text' },
        { key: 'lot', label: 'Lote', type: 'text' }, { key: 'order', label: 'Pedido/OP', type: 'text' },
        { key: 'product', label: 'Produto', type: 'text', width: 28 }, { key: 'piece', label: 'Peça', type: 'text' },
        { key: 'tag', label: 'Tag', type: 'text', width: 24 }, { key: 'tagType', label: 'Tipo de tag', type: 'text' },
        { key: 'cell', label: 'Célula', type: 'text' }, { key: 'step', label: 'Etapa', type: 'text' },
        { key: 'operator', label: 'Operador', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
        { key: 'shift', label: 'Turno', type: 'text' }, { key: 'reader', label: 'Leitor', type: 'text' },
        { key: 'notes', label: 'Observações', type: 'text', width: 30 },
      ],
      rows,
    }],
    metadata: { rowCount: rows.length, source: 'production_stage_readings' },
  });
}

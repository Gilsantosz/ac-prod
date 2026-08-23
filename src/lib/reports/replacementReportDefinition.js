import { REPLACEMENT_PRIORITY_LABELS, REPLACEMENT_STATUS_LABELS, formatStageName } from '@/lib/replacementService';
import { createReportDefinition } from '@/lib/reports/reportDefinition';

function dateKey(value) {
  const date = new Date(value || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createReplacementReportDefinition({ rows = [], filters = {}, snapshotAt, generatedBy = '' } = {}) {
  const to = dateKey(snapshotAt || new Date().toISOString());
  const dates = rows.map((row) => dateKey(row.created_at)).filter(Boolean).sort();
  const statusCounts = rows.reduce((totals, row) => {
    totals[row.status] = (totals[row.status] || 0) + 1;
    return totals;
  }, {});
  const normalized = rows.map((row) => ({
    ...row,
    statusLabel: REPLACEMENT_STATUS_LABELS[row.status]?.label || row.status || '',
    priorityLabel: REPLACEMENT_PRIORITY_LABELS[row.priority]?.label || row.priority || '',
    stageLabel: row.rejection_stage ? formatStageName(row.rejection_stage) : '',
  }));
  const completed = statusCounts.completed || 0;
  const cancelled = statusCounts.cancelled || 0;

  return createReportDefinition({
    id: 'reposicoes-producao',
    title: 'Relatório de Produção de Reposições',
    subtitle: 'Fila, prioridades e situação das ordens de reposição',
    generatedAt: snapshotAt || new Date().toISOString(),
    generatedBy,
    period: { from: dates[0] || to, to },
    filters: {
      Visão: filters.tab === 'completed' ? 'Histórico e concluídas' : 'Fila ativa',
      Status: filters.status === 'all' ? 'Todos da visão' : filters.status,
      Prioridade: filters.priority === 'all' ? 'Todas' : filters.priority,
      Busca: filters.search || 'Sem filtro',
    },
    summary: [
      { key: 'orders', label: 'Ordens', value: rows.length, format: 'integer' },
      { key: 'critical', label: 'Prioridade crítica', value: rows.filter((row) => row.priority === 'critical').length, format: 'integer' },
      { key: 'completed', label: 'Concluídas', value: completed, format: 'integer' },
      { key: 'cancelled', label: 'Canceladas', value: cancelled, format: 'integer' },
    ],
    tables: [{
      id: 'replacement-orders', title: 'Ordens de reposição', sheet: 'data', primary: true,
      columns: [
        { key: 'replacement_code', label: 'Código', type: 'text', width: 20 },
        { key: 'created_at', label: 'Solicitada em', type: 'datetime', width: 21 },
        { key: 'statusLabel', label: 'Status', type: 'text', width: 20 },
        { key: 'priorityLabel', label: 'Prioridade', type: 'text', width: 15 },
        { key: 'defect_name', label: 'Defeito', type: 'text', width: 26 },
        { key: 'reason', label: 'Motivo', type: 'text', width: 32 },
        { key: 'lot_code', label: 'Lote', type: 'text', width: 20 },
        { key: 'order_number', label: 'Pedido', type: 'text', width: 18 },
        { key: 'customer_name', label: 'Cliente', type: 'text', width: 26 },
        { key: 'environment_name', label: 'Ambiente', type: 'text', width: 22 },
        { key: 'origin_cell_name', label: 'Célula de origem', type: 'text', width: 20 },
        { key: 'stageLabel', label: 'Etapa reprovada', type: 'text', width: 20 },
        { key: 'operator_name', label: 'Operador', type: 'text', width: 22 },
        { key: 'deadline', label: 'Prazo', type: 'datetime', width: 21 },
        { key: 'approved_at', label: 'Aprovada em', type: 'datetime', width: 21 },
        { key: 'released_at', label: 'Liberada em', type: 'datetime', width: 21 },
        { key: 'completed_at', label: 'Concluída em', type: 'datetime', width: 21 },
        { key: 'cancelled_at', label: 'Cancelada em', type: 'datetime', width: 21 },
        { key: 'notes', label: 'Observações', type: 'text', width: 36 },
      ],
      rows: normalized,
    }],
    charts: [{
      id: 'replacement-status-chart', title: 'Ordens por status', type: 'line', unit: '',
      categories: Object.keys(statusCounts).map((status) => REPLACEMENT_STATUS_LABELS[status]?.label || status),
      series: [{ name: 'Ordens', color: '#d6a900', values: Object.values(statusCounts) }],
    }],
    metadata: { rowCount: rows.length, source: 'replacement_orders' },
  });
}

import { NC_DISPOSITION_LABELS, NC_STATUS_LABELS } from '@/lib/qualityService';
import { createReportDefinition } from '@/lib/reports/reportDefinition';

const SEVERITY_LABELS = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

function percentage(value) {
  return (Number(value) || 0) / 100;
}

export function createQualityReportDefinition({ metrics = {}, filters = {}, generatedBy = '' } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const period = metrics.period || { from: today, to: today };
  const nonconformities = (metrics.rawNCs || []).map((nc) => ({
    code: nc.nc_code || '',
    defect: nc.defect_name || '',
    quantity: Number(nc.quantity) || 1,
    severity: SEVERITY_LABELS[nc.severity] || nc.severity || '',
    disposition: NC_DISPOSITION_LABELS[nc.disposition]?.label || nc.disposition || '',
    status: NC_STATUS_LABELS[nc.status]?.label || nc.status || '',
    lot: nc.lot_code || '',
    order: nc.order_number || '',
    customer: nc.customer_name || '',
    cell: nc.cell_name || '',
    stage: nc.stage_name || '',
    operator: nc.operator_name || '',
    date: nc.detected_at || nc.created_at || null,
    closedAt: nc.closed_at || null,
    notes: nc.notes || '',
  }));

  const paretoRows = (metrics.paretoData || []).map((row) => ({
    defect: row.defect,
    count: Number(row.count) || 0,
    percentage: percentage(row.percentage),
    cumulativePercentage: percentage(row.cumulativePercentage),
  }));
  const spcRows = (metrics.pChartData || []).map((row) => ({
    ...row,
    rejectionRate: percentage(row.rejectionRate),
    p: Number(row.p) || 0,
    pBar: Number(row.pBar) || 0,
    ucl: Number(row.ucl) || 0,
    lcl: Number(row.lcl) || 0,
  }));

  return createReportDefinition({
    id: 'qualidade-executiva',
    title: 'Relatório Executivo de Qualidade',
    subtitle: 'Não conformidades, FPY, Pareto 6M e controle estatístico',
    generatedAt: metrics.snapshotAt || new Date().toISOString(),
    generatedBy,
    period,
    filters: {
      Período: filters.periodLabel || 'Período selecionado',
      Célula: !filters.cell || filters.cell === 'all' ? 'Todas' : filters.cell,
    },
    summary: [
      { key: 'fpy', label: 'First Pass Yield', value: percentage(metrics.fpy ?? 100), format: 'percentage' },
      { key: 'rejectionRate', label: 'Taxa de reprovação', value: percentage(metrics.rejectionRate), format: 'percentage' },
      { key: 'openNCs', label: 'NCs abertas', value: Number(metrics.openNCs) || 0, format: 'integer' },
      { key: 'totalDefects', label: 'Defeitos registrados', value: Number(metrics.totalDefects) || 0, format: 'integer' },
      { key: 'closureRate', label: 'Taxa de encerramento', value: percentage(metrics.closureRate ?? 100), format: 'percentage' },
      { key: 'criticalNCs', label: 'Críticas em aberto', value: Number(metrics.criticalNCs) || 0, format: 'integer' },
    ],
    tables: [
      {
        id: 'quality-nonconformities', title: 'Não conformidades detalhadas', sheet: 'data', primary: true,
        columns: [
          { key: 'code', label: 'Código NC', type: 'text', width: 18, pdf: true },
          { key: 'defect', label: 'Defeito', type: 'text', width: 28, pdf: true },
          { key: 'quantity', label: 'Quantidade', type: 'integer', width: 12, pdf: true },
          { key: 'severity', label: 'Severidade', type: 'text', width: 13, pdf: true },
          { key: 'disposition', label: 'Disposição', type: 'text', width: 18 },
          { key: 'status', label: 'Status', type: 'text', width: 18, pdf: true },
          { key: 'lot', label: 'Lote', type: 'text', width: 18 },
          { key: 'order', label: 'Pedido', type: 'text', width: 18 },
          { key: 'customer', label: 'Cliente', type: 'text', width: 26 },
          { key: 'cell', label: 'Célula', type: 'text', width: 18, pdf: true },
          { key: 'stage', label: 'Etapa', type: 'text', width: 18 },
          { key: 'operator', label: 'Operador', type: 'text', width: 22 },
          { key: 'date', label: 'Data da detecção', type: 'datetime', width: 20, pdf: true },
          { key: 'closedAt', label: 'Data do encerramento', type: 'datetime', width: 20 },
          { key: 'notes', label: 'Observações', type: 'text', width: 36, pdf: true },
        ],
        rows: nonconformities,
      },
      {
        id: 'quality-pareto', title: 'Pareto de defeitos', sheet: 'analysis',
        columns: [
          { key: 'defect', label: 'Defeito', type: 'text', width: 28 },
          { key: 'count', label: 'Quantidade', type: 'integer' },
          { key: 'percentage', label: 'Participação', type: 'percentage' },
          { key: 'cumulativePercentage', label: 'Acumulado', type: 'percentage' },
        ],
        rows: paretoRows,
      },
      {
        id: 'quality-six-m', title: 'Categorias 6M', sheet: 'analysis',
        columns: [
          { key: 'name', label: 'Categoria 6M', type: 'text', width: 24 },
          { key: 'value', label: 'Defeitos', type: 'integer' },
        ],
        rows: metrics.sixMData || [],
      },
      {
        id: 'quality-by-cell', title: 'Defeitos por célula', sheet: 'analysis',
        columns: [
          { key: 'cell', label: 'Célula', type: 'text', width: 24 },
          { key: 'defects', label: 'Defeitos', type: 'integer' },
        ],
        rows: metrics.byCellData || [],
      },
      {
        id: 'quality-spc', title: 'Controle estatístico diário', sheet: 'analysis',
        columns: [
          { key: 'date', label: 'Data', type: 'date' },
          { key: 'sampleSize', label: 'Amostra', type: 'integer' },
          { key: 'approved', label: 'Aprovadas', type: 'integer' },
          { key: 'rejected', label: 'Reprovadas', type: 'integer' },
          { key: 'rejectionRate', label: 'Taxa de reprovação', type: 'percentage' },
          { key: 'p', label: 'p', type: 'number' },
          { key: 'pBar', label: 'p-bar', type: 'number' },
          { key: 'ucl', label: 'UCL', type: 'number' },
          { key: 'lcl', label: 'LCL', type: 'number' },
        ],
        rows: spcRows,
      },
    ],
    charts: [
      {
        id: 'quality-pareto-chart', title: 'Principais defeitos', type: 'line', unit: '',
        categories: paretoRows.slice(0, 12).map((row) => row.defect),
        series: [{ name: 'Quantidade', color: '#d6a900', values: paretoRows.slice(0, 12).map((row) => row.count) }],
      },
      {
        id: 'quality-spc-chart', title: 'Taxa diária de reprovação', type: 'line', unit: '%',
        categories: spcRows.map((row) => row.date),
        series: [{ name: 'Reprovação', color: '#dc2626', values: spcRows.map((row) => row.rejectionRate * 100) }],
      },
    ],
    metadata: { rowCount: nonconformities.length, source: 'quality_nonconformities' },
  });
}

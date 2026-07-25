import { buildBrandedCsv, downloadBlob } from '@/lib/reportBranding';
import { getReplacementExportRows } from '@/lib/replacementService';

const COLUMNS = [
  { key: 'replacement_code', label: 'Código da Reposição' },
  { key: 'status_label', label: 'Status' },
  { key: 'priority', label: 'Prioridade' },
  { key: 'original_piece_uid', label: 'Peça Original' },
  { key: 'original_piece_name', label: 'Descrição da Peça Original' },
  { key: 'replacement_piece_uid', label: 'Peça Substituta' },
  { key: 'replacement_piece_name', label: 'Descrição da Peça Substituta' },
  { key: 'reason', label: 'Motivo da Reposição' },
  { key: 'defect_code', label: 'Código do Defeito' },
  { key: 'defect_name', label: 'Defeito' },
  { key: 'six_m_category', label: 'Categoria 6M' },
  { key: 'severity', label: 'Gravidade' },
  { key: 'disposition', label: 'Disposição' },
  { key: 'lot_code', label: 'Lote do Cliente' },
  { key: 'general_lot_code', label: 'Lote Geral' },
  { key: 'order_number', label: 'Pedido' },
  { key: 'customer_name', label: 'Cliente' },
  { key: 'environment_name', label: 'Ambiente' },
  { key: 'origin_cell_name', label: 'Célula da Reprovação' },
  { key: 'rejection_stage', label: 'Etapa da Reprovação' },
  { key: 'operator_name', label: 'Operador' },
  { key: 'nc_code', label: 'Não Conformidade' },
  { key: 'nc_status', label: 'Status da NC' },
  { key: 'production_reversal_status', label: 'Estorno Produtivo' },
  { key: 'alert_status', label: 'Status do Alerta' },
  { key: 'created_at_local', label: 'Solicitada em' },
  { key: 'approved_at_local', label: 'Aprovada em' },
  { key: 'released_at_local', label: 'Liberada em' },
  { key: 'completed_at_local', label: 'Concluída em' },
  { key: 'duration_hours', label: 'Tempo Total (h)' },
];

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function statusLabel(status) {
  return ({
    requested: 'Solicitada',
    under_review: 'Em análise',
    approved: 'Aprovada',
    released: 'Liberada',
    in_production: 'Em produção',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  })[status] || status || '';
}

function prepareRows(rows) {
  return rows.map((row) => ({
    ...row,
    status_label: statusLabel(row.status),
    production_reversal_status: row.production_entry_reversed ? 'Estornado' : 'Não vinculado',
    alert_status: row.alert_resolved ? 'Resolvido' : (row.alert_id ? 'Ativo' : 'Não criado'),
    created_at_local: formatDate(row.created_at),
    approved_at_local: formatDate(row.approved_at),
    released_at_local: formatDate(row.released_at),
    completed_at_local: formatDate(row.completed_at),
  }));
}

export async function exportReplacementOrdersCsv(filters = {}) {
  const rows = prepareRows(await getReplacementExportRows(filters));
  const completed = rows.filter((row) => row.status === 'completed').length;
  const active = rows.filter((row) => !['completed', 'cancelled'].includes(row.status)).length;
  const reversed = rows.filter((row) => row.production_entry_reversed).length;

  const csv = buildBrandedCsv({
    title: 'Relatório do Fluxo de Reposição',
    subtitle: 'Reprovação, qualidade, estorno produtivo, peça substituta e alertas',
    summary: [
      { label: 'Ordens exportadas', value: rows.length },
      { label: 'Ordens ativas', value: active },
      { label: 'Ordens concluídas', value: completed },
      { label: 'Produções estornadas', value: reversed },
    ],
    columns: COLUMNS,
    rows,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `reposicoes-ac-prod-${stamp}.csv`,
  );

  return rows.length;
}

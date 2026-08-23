import { createReportDefinition } from '@/lib/reports/reportDefinition';

function snapshotDate(snapshotAt) {
  const date = new Date(snapshotAt || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function oldestRowDate(rows, fallback) {
  const dates = rows
    .map((row) => String(row.created_at || row.processed_at || row.date || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  return dates[0] || fallback;
}

export function createSystemAuditReportDefinition({ rows = [], filters = {}, snapshotAt, generatedBy = '' } = {}) {
  const to = snapshotDate(snapshotAt);
  const succeeded = rows.filter((row) => row.success !== false).length;
  return createReportDefinition({
    id: 'auditoria-sistema',
    title: 'Dados de Auditoria do Sistema',
    subtitle: 'Histórico filtrado de ações e acessos',
    generatedAt: snapshotAt || new Date().toISOString(),
    generatedBy,
    period: { from: filters.dateFrom || oldestRowDate(rows, to), to },
    filters: {
      Busca: filters.search || 'Sem filtro',
      Ação: filters.action || 'Todas',
      Resultado: filters.success === '' ? 'Todos' : filters.success === 'true' ? 'Sucesso' : 'Falha',
    },
    summary: [
      { key: 'events', label: 'Eventos', value: rows.length, format: 'integer' },
      { key: 'succeeded', label: 'Com sucesso', value: succeeded, format: 'integer' },
      { key: 'failed', label: 'Com falha', value: rows.length - succeeded, format: 'integer' },
    ],
    tables: [{
      id: 'system-audit-events', title: 'Eventos de auditoria', sheet: 'data', primary: true,
      columns: [
        { key: 'created_at', label: 'Data/Hora', type: 'datetime', width: 21 },
        { key: 'user_name', label: 'Usuário', type: 'text', width: 24 },
        { key: 'user_email', label: 'E-mail', type: 'text', width: 30 },
        { key: 'user_role', label: 'Perfil', type: 'text', width: 16 },
        { key: 'action', label: 'Ação', type: 'text', width: 24 },
        { key: 'entity', label: 'Entidade', type: 'text', width: 22 },
        { key: 'entity_label', label: 'Descrição', type: 'text', width: 28 },
        { key: 'entity_id', label: 'ID da entidade', type: 'text', width: 38 },
        { key: 'success', label: 'Sucesso', type: 'boolean', width: 12 },
        { key: 'method', label: 'Método', type: 'text', width: 12 },
        { key: 'page', label: 'Página', type: 'text', width: 20 },
        { key: 'route', label: 'Rota', type: 'text', width: 24 },
        { key: 'error_message', label: 'Erro', type: 'text', width: 34 },
      ],
      rows,
    }],
    metadata: { rowCount: rows.length, source: 'system_audit_logs' },
  });
}

export function createIntegrityAuditReportDefinition({ rows = [], filters = {}, snapshotAt, generatedBy = '' } = {}) {
  const to = filters.dateTo || snapshotDate(snapshotAt);
  const normalized = rows.map((row) => ({
    ...row,
    dateTime: row.processed_at || row.created_at || null,
    piece: row.piece_code || row.raw_value || '',
    result: row.result_status || row.status || '',
    message: row.error_message || 'OK',
  }));
  const approved = normalized.filter((row) => row.result === 'approved').length;
  const blocked = normalized.filter((row) => row.result === 'blocked').length;
  const duplicated = normalized.filter((row) => row.result === 'duplicated').length;
  return createReportDefinition({
    id: 'integridade-rastreabilidade',
    title: 'Dados de Integridade e Rastreabilidade',
    subtitle: 'Leituras, validações, bloqueios e duplicidades',
    generatedAt: snapshotAt || new Date().toISOString(),
    generatedBy,
    period: { from: filters.dateFrom || to, to },
    filters: {
      Lote: filters.lot || 'Todos',
      Peça: filters.piece || 'Todas',
      Resultado: filters.status === 'all' ? 'Todos' : filters.status,
    },
    summary: [
      { key: 'events', label: 'Eventos', value: normalized.length, format: 'integer' },
      { key: 'approved', label: 'Aprovados', value: approved, format: 'integer' },
      { key: 'blocked', label: 'Bloqueados', value: blocked, format: 'integer' },
      { key: 'duplicated', label: 'Duplicados', value: duplicated, format: 'integer' },
    ],
    tables: [{
      id: 'integrity-events', title: 'Eventos de integridade', sheet: 'data', primary: true,
      columns: [
        { key: 'dateTime', label: 'Data/Hora', type: 'datetime', width: 21 },
        { key: 'lot_code', label: 'Lote', type: 'text', width: 20 },
        { key: 'piece', label: 'Peça/Valor lido', type: 'text', width: 28 },
        { key: 'cell_name', label: 'Célula', type: 'text', width: 20 },
        { key: 'operator_name', label: 'Operador', type: 'text', width: 24 },
        { key: 'shift', label: 'Turno', type: 'text', width: 15 },
        { key: 'reader_type', label: 'Leitor', type: 'text', width: 20 },
        { key: 'result', label: 'Resultado', type: 'text', width: 17 },
        { key: 'message', label: 'Mensagem', type: 'text', width: 36 },
      ],
      rows: normalized,
    }],
    metadata: { rowCount: normalized.length, source: 'production_collection_events' },
  });
}

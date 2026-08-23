import { supabase } from '@/lib/supabaseClient';

const PAGE_SIZE = 1_000;
const MAX_ROWS = 100_000;

async function fetchAllPages(createQuery, label) {
  const rows = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await createQuery().range(offset, Math.min(offset + PAGE_SIZE - 1, MAX_ROWS));
    if (error) throw error;
    const page = data || [];
    if (offset === MAX_ROWS && page.length) {
      const limitError = new Error(`${label} excedeu o limite seguro de ${MAX_ROWS.toLocaleString('pt-BR')} registros. Reduza o período ou aplique mais filtros.`);
      limitError.code = 'AUDIT_REPORT_ROW_LIMIT_EXCEEDED';
      throw limitError;
    }
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  return rows;
}

function safeSearchTerm(value) {
  return String(value || '').trim().replace(/[,()%]/g, ' ').replace(/\s+/g, ' ');
}

export async function fetchSystemAuditReportRows({ search = '', action = '', success = '', dateFrom = '' } = {}) {
  const snapshotAt = new Date().toISOString();
  const createQuery = () => {
    let query = supabase
      .from('system_audit_logs')
      .select('id, user_name, user_email, user_role, action, entity, entity_id, entity_label, page, route, method, success, error_message, created_at')
      .lte('created_at', snapshotAt)
      .order('created_at', { ascending: false });
    if (action) query = query.eq('action', action);
    if (success !== '') query = query.eq('success', success === 'true');
    if (dateFrom) query = query.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString());
    const term = safeSearchTerm(search);
    if (term) {
      query = query.or(`user_email.ilike.%${term}%,user_name.ilike.%${term}%,entity_id.ilike.%${term}%,entity_label.ilike.%${term}%`);
    }
    return query;
  };
  return { rows: await fetchAllPages(createQuery, 'A exportação de logs do sistema'), snapshotAt };
}

export async function fetchIntegrityAuditReportRows({ lot = '', piece = '', status = 'all', dateFrom = '', dateTo = '' } = {}) {
  const snapshotAt = new Date().toISOString();
  const createQuery = () => {
    let query = supabase
      .from('production_collection_events')
      .select('id, processed_at, created_at, date, lot_code, piece_code, raw_value, cell_name, operator_name, shift, result_status, status, reader_type, error_message')
      .lte('created_at', snapshotAt)
      .order('created_at', { ascending: false });
    if (lot.trim()) query = query.ilike('lot_code', `%${lot.trim()}%`);
    if (piece.trim()) query = query.ilike('piece_code', `%${piece.trim()}%`);
    if (status !== 'all') query = query.eq('result_status', status);
    if (dateFrom) query = query.gte('date', dateFrom);
    if (dateTo) query = query.lte('date', dateTo);
    return query;
  };
  return { rows: await fetchAllPages(createQuery, 'A exportação de logs de integridade'), snapshotAt };
}

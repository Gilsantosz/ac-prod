import { supabase } from '@/lib/supabaseClient';

const PAGE_SIZE = 1_000;
const MAX_ROWS = 100_000;
const ACTIVE_STATUSES = ['requested', 'under_review', 'approved', 'released', 'in_production'];
const CLOSED_STATUSES = ['completed', 'cancelled'];

function safeSearchTerm(value) {
  return String(value || '').trim().replace(/[,()%]/g, ' ').replace(/\s+/g, ' ');
}

export async function fetchReplacementReportRows({ tab = 'active', status = 'all', priority = 'all', search = '' } = {}) {
  const snapshotAt = new Date().toISOString();
  const createQuery = () => {
    let query = supabase
      .from('replacement_orders')
      .select('id, replacement_code, reason, defect_name, priority, status, lot_code, order_number, customer_name, environment_name, origin_cell_name, rejection_stage, operator_name, deadline, approved_at, released_at, completed_at, cancelled_at, notes, created_at, updated_at')
      .lte('created_at', snapshotAt)
      .order('created_at', { ascending: false });
    if (status !== 'all') query = query.eq('status', status);
    else query = query.in('status', tab === 'completed' ? CLOSED_STATUSES : ACTIVE_STATUSES);
    if (priority !== 'all') query = query.eq('priority', priority);
    const term = safeSearchTerm(search);
    if (term) {
      query = query.or([
        `replacement_code.ilike.%${term}%`, `reason.ilike.%${term}%`, `lot_code.ilike.%${term}%`,
        `order_number.ilike.%${term}%`, `customer_name.ilike.%${term}%`,
      ].join(','));
    }
    return query;
  };

  const rows = [];
  for (let offset = 0; offset <= MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await createQuery().range(offset, Math.min(offset + PAGE_SIZE - 1, MAX_ROWS));
    if (error) throw error;
    const page = data || [];
    if (offset === MAX_ROWS && page.length) {
      const limitError = new Error(`A exportação de reposições excedeu ${MAX_ROWS.toLocaleString('pt-BR')} registros. Reduza os filtros.`);
      limitError.code = 'REPLACEMENT_REPORT_ROW_LIMIT_EXCEEDED';
      throw limitError;
    }
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, snapshotAt };
  }
  return { rows, snapshotAt };
}

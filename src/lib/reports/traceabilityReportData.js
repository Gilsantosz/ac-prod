import { supabase } from '@/lib/supabaseClient';

const PAGE_SIZE = 1_000;
const MAX_ROWS = 100_000;

export async function fetchTraceabilityReadingsReport(filters = {}) {
  const rows = [];
  const snapshotAt = new Date().toISOString();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from('production_stage_readings')
      .select(`
        id, date, hour, tag_value, reader_type, step_name, cell_name, operator, shift, status, notes, created_at,
        production_lots (lot_code, order_number, product_code, product_name),
        production_lot_items (item_code, product_code, product_name),
        production_tags (tag_type, tag_format)
      `)
      .lte('created_at', snapshotAt)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (filters.operator) query = query.ilike('operator', `%${filters.operator}%`);
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.date) query = query.eq('date', filters.date);
    if (filters.shift && filters.shift !== 'all') query = query.eq('shift', filters.shift);
    if (filters.readerType && filters.readerType !== 'all') query = query.eq('reader_type', filters.readerType);
    if (filters.cell && filters.cell !== 'all') query = query.eq('cell_name', filters.cell);
    if (filters.step && filters.step !== 'all') query = query.eq('step_name', filters.step);

    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (rows.length > MAX_ROWS) {
      const volumeError = new Error(`A consulta ultrapassa ${MAX_ROWS.toLocaleString('pt-BR')} leituras. Informe uma data ou refine os filtros.`);
      volumeError.code = 'REPORT_QUERY_ROW_LIMIT_EXCEEDED';
      throw volumeError;
    }
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export function normalizeTraceabilityReading(row = {}) {
  return {
    date: row.date || '',
    hour: row.hour || '',
    lot: row.production_lots?.lot_code || '',
    order: row.production_lots?.order_number || '',
    product: row.production_lot_items?.product_name || row.production_lots?.product_name || '',
    piece: row.production_lot_items?.item_code || '',
    tag: row.tag_value || '',
    tagType: row.production_tags?.tag_type || '',
    cell: row.cell_name || '',
    step: row.step_name || '',
    operator: row.operator || '',
    status: row.status || '',
    shift: row.shift || '',
    reader: row.reader_type || '',
    notes: row.notes || '',
  };
}

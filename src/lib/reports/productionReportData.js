import { supabase } from '@/lib/supabaseClient';
import { calculateComparisonPeriod, normalizeReportPeriod } from '@/lib/reports/reportPeriodComparison';

export const PRODUCTION_REPORT_PAGE_SIZE = 1_000;
export const PRODUCTION_REPORT_MAX_ROWS = 100_000;

const PRODUCTION_REPORT_COLUMNS = [
  'date',
  'shift',
  'cell',
  'hour',
  'produced',
  'target',
  'scrap',
  'downtime',
  'operator',
  'notes',
  'metric_unit',
  'metric_unit_label',
  'approval_status',
  'created_at',
].join(',');

export function normalizeProductionReportEntry(row = {}) {
  return {
    date: String(row.date || ''),
    shift: String(row.shift || ''),
    cell: String(row.cell || row.cell_name || ''),
    hour: String(row.hour || ''),
    produced: Number(row.produced ?? row.produced_qty) || 0,
    target: Number(row.target ?? row.target_qty) || 0,
    scrap: Number(row.scrap ?? row.scrap_qty) || 0,
    downtime: Number(row.downtime ?? row.downtime_minutes) || 0,
    operator: String(row.operator || row.operator_name || ''),
    notes: String(row.notes || ''),
    metric_unit: String(row.metric_unit || 'pieces'),
    metric_unit_label: String(row.metric_unit_label || 'Peças'),
    approval_status: String(row.approval_status || 'valid'),
    created_at: row.created_at || null,
  };
}

function applyProductionReportFilters(query, filters = {}) {
  let next = query;
  if (filters.cell && filters.cell !== 'all') next = next.eq('cell', filters.cell);
  if (filters.shift && filters.shift !== 'all') next = next.eq('shift', filters.shift);
  return next;
}

async function fetchProductionEntriesPaged({ from, to, snapshotAt, filters, maxRows }) {
  const rows = [];

  for (let offset = 0; ; offset += PRODUCTION_REPORT_PAGE_SIZE) {
    let query = supabase
      .from('production_entries')
      .select(PRODUCTION_REPORT_COLUMNS)
      .gte('date', from)
      .lte('date', to)
      .lte('created_at', snapshotAt)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + PRODUCTION_REPORT_PAGE_SIZE - 1);
    query = applyProductionReportFilters(query, filters);

    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page.map(normalizeProductionReportEntry));

    if (rows.length > maxRows) {
      const volumeError = new Error(`O período selecionado ultrapassa o limite seguro de ${maxRows.toLocaleString('pt-BR')} registros. Reduza o período ou aplique filtros.`);
      volumeError.code = 'REPORT_QUERY_ROW_LIMIT_EXCEEDED';
      volumeError.details = { maxRows, from, to };
      throw volumeError;
    }
    if (page.length < PRODUCTION_REPORT_PAGE_SIZE) break;
  }

  return rows;
}

export async function fetchProductionReportSnapshot({
  period,
  filters = {},
  includeComparison = true,
  maxRows = PRODUCTION_REPORT_MAX_ROWS,
} = {}) {
  const normalizedPeriod = normalizeReportPeriod(period);
  const comparisonPeriod = includeComparison ? calculateComparisonPeriod(normalizedPeriod) : null;
  const snapshotAt = new Date().toISOString();
  const queryFrom = comparisonPeriod?.from || normalizedPeriod.from;
  const rows = await fetchProductionEntriesPaged({
    from: queryFrom,
    to: normalizedPeriod.to,
    snapshotAt,
    filters,
    maxRows,
  });

  const entries = rows.filter((entry) => entry.date >= normalizedPeriod.from && entry.date <= normalizedPeriod.to);
  const comparisonEntries = comparisonPeriod
    ? rows.filter((entry) => entry.date >= comparisonPeriod.from && entry.date <= comparisonPeriod.to)
    : [];

  return {
    generatedAt: snapshotAt,
    period: normalizedPeriod,
    comparisonPeriod,
    filters: { ...filters },
    entries,
    comparisonEntries,
    fetchedRowCount: rows.length,
  };
}


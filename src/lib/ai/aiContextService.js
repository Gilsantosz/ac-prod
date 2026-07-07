import { supabase } from '@/lib/supabaseClient';

const DAY_MS = 86400000;

export function canUseAiOperations(user) {
  return !!user && (
    user.role === 'admin'
    || user.role === 'manager'
    || user.permissions?.ai_operations
    || user.permissions?.view_reports
  );
}

function isoDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function normalizeAiFilters(filters = {}) {
  const today = new Date();
  const defaultStart = new Date(today.getTime() - (6 * DAY_MS));
  return {
    startDate: isoDate(filters.startDate) || isoDate(defaultStart),
    endDate: isoDate(filters.endDate) || isoDate(today),
    cells: Array.isArray(filters.cells) ? filters.cells.filter(Boolean) : [],
    lots: Array.isArray(filters.lots) ? filters.lots.filter(Boolean) : [],
    shifts: Array.isArray(filters.shifts) ? filters.shifts.filter(Boolean) : [],
    operator: String(filters.operator || '').trim(),
    order: String(filters.order || '').trim(),
    loadNumber: String(filters.loadNumber || '').trim(),
    product: String(filters.product || '').trim(),
    client: String(filters.client || '').trim(),
    customerLegalName: String(filters.customerLegalName || '').trim(),
    route: String(filters.route || '').trim(),
    finalizationDate: String(filters.finalizationDate || '').trim(),
    palletNumber: String(filters.palletNumber || '').trim(),
    stage: String(filters.stage || '').trim(),
    status: String(filters.status || '').trim(),
    approvalStatus: String(filters.approvalStatus || '').trim(),
    onlyWithScrap: !!filters.onlyWithScrap,
    onlyWithDowntime: !!filters.onlyWithDowntime,
    onlyWithOccurrence: !!filters.onlyWithOccurrence,
  };
}

function allowedCellsFor(user, requested) {
  const requestedCells = requested || [];
  if (user?.role === 'admin') return requestedCells;
  if (user?.role === 'manager' && user?.managed_cells?.length) {
    return requestedCells.length
      ? requestedCells.filter((cell) => user.managed_cells.includes(cell))
      : user.managed_cells;
  }
  if (user?.cell) return requestedCells.length && !requestedCells.includes(user.cell) ? [] : [user.cell];
  return requestedCells;
}

async function runQuery(label, query, optional = false) {
  const { data, error } = await query;
  if (!error) return { rows: data || [], warning: '' };
  if (optional) return { rows: [], warning: `${label} indisponível: ${error.message}` };
  throw new Error(`${label}: ${error.message}`);
}

function includesText(value, term) {
  return !term || String(value || '').toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'));
}

function filterEntries(entries, filters) {
  return entries.filter((entry) => {
    if (filters.shifts.length && !filters.shifts.includes(entry.shift)) return false;
    if (!includesText(entry.operator, filters.operator)) return false;
    if (!includesText(entry.order_number, filters.order)) return false;
    if (!includesText(entry.load_number, filters.loadNumber)) return false;
    if (!includesText(`${entry.product_code || ''} ${entry.product_name || ''}`, filters.product)) return false;
    if (!includesText(`${entry.customer_name || ''} ${entry.customer_trade_name || ''} ${entry.customer_legal_name || ''}`, filters.client)) return false;
    if (!includesText(entry.customer_legal_name, filters.customerLegalName)) return false;
    if (!includesText(`${entry.route_code || ''} ${entry.route_name || ''}`, filters.route)) return false;
    if (filters.finalizationDate && entry.finalization_date !== filters.finalizationDate) return false;
    if (!includesText(entry.pallet_number, filters.palletNumber)) return false;
    if (!includesText(entry.process_step || entry.step_code, filters.stage)) return false;
    if (filters.lots.length && !filters.lots.some((lot) => includesText(entry.lot_code, lot))) return false;
    if (filters.approvalStatus && entry.approval_status !== filters.approvalStatus) return false;
    if (filters.onlyWithScrap && Number(entry.scrap || 0) <= 0) return false;
    if (filters.onlyWithDowntime && Number(entry.downtime || 0) <= 0) return false;
    return true;
  });
}

function filterLots(lots, filters) {
  return lots.filter((lot) => {
    if (filters.lots.length && !filters.lots.some((code) => includesText(lot.lot_code, code))) return false;
    if (!includesText(lot.production_orders?.order_code, filters.order)) return false;
    if (!includesText(lot.production_orders?.load_number, filters.loadNumber)) return false;
    if (!includesText(`${lot.production_orders?.customer_name || ''} ${lot.production_orders?.customer_trade_name || ''} ${lot.production_orders?.customer_legal_name || ''}`, filters.client)) return false;
    if (!includesText(lot.production_orders?.customer_legal_name, filters.customerLegalName)) return false;
    if (filters.finalizationDate && lot.production_orders?.finalization_date !== filters.finalizationDate) return false;
    if (!includesText(lot.current_stage, filters.stage)) return false;
    if (filters.status && lot.status !== filters.status) return false;
    return true;
  });
}

export async function fetchAiContext(rawFilters = {}, user) {
  if (!canUseAiOperations(user)) throw new Error('Seu perfil não possui permissão para usar a IA Operacional.');

  const filters = normalizeAiFilters(rawFilters);
  filters.cells = allowedCellsFor(user, filters.cells);
  if (rawFilters.cells?.length && !filters.cells.length) {
    throw new Error('As células solicitadas estão fora do seu escopo de acesso.');
  }

  let entriesQuery = supabase
    .from('production_entries')
    .select('*')
    .gte('date', filters.startDate)
    .lte('date', filters.endDate)
    .order('date', { ascending: false })
    .limit(10000);
  let occurrencesQuery = supabase
    .from('occurrences')
    .select('*')
    .gte('date', filters.startDate)
    .lte('date', filters.endDate)
    .order('date', { ascending: false })
    .limit(5000);
  if (filters.cells.length) {
    entriesQuery = entriesQuery.in('cell', filters.cells);
    occurrencesQuery = occurrencesQuery.in('cell', filters.cells);
  }

  const [entriesResult, occurrencesResult, lotsResult, cellsResult, goalsResult] = await Promise.all([
    runQuery('Produção', entriesQuery),
    runQuery('Ocorrências', occurrencesQuery, true),
    runQuery('Lotes', supabase.from('production_lots').select('*, production_orders:production_orders!production_order_id(*)').order('created_at', { ascending: false }).limit(2000), true),
    runQuery('Células', supabase.from('cells').select('id, name, active').eq('active', true).order('name'), true),
    runQuery('Metas', supabase.from('production_daily_goals').select('*').gte('date', filters.startDate).lte('date', filters.endDate).limit(5000), true),
  ]);

  let entries = filterEntries(entriesResult.rows, filters);
  const occurrences = occurrencesResult.rows.filter((item) => {
    if (filters.shifts.length && !filters.shifts.includes(item.shift)) return false;
    if (!includesText(item.operator, filters.operator)) return false;
    if (filters.lots.length && !filters.lots.some((lot) => includesText(item.lot_code, lot))) return false;
    return true;
  });
  if (filters.onlyWithOccurrence) {
    const occurrenceKeys = new Set(occurrences.map((item) => `${item.date}|${item.shift}|${item.cell}`));
    entries = entries.filter((entry) => occurrenceKeys.has(`${entry.date}|${entry.shift}|${entry.cell}`));
  }
  const lots = filterLots(lotsResult.rows, filters);
  const goals = goalsResult.rows
    .map((goal) => ({ ...goal, cell: goal.cell || goal.cell_name }))
    .filter((goal) => !filters.cells.length || filters.cells.includes(goal.cell));
  const warnings = [occurrencesResult, lotsResult, cellsResult, goalsResult]
    .map((result) => result.warning)
    .filter(Boolean);

  return {
    filters,
    entries,
    occurrences,
    lots,
    cells: cellsResult.rows,
    goals,
    warnings,
    sources: ['production_entries', ...(occurrencesResult.warning ? [] : ['occurrences']), ...(lotsResult.warning ? [] : ['production_lots', 'production_orders'])],
    generatedAt: new Date().toISOString(),
  };
}

export async function fetchAiMetadata(user) {
  if (!canUseAiOperations(user)) return { cells: [], operators: [], managers: [] };
  const [cells, operators, managers] = await Promise.all([
    runQuery('Células', supabase.from('cells').select('id, name').eq('active', true).order('name'), true),
    runQuery('Operadores', supabase.from('operators').select('id, name').eq('active', true).order('name'), true),
    runQuery('Gestores', supabase.from('profiles').select('id, name, email, role, managed_cells').in('role', ['admin', 'manager']).eq('active', true).order('name'), true),
  ]);
  return { cells: cells.rows, operators: operators.rows, managers: managers.rows };
}

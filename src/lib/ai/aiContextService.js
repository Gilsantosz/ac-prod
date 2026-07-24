import { supabase } from '@/lib/supabaseClient';
import { resolveAiLotContext } from './aiLotContextService';

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
  const toList = (plural, singular) => {
    if (Array.isArray(plural)) return plural.map(String).map((item) => item.trim()).filter(Boolean);
    if (plural) return [String(plural).trim()].filter(Boolean);
    return singular ? [String(singular).trim()].filter(Boolean) : [];
  };
  const lots = toList(filters.lots, filters.lotCode || filters.clientLotCode);
  const hasLotScope = lots.length > 0 || Boolean(filters.generalLotCode);
  const allHistory = filters.allHistory === true || (hasLotScope && !filters.startDate && !filters.endDate);
  return {
    startDate: allHistory ? '' : (isoDate(filters.startDate) || isoDate(defaultStart)),
    endDate: allHistory ? '' : (isoDate(filters.endDate) || isoDate(today)),
    cells: toList(filters.cells, filters.cell),
    lots,
    shifts: toList(filters.shifts, filters.shift === 'all' ? '' : filters.shift),
    lotCode: String(filters.lotCode || '').trim(),
    generalLotCode: String(filters.generalLotCode || '').trim(),
    clientLotCode: String(filters.clientLotCode || '').trim(),
    allHistory,
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
  const lotContext = await resolveAiLotContext({
    generalLotCode: filters.generalLotCode,
    clientLotCode: filters.clientLotCode,
    lotCode: filters.lotCode || filters.lots[0],
  });
  if (lotContext.generalLotCode) filters.generalLotCode = lotContext.generalLotCode;
  if (lotContext.clientLotCode) filters.clientLotCode = lotContext.clientLotCode;
  if (lotContext.clientLotCodes.length) {
    filters.lots = lotContext.clientLotCode
      ? [lotContext.clientLotCode]
      : lotContext.clientLotCodes;
  }

  filters.cells = allowedCellsFor(user, filters.cells);
  if ((rawFilters.cells?.length || rawFilters.cell) && !filters.cells.length) {
    throw new Error('As células solicitadas estão fora do seu escopo de acesso.');
  }

  let entriesQuery = supabase
    .from('production_entries')
    .select('*')
    .order('date', { ascending: false })
    .limit(10000);
  let occurrencesQuery = supabase
    .from('occurrences')
    .select('*')
    .order('date', { ascending: false })
    .limit(5000);
  let lotsQuery = supabase
    .from('production_lots')
    .select('*, production_orders:production_orders!production_order_id(*)')
    .order('created_at', { ascending: false })
    .limit(2000);
  let goalsQuery = supabase.from('production_daily_goals').select('*').limit(5000);

  if (filters.startDate && filters.endDate) {
    entriesQuery = entriesQuery.gte('date', filters.startDate).lte('date', filters.endDate);
    occurrencesQuery = occurrencesQuery.gte('date', filters.startDate).lte('date', filters.endDate);
    goalsQuery = goalsQuery.gte('date', filters.startDate).lte('date', filters.endDate);
  }
  if (filters.cells.length) {
    entriesQuery = entriesQuery.in('cell', filters.cells);
    occurrencesQuery = occurrencesQuery.in('cell', filters.cells);
  }
  if (filters.lots.length) {
    entriesQuery = entriesQuery.in('lot_code', filters.lots);
    occurrencesQuery = occurrencesQuery.in('lot_code', filters.lots);
    lotsQuery = lotsQuery.in('lot_code', filters.lots);
  } else if (lotContext.batchId) {
    lotsQuery = lotsQuery.eq('pcp_import_batch_id', lotContext.batchId);
  }

  const [entriesResult, occurrencesResult, lotsResult, cellsResult, goalsResult] = await Promise.all([
    runQuery('Produção', entriesQuery),
    runQuery('Ocorrências', occurrencesQuery, true),
    runQuery('Lotes', lotsQuery, true),
    runQuery('Células', supabase.from('cells').select('id, name, active').eq('active', true).order('name'), true),
    runQuery('Metas', goalsQuery, true),
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
    lotContext,
    cells: cellsResult.rows,
    goals,
    warnings,
    sources: [
      'production_entries',
      ...(occurrencesResult.warning ? [] : ['occurrences']),
      ...(lotsResult.warning ? [] : ['production_lots', 'production_orders']),
      ...(lotContext.batchId ? ['promob_import_batches', 'get_general_lot_tracking'] : []),
    ],
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

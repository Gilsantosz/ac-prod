import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { resolveReportCellScope } from './reportAccessScope.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function corsHeadersForRequest(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set([
    'https://gilsantosz.github.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...configured,
  ]);
  const allowedOrigin = allowed.has(origin) ? origin : 'null';
  return { ...corsHeaders, 'Access-Control-Allow-Origin': allowedOrigin, Vary: 'Origin' };
}

export function json(body: unknown, status = 200, headers = corsHeaders) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export async function requireAiUser(req: Request, manage = false) {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization) throw new Error('AUTH_REQUIRED');
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error('AUTH_REQUIRED');
  const admin = createClient(url, serviceRole);
  const { data: profile } = await admin.from('profiles').select('id,name,email,role,cell,permissions,managed_cells,active').eq('id', user.id).single();
  if (!profile?.active) throw new Error('ACCESS_DENIED');
  const allowed = profile.role === 'admin'
    || profile.role === 'manager'
    || profile.permissions?.ai_operations
    || (!manage && profile.permissions?.view_reports);
  if (!allowed || (manage && !['admin', 'manager'].includes(profile.role) && !profile.permissions?.manage_automations)) throw new Error('ACCESS_DENIED');
  return { admin, user, profile };
}

export function scopedCells(profile: any, requested: string[] = []) {
  return resolveReportCellScope(profile, requested).cells;
}

export function aggregate(entries: any[] = [], occurrences: any[] = [], lots: any[] = []) {
  const sum = (rows: any[], key: string) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const produced = sum(entries, 'produced');
  const target = sum(entries, 'target');
  const scrap = sum(entries, 'scrap');
  const downtime = Math.max(sum(entries, 'downtime'), sum(occurrences, 'downtime'));
  const unique = (values: any[]) => [...new Set(values.filter(Boolean))];
  const orders = unique(entries.map((row) => row.order_number).concat(lots.map((lot) => lot.production_orders?.order_number || lot.production_orders?.order_code)));
  const loads = unique(entries.map((row) => row.load_number).concat(lots.map((lot) => lot.production_orders?.load_number)));
  const clients = unique(entries.map((row) => row.customer_legal_name || row.customer_name).concat(lots.map((lot) => lot.production_orders?.customer_legal_name || lot.production_orders?.customer_name)));
  const products = unique(entries.map((row) => row.product_name).concat(lots.map((lot) => lot.product_name)));
  const rejected = entries.reduce((total, row) => total + (Number(row.rejected_quantity ?? row.scrap) || 0), 0);
  const approved = entries.reduce((total, row) => total + (Number(row.approved_quantity) || Math.max((Number(row.produced) || 0) - (Number(row.scrap) || 0), 0)), 0);
  const pending = entries.reduce((total, row) => total + (Number(row.pending_quantity) || Math.max((Number(row.target) || 0) - (Number(row.produced) || 0), 0)), 0);
  const shiftMinutes = new Map<string, number>();
  entries.forEach((entry) => {
    const key = `${entry.date || ''}|${entry.cell || ''}|${entry.shift || ''}`;
    shiftMinutes.set(key, Math.max(1, Number(entry.hours) || 8) * 60);
  });
  const plannedMinutes = [...shiftMinutes.values()].reduce((total, value) => total + value, 0);
  const availability = plannedMinutes > 0 ? Math.max(plannedMinutes - downtime, 0) / plannedMinutes : 0;
  const performance = target > 0 ? Math.min(produced / target, 1.5) : 0;
  const quality = produced > 0 ? Math.max(produced - scrap, 0) / produced : 0;
  return {
    records: entries.length,
    produced,
    target,
    efficiency: target ? (produced / target) * 100 : 0,
    oee: availability * performance * quality * 100,
    availability: availability * 100,
    performance: performance * 100,
    quality: quality * 100,
    scrap,
    scrapRate: produced ? (scrap / produced) * 100 : 0,
    downtime,
    occurrences: occurrences.length,
    lots: lots.length,
    blockedLots: lots.filter((lot) => lot.status === 'blocked').length,
    completedLots: lots.filter((lot) => lot.current_stage === 'completed' || lot.status === 'shipped').length,
    approved,
    rejected,
    pending,
    orderCount: orders.length,
    loadCount: loads.length,
    orders,
    loads,
    clients,
    products,
  };
}

export async function fetchOperationalData(admin: any, profile: any, filters: any = {}) {
  const endDate = filters.endDate || new Date().toISOString().slice(0, 10);
  const startFallback = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const startDate = filters.startDate || startFallback;
  const cellScope = resolveReportCellScope(profile, Array.isArray(filters.cells) ? filters.cells : []);
  const cells = cellScope.cells;
  const requestedLots = Array.isArray(filters.lots)
    ? filters.lots.filter(Boolean)
    : [filters.clientLotCode || filters.lotCode].filter(Boolean);
  let batchId = null;
  let generalLotCode = String(filters.generalLotCode || '').trim();
  let clientLotCode = String(filters.clientLotCode || '').trim();

  if (generalLotCode) {
    const { data: batch } = await admin
      .from('promob_import_batches')
      .select('id,general_lot_code')
      .ilike('general_lot_code', generalLotCode)
      .limit(1)
      .maybeSingle();
    batchId = batch?.id || null;
    generalLotCode = batch?.general_lot_code || generalLotCode;
  } else if (clientLotCode || requestedLots[0]) {
    const code = clientLotCode || requestedLots[0];
    let lotQuery = admin
      .from('production_lots')
      .select('lot_code,pcp_import_batch_id')
      .ilike('lot_code', code)
      .limit(1);
    if (!cellScope.unrestricted) lotQuery = lotQuery.in('current_cell', cells);
    const { data: lotRows } = await lotQuery;
    const lot = lotRows?.[0] || null;
    if (lot) {
      clientLotCode = lot.lot_code;
      batchId = lot.pcp_import_batch_id;
    }
  }

  let lotTracking = null;
  if (batchId && profile.role === 'admin') {
    const { data: tracking } = await admin.rpc('get_general_lot_tracking', {
      p_batch_id: batchId,
      p_limit: 1,
    });
    lotTracking = tracking || null;
    generalLotCode = tracking?.general_lots?.[0]?.general_lot_code || generalLotCode;
  }

  let resolvedClientLots = clientLotCode
    ? [clientLotCode]
    : (lotTracking?.general_lots?.[0]?.client_lots || []).map((lot: any) => lot.lot_code).filter(Boolean);
  if (batchId && profile.role !== 'admin' && !resolvedClientLots.length) {
    const { data: scopedLots, error: scopedLotsError } = await admin
      .from('production_lots')
      .select('lot_code')
      .eq('pcp_import_batch_id', batchId)
      .in('current_cell', cells)
      .limit(2000);
    if (scopedLotsError) throw scopedLotsError;
    resolvedClientLots = (scopedLots || []).map((lot: any) => lot.lot_code).filter(Boolean);
    if (!resolvedClientLots.length) throw new Error('ACCESS_DENIED');
  }
  const lotCodes = resolvedClientLots.length ? resolvedClientLots : requestedLots;

  let entriesQuery = admin.from('production_entries').select('*').limit(10000);
  let occurrencesQuery = admin.from('occurrences').select('*').limit(5000);
  if (!filters.allHistory) {
    entriesQuery = entriesQuery.gte('date', startDate).lte('date', endDate);
    occurrencesQuery = occurrencesQuery.gte('date', startDate).lte('date', endDate);
  }
  if (!cellScope.unrestricted) {
    entriesQuery = entriesQuery.in('cell', cells);
    occurrencesQuery = occurrencesQuery.in('cell', cells);
  }
  if (lotCodes.length) {
    entriesQuery = entriesQuery.in('lot_code', lotCodes);
    occurrencesQuery = occurrencesQuery.in('lot_code', lotCodes);
  }
  const [entriesResult, occurrencesResult] = await Promise.all([
    entriesQuery,
    occurrencesQuery,
  ]);
  if (entriesResult.error) throw entriesResult.error;
  if (occurrencesResult.error) throw occurrencesResult.error;

  const allowedLotIds = [...new Set([
    ...(entriesResult.data || []).map((row: any) => row.lot_id),
    ...(occurrencesResult.data || []).map((row: any) => row.lot_id),
  ].filter(Boolean))];
  let lots: any[] = [];
  if (cellScope.unrestricted || allowedLotIds.length) {
    let lotsQuery = admin.from('production_lots').select('*,production_orders(*)').limit(2000);
    if (!cellScope.unrestricted) lotsQuery = lotsQuery.in('id', allowedLotIds);
    if (lotCodes.length) lotsQuery = lotsQuery.in('lot_code', lotCodes);
    else if (batchId) lotsQuery = lotsQuery.eq('pcp_import_batch_id', batchId);
    const lotsResult = await lotsQuery;
    if (lotsResult.error) throw lotsResult.error;
    lots = lotsResult.data || [];
  }
  let entries = entriesResult.data || [];
  const includes = (value: any, term: any) => !term || String(value || '').toLowerCase().includes(String(term).toLowerCase());
  entries = entries.filter((row: any) => includes(row.order_number, filters.order)
    && includes(row.load_number, filters.loadNumber)
    && includes(row.lot_code, filters.lots?.[0])
    && includes(`${row.customer_name || ''} ${row.customer_legal_name || ''}`, filters.client || filters.customerLegalName)
    && includes(row.product_name, filters.product)
    && includes(`${row.route_code || ''} ${row.route_name || ''}`, filters.route)
    && includes(row.pallet_number, filters.palletNumber)
    && (!filters.finalizationDate || row.finalization_date === filters.finalizationDate));
  lots = lots.filter((lot: any) => includes(lot.lot_code, filters.lots?.[0])
    && includes(lot.production_orders?.order_number || lot.production_orders?.order_code, filters.order)
    && includes(lot.production_orders?.load_number, filters.loadNumber)
    && includes(lot.current_step || lot.current_stage, filters.stage));
  return {
    entries,
    occurrences: occurrencesResult.data || [],
    lots,
    lotContext: batchId ? {
      batchId,
      generalLotCode,
      clientLotCode: clientLotCode || null,
      tracking: lotTracking,
      generalLot: lotTracking?.general_lots?.[0] || null,
    } : null,
    filters: { ...filters, startDate, endDate, cells, lots: lotCodes, generalLotCode, clientLotCode },
  };
}

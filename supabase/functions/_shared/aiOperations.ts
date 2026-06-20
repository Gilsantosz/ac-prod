import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
  if (profile.role === 'admin') return requested;
  const allowed = profile.role === 'manager' && profile.managed_cells?.length ? profile.managed_cells : (profile.cell ? [profile.cell] : []);
  return requested.length ? requested.filter((cell) => allowed.includes(cell)) : allowed;
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
  return {
    records: entries.length,
    produced,
    target,
    efficiency: target ? (produced / target) * 100 : 0,
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
  const cells = scopedCells(profile, Array.isArray(filters.cells) ? filters.cells : []);
  let entriesQuery = admin.from('production_entries').select('*').gte('date', startDate).lte('date', endDate).limit(10000);
  let occurrencesQuery = admin.from('occurrences').select('*').gte('date', startDate).lte('date', endDate).limit(5000);
  if (cells.length) { entriesQuery = entriesQuery.in('cell', cells); occurrencesQuery = occurrencesQuery.in('cell', cells); }
  const [entriesResult, occurrencesResult, lotsResult] = await Promise.all([
    entriesQuery,
    occurrencesQuery,
    admin.from('production_lots').select('*,production_orders(*)').limit(2000),
  ]);
  if (entriesResult.error) throw entriesResult.error;
  let entries = entriesResult.data || [];
  let lots = lotsResult.data || [];
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
  return { entries, occurrences: occurrencesResult.data || [], lots, filters: { ...filters, startDate, endDate, cells } };
}

/**
 * AC.Prod — Serviço de Histórico de Produção com Paginação Real
 *
 * Substitui os limites fixos de 50/30 registros por paginação real com
 * contagem total no banco (count: 'exact' do Supabase).
 */

import { supabase } from '@/lib/supabaseClient';

const SCHEMA_ERROR_RE = /PGRST202|PGRST204|schema cache|does not exist|could not find/i;
const COMPLETED_STATUSES = new Set(['completed', 'shipped']);
const BLOCKED_STATUSES = new Set(['rejected', 'blocked', 'scrap', 'cancelled']);
const ACTIVE_STATUSES = new Set(['pending', 'in_progress', 'rework']);

const emptyProgress = () => ({
  total: 0,
  completed: 0,
  pending: 0,
  blocked: 0,
  inProgress: 0,
  approvedReadings: 0,
  rejectedReadings: 0,
  percent: 0,
});

const isSchemaError = (error) => SCHEMA_ERROR_RE.test(`${error?.code || ''} ${error?.message || ''}`);
const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const firstValue = (...values) => values.find((value) => String(value ?? '').trim()) || '';
const normalizeStatus = (status) => String(status || '').toLowerCase();

function uniqueById(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    if (row?.id && !map.has(row.id)) map.set(row.id, row);
  });
  return Array.from(map.values());
}

function normalizeOrder(order = null) {
  if (!order) return null;
  return {
    ...order,
    order_number: firstValue(order.order_number, order.order_code, order.system_order_number, order.customer_order_number),
    load_number: firstValue(order.load_number),
    customer_trade_name: firstValue(order.customer_trade_name, order.customer_name, order.customer_legal_name),
    customer_legal_name: firstValue(order.customer_legal_name, order.customer_name, order.customer_trade_name),
    finalization_date: firstValue(order.finalization_date, order.delivery_date),
  };
}

function normalizeLot(lot = null) {
  if (!lot) return null;
  return {
    ...lot,
    current_step: firstValue(lot.current_step, lot.current_stage),
    current_status: firstValue(lot.current_status, lot.status),
    order_number: firstValue(lot.order_number),
  };
}

function getLotOrderId(lot = {}) {
  return lot.production_order_id || lot.order_id || null;
}

function sumReadingQuantity(readings = [], status) {
  return readings
    .filter((reading) => reading.status === status)
    .reduce((sum, reading) => sum + (toNumber(reading.quantity) || 1), 0);
}

function buildProgress(items = [], readings = [], plannedQuantity = 0, fallback = {}) {
  const hasItems = items.length > 0;
  const planned = Math.max(toNumber(plannedQuantity), hasItems ? items.length : 0);
  const fallbackCompleted = toNumber(fallback.completed ?? fallback.approved_quantity ?? fallback.produced_quantity);
  const fallbackBlocked = toNumber(fallback.blocked ?? fallback.rejected_quantity ?? fallback.scrap_count);
  const completed = hasItems
    ? items.filter((item) => COMPLETED_STATUSES.has(normalizeStatus(item.status))).length
    : fallbackCompleted;
  const blocked = hasItems
    ? items.filter((item) => BLOCKED_STATUSES.has(normalizeStatus(item.status))).length
    : fallbackBlocked;
  const inProgress = hasItems
    ? items.filter((item) => ACTIVE_STATUSES.has(normalizeStatus(item.status))).length
    : Math.max(0, planned - completed - blocked);
  const pending = Math.max(0, planned - completed);
  const approvedReadings = sumReadingQuantity(readings, 'approved') || toNumber(fallback.approved_quantity);
  const rejectedReadings = sumReadingQuantity(readings, 'rejected') || toNumber(fallback.rejected_quantity);
  const percent = planned > 0 ? Math.min(100, Math.round((completed / planned) * 100)) : 0;

  return {
    total: planned,
    completed,
    pending,
    blocked,
    inProgress,
    approvedReadings,
    rejectedReadings,
    percent,
  };
}

function buildMissingPieces(items = [], tags = [], lots = [], limit = 80) {
  const lotById = new Map(lots.map((lot) => [lot.id, normalizeLot(lot)]));
  const tagsByItem = tags.reduce((acc, tag) => {
    if (!tag?.item_id || tag.active === false) return acc;
    if (!acc.has(tag.item_id)) acc.set(tag.item_id, []);
    acc.get(tag.item_id).push(tag);
    return acc;
  }, new Map());

  return items
    .filter((item) => !COMPLETED_STATUSES.has(normalizeStatus(item.status)))
    .sort((a, b) => {
      const lotA = lotById.get(a.lot_id)?.lot_code || '';
      const lotB = lotById.get(b.lot_id)?.lot_code || '';
      return `${lotA}-${a.current_step || ''}-${a.item_code || ''}`.localeCompare(`${lotB}-${b.current_step || ''}-${b.item_code || ''}`);
    })
    .slice(0, limit)
    .map((item) => {
      const lot = lotById.get(item.lot_id);
      const itemTags = tagsByItem.get(item.id) || [];
      const tag = itemTags.find((candidate) => candidate.tag_type === 'barcode') || itemTags[0] || null;
      return {
        id: item.id,
        lot_id: item.lot_id,
        lot_code: lot?.lot_code || '',
        item_code: firstValue(item.item_code, item.piece_code, item.id),
        product_name: firstValue(item.product_name, item.piece_name, lot?.product_name),
        current_step: firstValue(item.current_step, lot?.current_step, 'Sem etapa definida'),
        current_cell: firstValue(item.current_cell, lot?.current_cell, 'Sem célula definida'),
        status: firstValue(item.status, 'pending'),
        tag_value: firstValue(tag?.tag_value, tag?.barcode_value, tag?.epc_code),
      };
    });
}

async function fetchLotsByOrder(orderId, warnings) {
  if (!orderId) return [];
  const rows = [];
  for (const column of ['production_order_id', 'order_id']) {
    const { data, error } = await supabase
      .from('production_lots')
      .select('*')
      .eq(column, orderId)
      .order('created_at', { ascending: false })
      .range(0, 4999);
    if (error) {
      if (!isSchemaError(error)) warnings.push(`Lotes: ${error.message}`);
      continue;
    }
    rows.push(...(data || []));
  }
  return uniqueById(rows);
}

async function fetchRowsForLots(tableName, lotIds, warnings) {
  if (!lotIds.length) return [];
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .in('lot_id', lotIds)
    .order('created_at', { ascending: false })
    .range(0, 4999);
  if (error) {
    if (!isSchemaError(error)) warnings.push(`${tableName}: ${error.message}`);
    return [];
  }
  return data || [];
}

function normalizeRpcSummary(data = null) {
  if (!data) return null;
  const lot = normalizeLot(data.lot);
  const order = normalizeOrder(data.order);
  const lotProgress = data.lotProgress || (lot ? buildProgress([], [], lot.planned_quantity, lot) : emptyProgress());
  const orderProgress = data.orderProgress || emptyProgress();
  return {
    ...data,
    lot,
    order,
    lotProgress,
    orderProgress,
    missingPieces: data.missingPieces || [],
    orderMissingPieces: data.orderMissingPieces || [],
    lots: data.lots || [],
    warnings: data.warnings || [],
    contextFound: data.contextFound ?? !!(lot || order),
  };
}

async function fetchCollectionContextSummaryDirect(lotId = null, orderId = null) {
  const warnings = [];
  let lot = null;
  let order = null;

  if (lotId) {
    const { data, error } = await supabase
      .from('production_lots')
      .select('*')
      .eq('id', lotId)
      .maybeSingle();
    if (error) throw error;
    lot = normalizeLot(data);
  }

  const resolvedOrderId = orderId || getLotOrderId(lot);
  if (resolvedOrderId) {
    const { data, error } = await supabase
      .from('production_orders')
      .select('*')
      .eq('id', resolvedOrderId)
      .maybeSingle();
    if (error) {
      if (!isSchemaError(error)) warnings.push(`Pedido: ${error.message}`);
    } else {
      order = normalizeOrder(data);
    }
  }

  let lots = await fetchLotsByOrder(resolvedOrderId, warnings);
  if (!lot && lots.length) lot = normalizeLot(lots[0]);
  if (lot && !lots.some((row) => row.id === lot.id)) lots = [lot, ...lots];
  lots = uniqueById(lots).map(normalizeLot);

  const lotIds = lots.map((row) => row.id).filter(Boolean);
  const [items, readings, tags] = await Promise.all([
    fetchRowsForLots('production_lot_items', lotIds, warnings),
    fetchRowsForLots('production_stage_readings', lotIds, warnings),
    fetchRowsForLots('production_tags', lotIds, warnings),
  ]);

  const currentLotItems = lot ? items.filter((item) => item.lot_id === lot.id) : [];
  const currentLotReadings = lot ? readings.filter((reading) => reading.lot_id === lot.id) : [];
  const lotProgress = lot ? buildProgress(currentLotItems, currentLotReadings, lot.planned_quantity, lot) : emptyProgress();
  const plannedOrderTotal = lots.reduce((sum, row) => sum + Math.max(toNumber(row.planned_quantity), items.filter((item) => item.lot_id === row.id).length), 0);
  const orderProgress = buildProgress(items, readings, plannedOrderTotal, {
    completed: lots.reduce((sum, row) => sum + toNumber(row.produced_quantity || row.approved_quantity), 0),
    rejected_quantity: lots.reduce((sum, row) => sum + toNumber(row.rejected_quantity || row.scrap_count), 0),
  });

  return {
    lot,
    order,
    lots,
    lotProgress,
    orderProgress,
    missingPieces: buildMissingPieces(currentLotItems, tags, lots),
    orderMissingPieces: buildMissingPieces(items, tags, lots),
    warnings,
    contextFound: !!(lot || order),
  };
}

function mergeSummaries(rpcSummary, directSummary) {
  if (!rpcSummary) return directSummary;
  if (!directSummary?.contextFound) return rpcSummary;
  return {
    ...rpcSummary,
    ...directSummary,
    lot: directSummary.lot || rpcSummary.lot,
    order: directSummary.order || rpcSummary.order,
    warnings: [...(rpcSummary.warnings || []), ...(directSummary.warnings || [])],
    contextFound: directSummary.contextFound || rpcSummary.contextFound,
  };
}

// ─── Production Entries ───────────────────────────────────────────────────────

/**
 * Busca entradas de produção com paginação e filtros.
 * @param {object} filters
 * @param {number} page — 0-indexed
 * @param {number} pageSize
 * @returns {{ data: object[], total: number, page: number, pageSize: number }}
 */
export async function fetchProductionEntriesPage(filters = {}, page = 0, pageSize = 20) {
  let q = supabase
    .from('production_entries')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  q = applyEntryFilters(q, filters);

  const { data, error, count } = await q;
  if (error) throw error;

  return { data: data || [], total: count ?? 0, page, pageSize };
}

/**
 * Conta total de entradas com filtros.
 */
export async function countProductionEntries(filters = {}) {
  let q = supabase
    .from('production_entries')
    .select('id', { count: 'exact', head: true });

  q = applyEntryFilters(q, filters);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

function applyEntryFilters(q, filters) {
  if (filters.date) q = q.eq('date', filters.date);
  if (filters.dateFrom) q = q.gte('date', filters.dateFrom);
  if (filters.dateTo) q = q.lte('date', filters.dateTo);
  if (filters.cell) q = q.eq('cell', filters.cell);
  if (filters.shift) q = q.eq('shift', filters.shift);
  if (filters.operator) q = q.ilike('operator', `%${filters.operator}%`);
  if (filters.lotCode) q = q.ilike('lot_code', `%${filters.lotCode}%`);
  if (filters.orderNumber) q = q.ilike('order_number', `%${filters.orderNumber}%`);
  if (filters.productName) q = q.ilike('product_name', `%${filters.productName}%`);
  return q;
}

// ─── Production Stage Readings ────────────────────────────────────────────────

/**
 * Busca leituras de coleta com paginação e filtros.
 */
export async function fetchStageReadingsPage(filters = {}, page = 0, pageSize = 30) {
  let q = supabase
    .from('production_stage_readings')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  q = applyReadingFilters(q, filters);

  const { data, error, count } = await q;
  if (error) throw error;

  return { data: data || [], total: count ?? 0, page, pageSize };
}

/**
 * Conta total de leituras com filtros.
 */
export async function countStageReadings(filters = {}) {
  let q = supabase
    .from('production_stage_readings')
    .select('id', { count: 'exact', head: true });

  q = applyReadingFilters(q, filters);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

function applyReadingFilters(q, filters) {
  if (filters.date) q = q.eq('date', filters.date);
  if (filters.dateFrom) q = q.gte('date', filters.dateFrom);
  if (filters.dateTo) q = q.lte('date', filters.dateTo);
  if (filters.cellName) q = q.eq('cell_name', filters.cellName);
  if (filters.shift) q = q.eq('shift', filters.shift);
  if (filters.operator) q = q.ilike('operator', `%${filters.operator}%`);
  if (filters.tagValue) q = q.ilike('tag_value', `%${filters.tagValue}%`);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.lotId) q = q.eq('lot_id', filters.lotId);
  if (filters.stepName) q = q.eq('step_name', filters.stepName);
  return q;
}

// ─── Contexto de coleta por lote/pedido ──────────────────────────────────────

/**
 * Busca o contexto de coleta enriquecido (lote + pedido + contagens).
 * @param {string|null} lotId
 * @param {string|null} orderId
 */
export async function fetchCollectionContextSummary(lotId = null, orderId = null) {
  let rpcSummary = null;
  let rpcError = null;

  try {
    const { data, error } = await supabase.rpc('get_collection_context_summary', {
      p_lot_id: lotId || null,
      p_order_id: orderId || null,
    });
    if (error) throw error;
    rpcSummary = normalizeRpcSummary(data);
  } catch (error) {
    rpcError = error;
  }

  try {
    const directSummary = await fetchCollectionContextSummaryDirect(
      lotId || rpcSummary?.lot?.id || null,
      orderId || rpcSummary?.order?.id || getLotOrderId(rpcSummary?.lot) || null,
    );
    return mergeSummaries(rpcSummary, directSummary);
  } catch (error) {
    if (rpcSummary) {
      return {
        ...rpcSummary,
        warnings: [...(rpcSummary.warnings || []), error.message].filter(Boolean),
      };
    }
    throw rpcError || error;
  }
}

// ─── Registro de ocorrência vinculada a leitura ───────────────────────────────

/**
 * Registra ocorrência vinculada a uma leitura específica.
 */
export async function registerReadingOccurrence(payload) {
  const { data, error } = await supabase.rpc('register_reading_occurrence', {
    p_payload: payload,
  });
  if (error) throw new Error(`Falha ao registrar ocorrência: ${error.message}`);
  return data;
}

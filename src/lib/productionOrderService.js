/**
 * AC.Prod MES — Fase 2 (2025-07)
 * Campos canônicos (migration 025):
 *   - production_order_id  (não order_id)
 *   - current_step         (não current_stage)
 */
import { supabase } from '@/lib/supabaseClient';

const text = (value) => String(value ?? '').trim();
const number = (value) => Math.max(0, Number(value) || 0);
const firstNumber = (...values) => values.map(number).find((value) => value > 0) || 0;

export function normalizeProductionOrder(raw = {}) {
  const orderNumber = text(raw.order_number || raw.orderNumber || raw.pedido || raw.order_code || raw.orderCode);
  const legalName = text(raw.customer_legal_name || raw.customerLegalName || raw.razao_social || raw.customer_name || raw.customerName);
  const tradeName = text(raw.customer_trade_name || raw.customerTradeName || raw.cliente || raw.nome_fantasia || legalName);
  return {
    id: raw.id || undefined,
    order_code: text(raw.order_code || raw.orderCode || raw.system_order_number || raw.systemOrderNumber || orderNumber),
    customer_name: text(raw.customer_name || raw.customerName || tradeName || legalName),
    system_order_number: text(raw.system_order_number || raw.systemOrderNumber || orderNumber),
    customer_order_number: text(raw.customer_order_number || raw.customerOrderNumber),
    order_number: orderNumber,
    load_number: text(raw.load_number || raw.loadNumber || raw.carga),
    customer_code: text(raw.customer_code || raw.customerCode || raw.codigo_cliente),
    customer_legal_name: legalName,
    customer_trade_name: tradeName,
    cnpj: text(raw.cnpj || raw.customer_document),
    city: text(raw.city || raw.cidade),
    state: text(raw.state || raw.uf),
    delivery_region: text(raw.delivery_region || raw.deliveryRegion || raw.regiao),
    finalization_date: raw.finalization_date || raw.finalizationDate || raw.finalizacao || null,
    status: text(raw.status) || 'imported',
    notes: text(raw.notes || raw.observacoes),
    source: raw.source || 'manual',
    items: Array.isArray(raw.items) ? raw.items : [],
    lots: Array.isArray(raw.lots) ? raw.lots : [],
  };
}

function orderPayload(raw) {
  const normalized = normalizeProductionOrder(raw);
  const { id, items, lots, ...payload } = normalized;
  if (!payload.order_code) throw new Error('O número do pedido é obrigatório.');
  return { id, items, lots, payload };
}

export async function createProductionOrder(raw) {
  const { items, lots, payload } = orderPayload(raw);
  const { data: order, error } = await supabase.from('production_orders').insert(payload).select().single();
  if (error) throw new Error(`Falha ao criar pedido: ${error.message}`);
  await persistChildren(order, lots, items);
  await buildProductionSearchIndex({ ...order, lots, items });
  return order;
}

export async function updateProductionOrder(raw) {
  const { id, items, lots, payload } = orderPayload(raw);
  if (!id) throw new Error('Informe o pedido que será atualizado.');
  const { data: order, error } = await supabase.from('production_orders').update(payload).eq('id', id).select().single();
  if (error) throw new Error(`Falha ao atualizar pedido: ${error.message}`);
  await persistChildren(order, lots, items);
  await buildProductionSearchIndex({ ...order, lots, items });
  return order;
}

async function persistChildren(order, lots = [], items = []) {
  const lotMap = new Map();
  for (const rawLot of lots) {
    const lotCode = text(rawLot.lot_code || rawLot.lotCode || rawLot.lote);
    if (!lotCode) continue;
    // FASE 2: production_order_id é o FK canônico; order_id é alias (mantido por compat)
    const canonicalStep = text(rawLot.current_step || rawLot.current_stage) || 'imported';
    const payload = {
      production_order_id: order.id, // [CANÔNICO]
      order_id: order.id,            // [ALIAS] compatibilidade legada
      lot_code: lotCode,
      product_code: text(rawLot.product_code || rawLot.productCode),
      product_name: text(rawLot.product_name || rawLot.productName),
      product_description: text(rawLot.product_description || rawLot.productDescription),
      planned_quantity: number(rawLot.planned_quantity || rawLot.quantity),
      current_step: canonicalStep,   // [CANÔNICO]
      current_stage: canonicalStep,  // [ALIAS] compatibilidade legada
      status: text(rawLot.status) || 'planned',
    };
    const { data, error } = await supabase.from('production_lots').upsert(payload, { onConflict: 'lot_code' }).select().single();
    if (error) throw new Error(`Falha ao salvar lote ${lotCode}: ${error.message}`);
    lotMap.set(lotCode, data.id);
  }

  const rows = items.map((item) => ({
    production_order_id: order.id,
    lot_id: item.lot_id || lotMap.get(text(item.lot_code || item.lotCode || item.lote)) || null,
    product_code: text(item.product_code || item.productCode || item.codigo_produto),
    product_name: text(item.product_name || item.productName || item.produto),
    product_description: text(item.product_description || item.productDescription || item.descricao),
    quantity: number(item.quantity || item.quantidade),
    mirror_quantity: number(item.mirror_quantity || item.mirrorQuantity || item.espelhos),
    sheet_count: firstNumber(item.sheet_count, item.sheetCount, item.qtd_chapas, item.chapas),
    edge_meters: firstNumber(item.edge_meters, item.edgeMeters, item.metros_bordo, item.linear_meters),
    pieces_quantity: firstNumber(item.pieces_quantity, item.piecesQuantity, item.qtd_pecas, item.quantity, item.quantidade),
    covers_quantity: firstNumber(item.covers_quantity, item.coversQuantity, item.qtd_capas, item.capas),
    pallet_number: text(item.pallet_number || item.palletNumber || item.pallet),
    route_code: text(item.route_code || item.routeCode || item.codigo_roteiro),
    route_name: text(item.route_name || item.routeName || item.roteiro),
    status: text(item.status) || 'pending',
  }));
  if (rows.length) {
    const { error } = await supabase.from('production_order_items').insert(rows);
    if (error) throw new Error(`Falha ao salvar itens do pedido: ${error.message}`);
  }
}

async function findOneBy(column, value, legacyColumn) {
  const clean = text(value);
  if (!clean) return null;
  let result = await supabase.from('production_orders').select('*').ilike(column, clean).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error && legacyColumn) {
    result = await supabase.from('production_orders').select('*').ilike(legacyColumn, clean).order('created_at', { ascending: false }).limit(1).maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  return result.data || null;
}

export async function findProductionOrderByPedido(pedido) {
  const columns = ['order_number', 'system_order_number', 'customer_order_number', 'order_code'];
  for (const column of columns) {
    try {
      const order = await findOneBy(column, pedido, column === 'order_number' ? 'order_code' : null);
      if (order) return order;
    } catch (error) {
      if (!/column|schema cache|does not exist/i.test(error.message)) throw error;
    }
  }
  return null;
}

export const findProductionOrderByLoad = (value) => findOneBy('load_number', value);
export const findProductionOrderByCustomer = (value) => findOneBy('customer_legal_name', `%${text(value)}%`, 'customer_name');
export async function findProductionOrderByFinalizationDate(value) {
  const { data, error } = await supabase.from('production_orders').select('*').eq('finalization_date', value).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function importProductionOrders(rows = []) {
  const grouped = new Map();
  rows.forEach((raw) => {
    const normalized = normalizeProductionOrder(raw);
    const key = normalized.order_code;
    if (!key) return;
    const current = grouped.get(key) || { ...normalized, items: [], lots: [] };
    const lotCode = text(raw.lot_code || raw.lotCode || raw.lote);
    if (lotCode && !current.lots.some((lot) => lot.lot_code === lotCode)) current.lots.push({ ...raw, lot_code: lotCode });
    if (raw.product_code || raw.productCode || raw.produto) current.items.push({ ...raw, lot_code: lotCode });
    grouped.set(key, current);
  });
  const result = [];
  for (const order of grouped.values()) {
    const existing = await findProductionOrderByPedido(order.order_number || order.order_code);
    result.push(existing ? await updateProductionOrder({ ...order, id: existing.id }) : await createProductionOrder(order));
  }
  return result;
}

export async function buildProductionSearchIndex(order) {
  if (!order?.id) return null;
  const normalized = normalizeProductionOrder(order);
  const keywords = {
    pedido: normalized.order_number,
    pedido_sistema: normalized.system_order_number,
    carga: normalized.load_number,
    cliente: normalized.customer_trade_name,
    razao_social: normalized.customer_legal_name,
    cnpj: normalized.cnpj,
    finalizacao: normalized.finalization_date,
    lotes: (order.lots || []).map((lot) => lot.lot_code || lot.lotCode),
    produtos: (order.items || []).map((item) => item.product_name || item.productName),
    pallets: (order.items || []).map((item) => item.pallet_number || item.palletNumber),
  };
  const searchText = Object.values(keywords).flat().filter(Boolean).join(' | ');
  const { data, error } = await supabase.from('production_search_index').upsert({
    entity_type: 'production_order',
    entity_id: order.id,
    search_text: searchText,
    keywords_json: keywords,
    status: order.status || 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'entity_type,entity_id' }).select().maybeSingle();
  if (error && !/schema cache|does not exist/i.test(error.message || '')) throw error;
  return data || null;
}

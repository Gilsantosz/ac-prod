import { supabase } from '@/lib/supabaseClient';

const EMPTY_CONTEXT = {
  productionOrder: null,
  lot: null,
  item: null,
  route: null,
  contextFound: false,
  matchedBy: null,
  warnings: [],
};

const cleanValue = (value) => String(value ?? '').trim();
const isSchemaError = (error) => /PGRST202|PGRST204|schema cache|does not exist|could not find/i.test(`${error?.code || ''} ${error?.message || ''}`);

function normalizeContext(result = {}) {
  return {
    ...EMPTY_CONTEXT,
    ...result,
    contextFound: !!result.contextFound,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

async function hydrateLot(lot, matchedBy = 'lot', warnings = []) {
  if (!lot) return normalizeContext({ warnings });
  const orderId = lot.production_order_id || lot.order_id;
  const [orderResult, itemResult, legacyItemResult, routeResult] = await Promise.all([
    orderId ? supabase.from('production_orders').select('*').eq('id', orderId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('production_order_items').select('*').eq('lot_id', lot.id).order('created_at').limit(1).maybeSingle(),
    supabase.from('production_lot_items').select('*').eq('lot_id', lot.id).order('created_at').limit(1).maybeSingle(),
    supabase.from('production_routes').select('*').eq('lot_id', lot.id).eq('required', true).order('step_order'),
  ]);
  const routes = routeResult.data || [];
  const route = routes.find((step) => !['completed', 'skipped'].includes(step.status))
    || routes.find((step) => step.step_name === (lot.current_step || lot.current_stage))
    || routes[0]
    || null;
  if (itemResult.error && !isSchemaError(itemResult.error)) warnings.push(itemResult.error.message);
  return normalizeContext({
    productionOrder: orderResult.data || null,
    lot,
    item: itemResult.data || legacyItemResult.data || null,
    route,
    routes,
    contextFound: true,
    matchedBy,
    warnings,
  });
}

async function byLot(value) {
  const { data, error } = await supabase.from('production_lots').select('*').ilike('lot_code', cleanValue(value)).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return hydrateLot(data, 'lot');
}

async function byOrder(value) {
  const clean = cleanValue(value);
  const columns = ['order_number', 'system_order_number', 'customer_order_number', 'order_code'];
  let order = null;
  for (const column of columns) {
    const result = await supabase.from('production_orders').select('*').ilike(column, clean).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!result.error && result.data) { order = result.data; break; }
    if (result.error && !isSchemaError(result.error)) throw result.error;
  }
  if (!order) return normalizeContext({ warnings: [`Pedido ${clean} não localizado.`] });
  let lotsResult = await supabase.from('production_lots').select('*').eq('production_order_id', order.id).order('created_at', { ascending: false }).limit(2);
  if (lotsResult.error && isSchemaError(lotsResult.error)) lotsResult = await supabase.from('production_lots').select('*').eq('order_id', order.id).order('created_at', { ascending: false }).limit(2);
  if (lotsResult.error) throw lotsResult.error;
  const context = await hydrateLot(lotsResult.data?.[0], 'order', lotsResult.data?.length > 1 ? ['Pedido com vários lotes; foi selecionado o lote mais recente.'] : []);
  return normalizeContext({ ...context, productionOrder: order, contextFound: true, matchedBy: 'order' });
}

async function byOrderColumn(column, value, matchedBy) {
  const clean = cleanValue(value);
  const { data: order, error } = await supabase.from('production_orders').select('*').ilike(column, clean).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (isSchemaError(error)) return normalizeContext({ warnings: [`Busca por ${matchedBy} requer a migração de contexto produtivo.`] });
    throw error;
  }
  if (!order) return normalizeContext({ warnings: [`${matchedBy} ${clean} não localizado.`] });
  const context = await byOrder(order.order_number || order.order_code);
  return normalizeContext({ ...context, productionOrder: order, matchedBy, contextFound: true });
}

export const lookupByPedido = byOrder;
export const lookupByLote = byLot;
export const lookupByCarga = (value) => byOrderColumn('load_number', value, 'load');

export async function lookupByPallet(value) {
  const clean = cleanValue(value);
  const { data: item, error } = await supabase.from('production_order_items').select('*').ilike('pallet_number', clean).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (isSchemaError(error)) return normalizeContext({ warnings: ['Busca por pallet requer a migração de contexto produtivo.'] });
    throw error;
  }
  if (!item) return normalizeContext({ warnings: [`Pallet ${clean} não localizado.`] });
  const { data: lot } = item.lot_id ? await supabase.from('production_lots').select('*').eq('id', item.lot_id).maybeSingle() : { data: null };
  let context;
  if (lot) {
    context = await hydrateLot(lot, 'pallet');
  } else {
    const { data: productionOrder } = await supabase.from('production_orders').select('*').eq('id', item.production_order_id).maybeSingle();
    context = normalizeContext({ productionOrder, item, matchedBy: 'pallet', contextFound: true });
  }
  return normalizeContext({ ...context, item, matchedBy: 'pallet', contextFound: true });
}

export async function lookupByTagValue(value) {
  const clean = cleanValue(value).toUpperCase();
  const { data: tag, error } = await supabase.from('production_tags').select('*').eq('tag_value', clean).eq('active', true).maybeSingle();
  if (error) {
    if (isSchemaError(error)) return normalizeContext({ warnings: ['Estrutura de etiquetas ainda não disponível.'] });
    throw error;
  }
  if (!tag) return normalizeContext({ warnings: [`Etiqueta ${clean} não localizada.`] });
  const { data: lot, error: lotError } = await supabase.from('production_lots').select('*').eq('id', tag.lot_id).maybeSingle();
  if (lotError) throw lotError;
  const context = await hydrateLot(lot, 'tag');
  return normalizeContext({ ...context, tag, matchedBy: 'tag', contextFound: true });
}

async function fallbackResolve(value, hint) {
  const attempts = hint === 'tag' ? [lookupByTagValue, lookupByLote, lookupByPedido, lookupByPallet, lookupByCarga]
    : hint === 'lot' ? [lookupByLote]
      : hint === 'order' ? [lookupByPedido]
        : hint === 'load' ? [lookupByCarga]
          : hint === 'pallet' ? [lookupByPallet]
            : [lookupByTagValue, lookupByLote, lookupByPedido, lookupByPallet, lookupByCarga];
  const warnings = [];
  for (const lookup of attempts) {
    try {
      const result = await lookup(value);
      if (result.contextFound) return result;
      warnings.push(...result.warnings);
    } catch (error) {
      if (!isSchemaError(error)) warnings.push(error.message);
    }
  }
  return normalizeContext({ warnings: [...new Set(warnings.length ? warnings : ['Contexto produtivo não localizado. Rastreabilidade limitada.'])] });
}

export async function resolveProductionContext(input, dependencies = {}) {
  const descriptor = typeof input === 'object' && input !== null ? input : { value: input };
  const value = cleanValue(descriptor.value || descriptor.rawValue || descriptor.tagValue || descriptor.pedido || descriptor.lote || descriptor.carga || descriptor.pallet);
  const hint = cleanValue(descriptor.type || descriptor.hint || (descriptor.tagValue ? 'tag' : '')).toLowerCase();
  if (!value) return normalizeContext({ warnings: ['Informe Pedido, Lote, Carga, Pallet ou etiqueta.'] });
  if (dependencies.repository?.resolve) return normalizeContext(await dependencies.repository.resolve(value, hint));

  const { data, error } = await supabase.rpc('resolve_production_context', { p_input: value, p_hint: hint || null });
  if (!error && data) return normalizeContext(data);
  if (error && !isSchemaError(error)) throw new Error(`Falha ao resolver contexto produtivo: ${error.message}`);
  return fallbackResolve(value, hint);
}

export function productionContextToEntryFields(context = {}) {
  const order = context.productionOrder || {};
  const lot = context.lot || {};
  const item = context.item || {};
  const route = context.route || {};
  return {
    production_order_id: order.id || lot.production_order_id || lot.order_id || null,
    order_id: order.id || lot.production_order_id || lot.order_id || null,
    lot_id: lot.id || null,
    order_item_id: item.id || null,
    system_order_number: order.system_order_number || order.order_code || '',
    customer_order_number: order.customer_order_number || '',
    order_number: order.order_number || order.order_code || lot.order_number || '',
    load_number: order.load_number || '',
    lot_code: lot.lot_code || '',
    customer_code: order.customer_code || '',
    customer_legal_name: order.customer_legal_name || order.customer_name || '',
    customer_trade_name: order.customer_trade_name || order.customer_name || '',
    customer_name: order.customer_trade_name || order.customer_name || '',
    cnpj: order.cnpj || '',
    product_code: item.product_code || lot.product_code || '',
    product_name: item.product_name || lot.product_name || '',
    product_description: item.product_description || lot.product_description || '',
    route_code: item.route_code || '',
    route_name: item.route_name || '',
    process_step: route.step_name || lot.current_step || lot.current_stage || '',
    finalization_date: order.finalization_date || '',
    city: order.city || '',
    state: order.state || '',
    delivery_region: order.delivery_region || '',
    mirror_quantity: Number(item.mirror_quantity) || 0,
    pallet_number: item.pallet_number || '',
    traceability_status: context.contextFound ? 'resolved' : 'limited',
  };
}

import { supabase } from '@/lib/supabaseClient';

function ensure(result, context) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data || [];
}

async function findLots(search) {
  const term = String(search || '').trim().slice(0, 120);
  if (!term) return [];

  const lotResult = await supabase
    .from('production_lots')
    .select(`
      *,
      production_orders (id, order_code, customer_name, delivery_date, status),
      lot_items (
        id, piece_code, piece_name, quantity, status,
        requires_cut, requires_edge, requires_cnc, requires_joinery,
        requires_separation, requires_packaging, requires_shipping
      )
    `)
    .ilike('lot_code', `%${term}%`)
    .order('created_at', { ascending: false })
    .limit(6);

  let lots = ensure(lotResult, 'Falha ao consultar lotes');
  if (lots.length) return lots;

  const orderResult = await supabase
    .from('production_orders')
    .select('id')
    .ilike('order_code', `%${term}%`)
    .limit(6);
  const orders = ensure(orderResult, 'Falha ao consultar pedidos');
  if (!orders.length) return [];

  const byOrderResult = await supabase
    .from('production_lots')
    .select(`
      *,
      production_orders (id, order_code, customer_name, delivery_date, status),
      lot_items (
        id, piece_code, piece_name, quantity, status,
        requires_cut, requires_edge, requires_cnc, requires_joinery,
        requires_separation, requires_packaging, requires_shipping
      )
    `)
    .in('order_id', orders.map((order) => order.id))
    .order('created_at', { ascending: false })
    .limit(6);

  lots = ensure(byOrderResult, 'Falha ao consultar lotes do pedido');
  return lots;
}

export async function fetchLotSnapshot(search) {
  const matches = await findLots(search);
  if (matches.length !== 1) return { matches };

  const lot = matches[0];
  const [eventResult, packageResult, shipmentResult] = await Promise.all([
    supabase
      .from('lot_step_events')
      .select('id, step_code, event_type, quantity, cell, reason_code, notes, created_at')
      .eq('lot_id', lot.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('packages')
      .select('id, package_code, volume_number, status, total_items, closed_at, created_at')
      .eq('lot_id', lot.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('shipments')
      .select('id, shipment_code, carrier, vehicle, driver, tracking_code, shipped_at, status, created_at')
      .eq('lot_id', lot.id)
      .order('created_at', { ascending: false }),
  ]);

  return {
    matches,
    lot,
    events: ensure(eventResult, 'Falha ao consultar o histórico do lote'),
    packages: ensure(packageResult, 'Falha ao consultar as embalagens'),
    shipments: ensure(shipmentResult, 'Falha ao consultar a expedição'),
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function fetchProductionSnapshot() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);

  const [entryResult, occurrenceResult, lotResult] = await Promise.all([
    supabase
      .from('production_entries')
      .select('date, shift, cell, hour, produced, target, scrap, downtime')
      .gte('date', isoDate(start))
      .lte('date', isoDate(end))
      .order('date', { ascending: false })
      .limit(5000),
    supabase
      .from('occurrences')
      .select('date, shift, cell, reason, downtime')
      .gte('date', isoDate(start))
      .lte('date', isoDate(end))
      .order('date', { ascending: false })
      .limit(1000),
    supabase
      .from('production_lots')
      .select('id, lot_code, status, current_stage, created_at, production_orders(delivery_date)')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  return {
    entries: ensure(entryResult, 'Falha ao consultar produção'),
    occurrences: ensure(occurrenceResult, 'Falha ao consultar ocorrências'),
    lots: ensure(lotResult, 'Falha ao consultar o fluxo de lotes'),
    periodStart: isoDate(start),
    periodEnd: isoDate(end),
  };
}

import { supabase } from '@/lib/supabaseClient';

function mergeCanonicalContext(fallbackOrder, context) {
  if (!context?.order || !context?.original_piece) {
    throw new Error(`Contexto canônico incompleto para a reposição ${fallbackOrder?.replacement_code || fallbackOrder?.id || ''}.`);
  }

  const order = context.order;
  const originalPiece = context.original_piece;
  const replacementPiece = context.replacement_piece || null;

  if (String(order.original_piece_id) !== String(originalPiece.id)) {
    throw new Error(`Vínculo inconsistente entre a ordem ${order.replacement_code || order.id} e a peça reprovada.`);
  }

  return {
    ...fallbackOrder,
    ...order,
    original_piece: originalPiece,
    replacement_piece: replacementPiece,
    route_steps: context.route_steps || originalPiece.route_steps || [],
    resolved_client_lot: order.lot_code || originalPiece.lot_code || null,
    resolved_general_lot: order.general_lot_code || originalPiece.general_lot_code || null,
    canonical_barcode: context.barcode || originalPiece.traceability_code || originalPiece.piece_uid || null,
    canonical_integrity: context.integrity || null,
  };
}

async function fetchReplacementOrderContext(order) {
  const { data, error } = await supabase.rpc('get_replacement_order_context', {
    p_order_id: order.id,
  });

  if (error) {
    throw new Error(
      `Não foi possível confirmar a peça reprovada da ordem ${order.replacement_code || order.id}: ${error.message}`,
    );
  }

  return mergeCanonicalContext(order, data);
}

export async function getCanonicalReplacementOrder(orderId) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');
  return fetchReplacementOrderContext({ id: orderId });
}

export async function getCanonicalReplacementOrders({
  status = null,
  priority = null,
  cellId = null,
  lotCode = null,
  orderNumber = null,
  customerName = null,
  defectId = null,
  search = null,
  limit = 50,
  offset = 0,
} = {}) {
  let query = supabase
    .from('replacement_orders')
    .select('*', { count: 'exact' });

  if (status && status !== 'all') query = query.eq('status', status);
  if (priority && priority !== 'all') query = query.eq('priority', priority);
  if (cellId) query = query.eq('origin_cell_id', cellId);
  if (lotCode) query = query.ilike('lot_code', `%${lotCode}%`);
  if (orderNumber) query = query.ilike('order_number', `%${orderNumber}%`);
  if (customerName) query = query.ilike('customer_name', `%${customerName}%`);
  if (defectId) query = query.eq('defect_id', defectId);
  if (search?.trim()) {
    const term = search.trim();
    query = query.or([
      `replacement_code.ilike.%${term}%`,
      `reason.ilike.%${term}%`,
      `lot_code.ilike.%${term}%`,
      `general_lot_code.ilike.%${term}%`,
      `order_number.ilike.%${term}%`,
      `customer_name.ilike.%${term}%`,
    ].join(','));
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`Falha ao carregar ordens de reposição: ${error.message}`);

  const orders = await Promise.all((data || []).map(fetchReplacementOrderContext));
  return { orders, count: Number(count || 0) };
}

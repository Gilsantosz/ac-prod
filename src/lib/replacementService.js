import { supabase } from '@/lib/supabaseClient';
import { getDeviceId } from '@/lib/operatorSessionService';

export const REPLACEMENT_EVENT_KIND = 'replacement_stage';

export const REPLACEMENT_STATUS_LABELS = {
  requested: 'Solicitada',
  under_review: 'Em análise',
  approved: 'Aprovada',
  released: 'Liberada',
  in_production: 'Em fabricação',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  'Reposição solicitada': 'Solicitada',
  'Reposição em produção': 'Em fabricação',
  Finalizada: 'Concluída',
  Cancelada: 'Cancelada',
};

const OPEN_STATUSES = new Set(['requested', 'under_review', 'approved', 'released', 'in_production', 'Reposição solicitada', 'Reposição em produção']);
const COMPLETED_STATUSES = new Set(['completed', 'Finalizada']);

function requireSuccess(data, fallbackMessage) {
  if (!data?.success) {
    const error = new Error(data?.message || data?.error || fallbackMessage);
    error.result = data || null;
    error.retryable = false;
    throw error;
  }
  return data;
}

export async function getReplacementOrders({ limit = 250 } = {}) {
  const { data, error } = await supabase
    .from('replacement_orders')
    .select(`
      *,
      original_piece:original_piece_id (
        id, piece_uid, traceability_code, piece_code, piece_name, description,
        material, color, thickness, width, height, length, status,
        replacement_status, current_stage, route_steps, completed_steps
      ),
      replacement_piece:replacement_piece_id (
        id, piece_uid, traceability_code, piece_code, piece_name, description,
        material, color, thickness, width, height, length, status,
        replacement_status, current_stage, route_steps, completed_steps
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  const orders = data || [];
  const productionOrderIds = [...new Set(orders.map((item) => item.production_order_id).filter(Boolean))];
  const lotIds = [...new Set(orders.map((item) => item.lot_id).filter(Boolean))];
  const [productionOrdersResult, lotsResult] = await Promise.all([
    productionOrderIds.length
      ? supabase.from('production_orders').select('*').in('id', productionOrderIds)
      : Promise.resolve({ data: [], error: null }),
    lotIds.length
      ? supabase.from('production_lots').select('*').in('id', lotIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productionOrdersResult.error) throw productionOrdersResult.error;
  if (lotsResult.error) throw lotsResult.error;
  const productionOrders = new Map((productionOrdersResult.data || []).map((item) => [item.id, item]));
  const lots = new Map((lotsResult.data || []).map((item) => [item.id, item]));
  return orders.map((item) => ({
    ...item,
    production_order: productionOrders.get(item.production_order_id) || null,
    production_lot: lots.get(item.lot_id) || null,
  }));
}

export function calculateReplacementAdminSummary(orders, now = new Date()) {
  const shiftHour = now.getHours();
  const shiftStart = new Date(now);
  if (shiftHour >= 6 && shiftHour < 14) shiftStart.setHours(6, 0, 0, 0);
  else if (shiftHour >= 14 && shiftHour < 22) shiftStart.setHours(14, 0, 0, 0);
  else {
    if (shiftHour < 6) shiftStart.setDate(shiftStart.getDate() - 1);
    shiftStart.setHours(22, 0, 0, 0);
  }

  return (orders || []).reduce((summary, order) => {
    const createdAt = new Date(order.created_at || 0);
    const completedAt = order.completed_at ? new Date(order.completed_at) : null;
    if (order.status === 'released') summary.available += 1;
    if (order.status === 'in_production' || order.status === 'Reposição em produção') summary.inProduction += 1;
    if (OPEN_STATUSES.has(order.status) && now.getTime() - createdAt.getTime() > 86_400_000) summary.delayed += 1;
    if (COMPLETED_STATUSES.has(order.status) && completedAt && completedAt >= shiftStart) summary.completedThisShift += 1;
    if (OPEN_STATUSES.has(order.status)) summary.open += 1;
    if (COMPLETED_STATUSES.has(order.status)) summary.completed += 1;
    if (['cancelled', 'Cancelada'].includes(order.status)) summary.cancelled += 1;
    return summary;
  }, {
    available: 0,
    inProduction: 0,
    delayed: 0,
    completedThisShift: 0,
    open: 0,
    completed: 0,
    cancelled: 0,
  });
}

export async function getActiveReplacementOperators() {
  const { data, error } = await supabase
    .from('operator_sessions')
    .select(`
      id, started_at, last_seen_at, expires_at, shift_snapshot,
      cell_id, cell_name_snapshot, machine_id, machine_name_snapshot,
      operator:operator_id (id, name, registration)
    `)
    .is('ended_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function approveReplacement(orderId, payload = {}) {
  const { data, error } = await supabase.rpc('approve_piece_replacement', {
    p_order_id: orderId,
    p_payload: payload,
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível aprovar a reposição.');
}

export async function releaseReplacement(orderId, payload = {}) {
  const { data, error } = await supabase.rpc('release_piece_replacement', {
    p_order_id: orderId,
    p_payload: payload,
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível liberar a reposição.');
}

export async function cancelReplacement(orderId, reason) {
  const { data, error } = await supabase.rpc('cancel_piece_replacement', {
    p_order_id: orderId,
    p_payload: { reason },
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível cancelar a reposição.');
}

export async function forceCompleteReplacement(orderId, reason) {
  const { data, error } = await supabase.rpc('force_complete_piece_replacement', {
    p_order_id: orderId,
    p_reason: reason,
    p_payload: { source: 'replacement_admin', reason },
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível concluir a reposição de forma auditada.');
}

export async function registerReplacementLabelPrint(order, { reason = null, printerName = 'Navegador' } = {}) {
  const clientEventId = crypto.randomUUID();
  const { data, error } = await supabase.rpc('register_replacement_label_print', {
    p_replacement_request_id: order.id,
    p_reprint_reason: reason ? 'operational_reprint' : null,
    p_reprint_reason_details: reason,
    p_printer_name: printerName,
    p_user_name: null,
    p_client_event_id: clientEventId,
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível auditar a impressão.');
}

export async function getReplacementHistory(orderId = null) {
  let printsQuery = supabase
    .from('replacement_label_prints')
    .select('*')
    .order('printed_at', { ascending: false })
    .limit(100);
  let auditQuery = supabase
    .from('system_audit_logs')
    .select('id, action, entity_id, user_name, metadata, success, created_at')
    .eq('entity', 'replacement_orders')
    .order('created_at', { ascending: false })
    .limit(200);
  if (orderId) {
    printsQuery = printsQuery.eq('replacement_request_id', orderId);
    auditQuery = auditQuery.eq('entity_id', orderId);
  }
  const [prints, audits] = await Promise.all([printsQuery, auditQuery]);
  if (prints.error) throw prints.error;
  if (audits.error) throw audits.error;
  return { prints: prints.data || [], audits: audits.data || [] };
}

export async function getReplacementStationQueue(sessionToken) {
  const { data, error } = await supabase.rpc('get_replacement_station_queue_v2', {
    p_session_token: sessionToken,
    p_device_id: getDeviceId(),
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível carregar a fila do posto.');
}

export async function collectReplacementStageV2({
  sessionToken,
  barcode,
  clientEventId,
  deviceId = getDeviceId(),
  createdAtClient = new Date().toISOString(),
  payload = {},
}) {
  const { data, error } = await supabase.rpc('collect_replacement_stage_v2', {
    p_session_token: sessionToken,
    p_barcode: String(barcode || '').trim(),
    p_client_event_id: clientEventId,
    p_device_id: deviceId,
    p_created_at_client: createdAtClient,
    p_payload: payload,
  });
  if (error) {
    const rpcError = new Error(error.message || 'Falha de comunicação com a RPC de reposição.');
    rpcError.retryable = true;
    throw rpcError;
  }
  return requireSuccess(data, 'Leitura de reposição bloqueada.');
}

export function subscribeToReplacementCell({ cellId, onMessage, onStatus }) {
  if (!cellId) return null;
  const channel = supabase
    .channel(`replacement:cell:${cellId}`, { config: { private: true } })
    .on('broadcast', { event: '*' }, (message) => onMessage?.(message))
    .subscribe((status) => onStatus?.(status));
  return channel;
}

export function unsubscribeFromReplacementCell(channel) {
  if (!channel) return Promise.resolve();
  return supabase.removeChannel(channel);
}

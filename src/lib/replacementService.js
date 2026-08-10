import { supabase } from '@/lib/supabaseClient';
import { getDeviceId } from '@/lib/operatorSessionService';

export const REPLACEMENT_EVENT_KIND = 'replacement_stage';

export const REPLACEMENT_STATUS_LABELS = {
  requested: { label: 'Solicitada', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  under_review: { label: 'Em análise', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  approved: { label: 'Aprovada', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  released: { label: 'Liberada', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' },
  in_production: { label: 'Em fabricação', color: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20' },
  completed: { label: 'Concluída', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  cancelled: { label: 'Cancelada', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' },
  'Reposição solicitada': { label: 'Solicitada', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  'Reposição em produção': { label: 'Em fabricação', color: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20' },
  Finalizada: { label: 'Concluída', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  Cancelada: { label: 'Cancelada', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' },
};

export const REPLACEMENT_PRIORITY_LABELS = {
  normal: { label: 'Normal', color: 'text-slate-600 dark:text-slate-400' },
  high: { label: 'Alta', color: 'text-amber-600 dark:text-amber-400 font-semibold' },
  critical: { label: 'Crítica', color: 'text-rose-600 dark:text-rose-400 font-extrabold animate-pulse' },
};

export const STAGE_NAME_MAP = {
  cut: 'Corte',
  corte: 'Corte',
  edge: 'Borda',
  borda: 'Borda',
  bordo: 'Borda',
  drill: 'Furação',
  furacao: 'Furação',
  furação: 'Furação',
  cnc: 'Usinagem CNC',
  'usinagem cnc': 'Usinagem CNC',
  canal: 'Canal',
  maranello: 'Maranello',
  portajoias: 'Porta Joias',
  porta_joias: 'Porta Joias',
  'porta joias': 'Porta Joias',
  sorrento: 'Sorrento',
  usi_especial: 'Usi Especial',
  'usi especial': 'Usi Especial',
  rasgo_freggio: 'Rasgo Freggio',
  'rasgo freggio': 'Rasgo Freggio',
  joinery: 'Marcenaria',
  marcenaria: 'Marcenaria',
  separation: 'Separação',
  separacao: 'Separação',
  separação: 'Separação',
  packaging: 'Embalagem',
  embalagem: 'Embalagem',
  shipping: 'Expedição',
  expedicao: 'Expedição',
  expedição: 'Expedição',
  created: 'Criada',
  criada: 'Criada',
  completed: 'Concluída',
  concluida: 'Concluída',
  concluída: 'Concluída',
};

export function formatStageName(stage) {
  if (!stage) return 'Corte';
  const value = String(stage).trim();
  const normalized = value.toLocaleLowerCase('pt-BR');
  if (STAGE_NAME_MAP[normalized]) return STAGE_NAME_MAP[normalized];
  for (const [key, label] of Object.entries(STAGE_NAME_MAP)) {
    if (key.length >= 3 && (normalized.startsWith(`${key} `) || normalized.startsWith(`${key}(`))) {
      return value.replace(new RegExp(`^${key}`, 'i'), label);
    }
  }
  return value;
}

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
  return orders.map((item) => enrichReplacementOrderData({
    ...item,
    production_order: productionOrders.get(item.production_order_id) || null,
    production_lot: lots.get(item.lot_id) || null,
  }));
}

export function enrichReplacementOrderData(order) {
  if (!order) return order;
  const original = order.original_piece || {};
  const replacement = order.replacement_piece || {};
  const lot = original.lot || order.production_lot || {};
  const storedStage = String(order.rejection_stage || '').trim();
  const invalidStages = new Set(['', 'n/a', 'concluída', 'concluida', 'completed', 'created']);
  const rawStage = invalidStages.has(storedStage.toLocaleLowerCase('pt-BR'))
    ? original.current_stage || 'Corte'
    : storedStage;
  const rejectionStage = formatStageName(rawStage);
  const clientLot = order.resolved_client_lot || order.lot_code || original.lot_code || lot.lot_code || null;
  const generalLot = order.resolved_general_lot || order.general_lot_code || original.general_lot_code || lot.general_lot_code || null;
  const traceabilityCode = original.traceability_code || original.piece_uid || original.piece_code || null;
  const route = Array.isArray(original.route_steps) && original.route_steps.length
    ? original.route_steps.map(formatStageName)
    : [];

  return {
    ...order,
    rejection_stage: rejectionStage,
    origin_cell_name: order.origin_cell_name || `Célula de ${rejectionStage}`,
    environment_name: order.environment_name || original.environment_name || original.environment || null,
    resolved_client_lot: clientLot,
    resolved_general_lot: generalLot,
    original_piece: {
      ...original,
      piece_code: original.piece_code || traceabilityCode,
      piece_uid: original.piece_uid || traceabilityCode,
      traceability_code: traceabilityCode,
      lot_code: clientLot,
      general_lot_code: generalLot,
      route_steps: route,
    },
    replacement_piece: replacement,
    route_steps: route,
  };
}

export async function getReplacementReportOrder(order) {
  if (!order?.id) throw new Error('Ordem de reposição inválida para o relatório.');
  const pieceIds = [
    order.original_piece?.id || order.original_piece_id,
    order.replacement_piece?.id || order.replacement_piece_id,
  ].filter(Boolean);
  if (!pieceIds.length) throw new Error('A ordem não possui peça rastreável vinculada.');

  const { data, error } = await supabase
    .from('production_stage_readings')
    .select(`
      id, piece_id, tag_value, step_name, cell_name, station_name,
      machine_name, operator, operator_name_snapshot, shift, status,
      event_type, entry_type, traceability_type, notes, created_at
    `)
    .in('piece_id', pieceIds)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`Não foi possível carregar a rastreabilidade do relatório: ${error.message}`);
  return { ...order, traceability_readings: data || [] };
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
  const normalizedReason = typeof reason === 'string' ? reason.trim() : String(reason?.reason || '').trim();
  if (!normalizedReason) throw new Error('Motivo é obrigatório para cancelar a reposição.');
  const { data, error } = await supabase.rpc('cancel_piece_replacement', {
    p_order_id: orderId,
    p_payload: { reason: normalizedReason },
  });
  if (error) throw error;
  return requireSuccess(data, 'Não foi possível cancelar a reposição.');
}

export async function forceCompleteReplacement(orderId, reason) {
  const normalizedReason = typeof reason === 'string' ? reason.trim() : String(reason?.reason || '').trim();
  if (!normalizedReason) throw new Error('Justificativa é obrigatória para a conclusão forçada.');
  const { data, error } = await supabase.rpc('force_complete_piece_replacement', {
    p_order_id: orderId,
    p_reason: normalizedReason,
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

export async function getEnabledWorkstations(userAllowedCells = null, userRole = null) {
  const { data, error } = await supabase
    .from('production_machines')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) throw error;

  let workstations = (data || []).filter((machine) => machine.allows_replacement !== false);
  const allowedNames = (Array.isArray(userAllowedCells) ? userAllowedCells : [userAllowedCells])
    .filter(Boolean)
    .map((name) => String(name).trim());
  if (userRole !== 'admin' && allowedNames.length) {
    const allowed = allowedNames.map((name) => name.toLocaleLowerCase('pt-BR'));
    workstations = workstations.filter((machine) => {
      const cell = String(machine.cell_name || machine.name || '').toLocaleLowerCase('pt-BR');
      return allowed.some((name) => cell.includes(name) || name.includes(cell));
    });
  }
  return workstations;
}

export async function getOperatorWorkstationAuthorizations(operatorId) {
  if (!operatorId) return [];
  const { data, error } = await supabase
    .from('workstation_operator_authorizations')
    .select('*, machine:machine_id (id, name, cell_name), cell:cell_id (id, name)')
    .eq('operator_id', operatorId)
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

export async function grantOperatorWorkstationAuthorization({
  operatorId,
  machineId = null,
  cellId = null,
  shift = '1',
  authorizationType = 'permanent',
  validUntil = null,
  notes = '',
}) {
  if (!operatorId) throw new Error('ID do operador é obrigatório.');
  const { data, error } = await supabase
    .from('workstation_operator_authorizations')
    .insert({
      operator_id: operatorId,
      machine_id: machineId,
      cell_id: cellId,
      shift,
      authorization_type: authorizationType,
      valid_until: validUntil,
      is_active: true,
      notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

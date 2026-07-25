/**
 * AC.Prod MES — Serviço de Gestão de Ordens de Reposição de Peças
 * Fonte oficial: tabela replacement_orders
 */

import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';

/**
 * Mapeamento dos rótulos técnicos para exibição na interface.
 */
export const REPLACEMENT_STATUS_LABELS = {
  requested: { label: 'Solicitada', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  under_review: { label: 'Em Análise', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  approved: { label: 'Aprovada', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  released: { label: 'Liberada', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' },
  in_production: { label: 'Em Produção', color: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20' },
  completed: { label: 'Concluída', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  cancelled: { label: 'Cancelada', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' }
};

export const REPLACEMENT_PRIORITY_LABELS = {
  normal: { label: 'Normal', color: 'text-slate-600 dark:text-slate-400' },
  high: { label: 'Alta', color: 'text-amber-600 dark:text-amber-400 font-semibold' },
  critical: { label: 'Crítica', color: 'text-rose-600 dark:text-rose-400 font-extrabold animate-pulse' }
};

/**
 * Busca a lista de ordens de reposição com filtros e paginação.
 */
export async function getReplacementOrders({
  status = null,
  priority = null,
  cellId = null,
  lotCode = null,
  orderNumber = null,
  customerName = null,
  defectId = null,
  search = null,
  limit = 50,
  offset = 0
} = {}) {
  let query = supabase
    .from('replacement_orders')
    .select(`
      *,
      original_piece:original_piece_id (
        id, piece_name, piece_code, piece_uid, current_stage, status, material, thickness, color, length, width
      ),
      replacement_piece:replacement_piece_id (
        id, piece_name, piece_code, piece_uid, current_stage, status, is_replacement
      ),
      defect:defect_id (
        id, code, name, category, six_m_category
      )
    `, { count: 'exact' });

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (priority && priority !== 'all') {
    query = query.eq('priority', priority);
  }
  if (cellId) {
    query = query.eq('origin_cell_id', cellId);
  }
  if (lotCode) {
    query = query.ilike('lot_code', `%${lotCode}%`);
  }
  if (orderNumber) {
    query = query.ilike('order_number', `%${orderNumber}%`);
  }
  if (customerName) {
    query = query.ilike('customer_name', `%${customerName}%`);
  }
  if (defectId) {
    query = query.eq('defect_id', defectId);
  }
  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(`replacement_code.ilike.%${term}%,reason.ilike.%${term}%,lot_code.ilike.%${term}%,order_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
  }

  query = query.order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error('Erro ao buscar ordens de reposição:', error);
    throw error;
  }

  return {
    orders: data || [],
    count: count || 0
  };
}

/**
 * Calcula KPIs acumulados e consolidados do módulo de Reposição.
 */
export async function getReplacementKpis() {
  const { data: rows, error } = await supabase
    .from('replacement_orders')
    .select('id, status, priority, created_at, completed_at, origin_cell_name, reason');

  if (error) {
    console.error('Erro ao buscar KPIs de reposição:', error);
    throw error;
  }

  const list = rows || [];
  const total = list.length;
  const requested = list.filter(r => r.status === 'requested').length;
  const underReview = list.filter(r => r.status === 'under_review').length;
  const approved = list.filter(r => r.status === 'approved').length;
  const released = list.filter(r => r.status === 'released').length;
  const inProduction = list.filter(r => r.status === 'in_production').length;
  const completed = list.filter(r => r.status === 'completed').length;
  const cancelled = list.filter(r => r.status === 'cancelled').length;

  // Reposições atrasadas (> 24h sem concluir)
  const now = new Date();
  const delayed = list.filter(r => {
    if (['completed', 'cancelled'].includes(r.status)) return false;
    const createdAt = new Date(r.created_at);
    const diffHours = (now - createdAt) / (1000 * 60 * 60);
    return diffHours > 24;
  }).length;

  // Tempo médio de reposição (em horas) para ordens concluídas
  const completedOrders = list.filter(r => r.status === 'completed' && r.completed_at && r.created_at);
  const avgHours = completedOrders.length > 0
    ? completedOrders.reduce((sum, r) => {
        const start = new Date(r.created_at);
        const end = new Date(r.completed_at);
        return sum + (end - start) / (1000 * 60 * 60);
      }, 0) / completedOrders.length
    : 0;

  // Agrupamento por Célula
  const byCellMap = {};
  list.forEach(r => {
    const cell = r.origin_cell_name || 'Não Especificada';
    byCellMap[cell] = (byCellMap[cell] || 0) + 1;
  });
  const byCell = Object.entries(byCellMap).map(([cell, count]) => ({ cell, count }));

  // Agrupamento por Motivo
  const byReasonMap = {};
  list.forEach(r => {
    const reason = r.reason || 'Outros';
    byReasonMap[reason] = (byReasonMap[reason] || 0) + 1;
  });
  const byReason = Object.entries(byReasonMap).map(([reason, count]) => ({ reason, count }));

  return {
    total,
    requested,
    underReview,
    approved,
    released,
    inProduction,
    completed,
    cancelled,
    delayed,
    avgHours: Number(avgHours.toFixed(1)),
    byCell,
    byReason
  };
}

/**
 * RPC: Solicita reposição para uma peça original.
 */
export async function requestReplacement({ originalPieceId, reason, priority = 'high', notes = '' }) {
  if (!originalPieceId) throw new Error('ID da peça original é obrigatório.');

  const { data, error } = await supabase.rpc('request_piece_replacement', {
    p_payload: {
      original_piece_id: originalPieceId,
      reason,
      priority,
      notes
    }
  });

  if (error) throw error;

  await auditLog(
    AUDIT_ACTIONS.STEP_SCRAP || 'replacement_requested',
    'production_piece',
    originalPieceId,
    { action: 'replacement_requested', reason, priority, notes }
  );

  return data;
}

/**
 * RPC: Aprova uma ordem de reposição (cria peça substituta).
 */
export async function approveReplacement(orderId, { priority, notes } = {}) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const { data, error } = await supabase.rpc('approve_piece_replacement', {
    p_order_id: orderId,
    p_payload: { priority, notes }
  });

  if (error) throw error;

  await auditLog(
    'replacement_approved',
    'replacement_orders',
    orderId,
    { action: 'replacement_approved', priority, notes }
  );

  return data;
}

/**
 * RPC: Libera a ordem de reposição para fabricação no chão de fábrica.
 */
export async function releaseReplacement(orderId, { notes } = {}) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const { data, error } = await supabase.rpc('release_piece_replacement', {
    p_order_id: orderId,
    p_payload: { notes }
  });

  if (error) throw error;

  await auditLog(
    'replacement_released',
    'replacement_orders',
    orderId,
    { action: 'replacement_released', notes }
  );

  return data;
}

/**
 * RPC: Conclui a reposição e marca a peça original como 'replaced'.
 */
export async function completeReplacement(orderId, { notes } = {}) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const { data, error } = await supabase.rpc('complete_piece_replacement', {
    p_order_id: orderId,
    p_payload: { notes }
  });

  if (error) throw error;

  await auditLog(
    'replacement_completed',
    'replacement_orders',
    orderId,
    { action: 'replacement_completed', notes }
  );

  return data;
}

/**
 * RPC: Cancela a ordem de reposição.
 */
export async function cancelReplacement(orderId, { reason = '' } = {}) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const { data, error } = await supabase.rpc('cancel_piece_replacement', {
    p_order_id: orderId,
    p_payload: { reason }
  });

  if (error) throw error;

  await auditLog(
    'replacement_cancelled',
    'replacement_orders',
    orderId,
    { action: 'replacement_cancelled', reason }
  );

  return data;
}

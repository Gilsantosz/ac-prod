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
  concluída: 'Concluída'
};

export function formatStageName(stage) {
  if (!stage) return 'Corte';
  const str = String(stage).trim();
  const lower = str.toLowerCase();
  if (STAGE_NAME_MAP[lower]) return STAGE_NAME_MAP[lower];

  for (const [key, label] of Object.entries(STAGE_NAME_MAP)) {
    if (key.length >= 3 && (lower === key || lower.startsWith(key + ' ') || lower.startsWith(key + '('))) {
      return str.replace(new RegExp(`^${key}`, 'i'), label);
    }
  }
  return str;
}

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
        id, piece_name, piece_code, piece_uid, traceability_code, description, current_stage, status, material, thickness, color, length, width, height, lot_code, general_lot_code, order_number, customer_name, environment_name, route_steps, completed_steps, lot_id, production_order_id,
        lot:lot_id (
          id, lot_code, general_lot_code
        )
      ),
      replacement_piece:replacement_piece_id (
        id, piece_name, piece_code, piece_uid, traceability_code, description, current_stage, status, is_replacement, route_steps, completed_steps, lot_code, general_lot_code, order_number, customer_name, environment_name, production_order_id
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
  let rawOrders = data || [];
  let totalCount = count || 0;

  if (error) {
    console.error('Erro ao buscar ordens de reposição via JOIN:', error);
    // Fallback: Tentar select simples sem relações se a junção falhar por problema de schema cache
    let fallbackQuery = supabase
      .from('replacement_orders')
      .select('*', { count: 'exact' });

    if (status && status !== 'all') fallbackQuery = fallbackQuery.eq('status', status);
    if (priority && priority !== 'all') fallbackQuery = fallbackQuery.eq('priority', priority);
    if (cellId) fallbackQuery = fallbackQuery.eq('origin_cell_id', cellId);
    if (search && search.trim()) {
      const term = search.trim();
      fallbackQuery = fallbackQuery.or(`replacement_code.ilike.%${term}%,reason.ilike.%${term}%,lot_code.ilike.%${term}%,order_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
    }
    fallbackQuery = fallbackQuery.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: fbData, error: fbError, count: fbCount } = await fallbackQuery;
    if (fbError) throw fbError;

    rawOrders = fbData || [];
    totalCount = fbCount || 0;

    // População manual de peças se houver resultados
    const pieceIds = [...new Set(rawOrders.flatMap(o => [o.original_piece_id, o.replacement_piece_id].filter(Boolean)))];
    let piecesMap = {};
    if (pieceIds.length > 0) {
      const { data: pieces } = await supabase
        .from('production_pieces')
        .select('id, piece_name, piece_code, piece_uid, traceability_code, current_stage, status, material, thickness, color, length, width, is_replacement, lot_code, general_lot_code, order_number, customer_name, environment_name, route_steps, completed_steps, lot_id, production_order_id')
        .in('id', pieceIds);

      const lotIds = [...new Set((pieces || []).map(p => p.lot_id).filter(Boolean))];
      let lotsMap = {};
      if (lotIds.length > 0) {
        const { data: lots } = await supabase
          .from('production_lots')
          .select('id, lot_code, general_lot_code, production_order_id, order_id')
          .in('id', lotIds);
        (lots || []).forEach(l => { lotsMap[l.id] = l; });
      }

      (pieces || []).forEach(p => {
        const lotObj = lotsMap[p.lot_id] || null;
        piecesMap[p.id] = {
          ...p,
          lot: lotObj,
          lot_code: p.lot_code || lotObj?.lot_code || null,
          general_lot_code: p.general_lot_code || lotObj?.general_lot_code || null,
        };
      });
    }

    rawOrders = rawOrders.map(o => ({
      ...o,
      original_piece: piecesMap[o.original_piece_id] || null,
      replacement_piece: piecesMap[o.replacement_piece_id] || null
    }));
  }

  // Se alguma peça tiver lot_id e não tiver trazido a relação lot, buscar os lotes em lote
  const missingLotIds = rawOrders
    .filter(o => o.original_piece?.lot_id && !o.original_piece?.lot)
    .map(o => o.original_piece.lot_id);

  if (missingLotIds.length > 0) {
    const uniqueLotIds = [...new Set(missingLotIds)];
    const { data: lots } = await supabase
      .from('production_lots')
      .select('id, lot_code, general_lot_code, production_order_id, order_id')
      .in('id', uniqueLotIds);

    if (lots && lots.length > 0) {
      const lotsMap = {};
      lots.forEach(l => { lotsMap[l.id] = l; });
      rawOrders = rawOrders.map(o => {
        if (o.original_piece?.lot_id && lotsMap[o.original_piece.lot_id]) {
          return {
            ...o,
            original_piece: {
              ...o.original_piece,
              lot: lotsMap[o.original_piece.lot_id]
            }
          };
        }
        return o;
      });
    }
  }

  // Hidratar pedido e cliente pelo vínculo canônico peça → lote → ordem.
  const contextLotIds = [...new Set(rawOrders.map((order) => order.original_piece?.lot_id || order.lot_id).filter(Boolean))];
  const lotsById = {};
  if (contextLotIds.length > 0) {
    const { data: contextLots } = await supabase
      .from('production_lots')
      .select('id,lot_code,general_lot_code,production_order_id,order_id')
      .in('id', contextLotIds);
    (contextLots || []).forEach((lotRow) => { lotsById[lotRow.id] = lotRow; });
  }

  const contextOrderIds = [...new Set(rawOrders.flatMap((order) => {
    const linkedLot = lotsById[order.original_piece?.lot_id || order.lot_id];
    return [order.production_order_id, order.original_piece?.production_order_id, linkedLot?.production_order_id, linkedLot?.order_id].filter(Boolean);
  }))];
  const ordersById = {};
  if (contextOrderIds.length > 0) {
    const { data: contextOrders } = await supabase
      .from('production_orders')
      .select('id,order_code,order_number,customer_name')
      .in('id', contextOrderIds);
    (contextOrders || []).forEach((orderRow) => { ordersById[orderRow.id] = orderRow; });
  }

  rawOrders = rawOrders.map((order) => {
    const piece = order.original_piece || {};
    const linkedLot = piece.lot || lotsById[piece.lot_id || order.lot_id] || null;
    const linkedOrder = ordersById[order.production_order_id]
      || ordersById[piece.production_order_id]
      || ordersById[linkedLot?.production_order_id]
      || ordersById[linkedLot?.order_id]
      || null;
    return {
      ...order,
      lot_id: order.lot_id || piece.lot_id || linkedLot?.id || null,
      lot_code: order.lot_code || piece.lot_code || linkedLot?.lot_code || null,
      general_lot_code: order.general_lot_code || piece.general_lot_code || linkedLot?.general_lot_code || null,
      production_order_id: order.production_order_id || piece.production_order_id || linkedOrder?.id || null,
      order_number: order.order_number || piece.order_number || linkedOrder?.order_number || linkedOrder?.order_code || null,
      customer_name: order.customer_name || piece.customer_name || linkedOrder?.customer_name || null,
      original_piece: {
        ...piece,
        lot: linkedLot,
        lot_code: piece.lot_code || linkedLot?.lot_code || null,
        general_lot_code: piece.general_lot_code || linkedLot?.general_lot_code || null,
        order_number: piece.order_number || linkedOrder?.order_number || linkedOrder?.order_code || null,
        customer_name: piece.customer_name || linkedOrder?.customer_name || null,
      },
    };
  });

  // Buscar snapshots de qualidade correspondentes em quality_nonconformities se houver campos faltantes
  const orderIds = rawOrders.map(o => o.id).filter(Boolean);
  let ncMap = {};
  if (orderIds.length > 0) {
    try {
      const { data: ncs } = await supabase
        .from('quality_nonconformities')
        .select(`
          related_replacement_id, piece_id, lot_code, order_number, customer_name, environment_name, cell_name, stage_name, operator_name, notes,
          piece:piece_id (
            id, piece_name, piece_code, piece_uid, traceability_code, description, current_stage, status, material, thickness, color, length, width, height, lot_code, general_lot_code, order_number, customer_name, environment_name, route_steps, completed_steps, lot_id
          )
        `)
        .in('related_replacement_id', orderIds);

      if (ncs && ncs.length > 0) {
        ncs.forEach(nc => {
          if (nc.related_replacement_id) ncMap[nc.related_replacement_id] = nc;
        });
      }
    } catch (e) {
      console.warn('Aviso ao relacionar quality_nonconformities:', e);
    }
  }

  rawOrders = rawOrders.map(o => {
    const nc = ncMap[o.id];
    if (!nc) return o;
    return {
      ...o,
      lot_code: o.lot_code || nc.lot_code,
      order_number: o.order_number || nc.order_number,
      customer_name: o.customer_name || nc.customer_name,
      environment_name: o.environment_name || nc.environment_name,
      origin_cell_name: o.origin_cell_name || nc.cell_name,
      rejection_stage: (!o.rejection_stage || ['concluída', 'concluida', 'completed', 'created'].includes(String(o.rejection_stage).toLowerCase()))
        ? nc.stage_name
        : o.rejection_stage,
      operator_name: o.operator_name || nc.operator_name,
      original_piece: o.original_piece || nc.piece
    };
  });

  // Consolidar e enriquecer todas as informações da ordem para impedir que qualquer campo exiba 'N/A'
  const processedOrders = rawOrders.map(o => enrichReplacementOrderData(o));

  return {
    orders: processedOrders,
    count: totalCount
  };
}



/**
 * Enriquece uma ordem de reposição com tratativas resilientes de campos ausentes.
 */
export function enrichReplacementOrderData(order) {
  if (!order) return order;
  const orig = order.original_piece || {};
  const repl = order.replacement_piece || {};
  const lot = orig.lot || {};

  // 1. Extrair operador e célula a partir de notes se necessário
  let parsedOperator = null;
  let parsedCell = null;
  if (order.notes) {
    const match = order.notes.match(/operador\s+([^/\,\n\.\s]+)(?:\/([^/\,\n\.\s]+))?/i);
    if (match) {
      if (match[1]) parsedOperator = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      if (match[2]) parsedCell = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
    }
  }

  // 2. Operador Solicitante
  const operatorName = (order.operator_name && order.operator_name !== 'N/A')
    ? order.operator_name
    : (parsedOperator || orig.operator_name || 'Operador da Coleta');

  // 3. Etapa e Célula de Reprovação
  const storedStage = String(order.rejection_stage || '').trim();
  const storedStageIsValid = storedStage && !['n/a', 'concluída', 'concluida', 'completed', 'created'].includes(storedStage.toLowerCase());
  const rawRejectionStage = storedStageIsValid
    ? storedStage
    : (orig.current_stage && !['created', 'completed', 'concluída', 'concluida'].includes(String(orig.current_stage).toLowerCase()) ? orig.current_stage : (parsedCell || 'Corte'));
  const rejectionStage = formatStageName(rawRejectionStage);

  const originCell = (order.origin_cell_name && order.origin_cell_name !== 'Célula de Origem')
    ? order.origin_cell_name
    : (parsedCell ? `Célula de ${formatStageName(parsedCell)}` : `Célula de ${rejectionStage}`);

  // 4. Lotes (Geral e Cliente)
  const clientLot = order.resolved_client_lot
    || order.lot_code 
    || orig.lot_code 
    || lot.lot_code 
    || null;

  const generalLot = order.resolved_general_lot
    || order.general_lot_code 
    || null;

  // 5. Ambiente
  const environmentName = (order.environment_name && order.environment_name !== 'N/A')
    ? order.environment_name
    : (orig.environment || orig.environment_name || orig.module_name || 'Geral / Produção');

  // 6. Peça Original (Código da Peça, Barcode Tag, UID e Nome)
  const originalPieceCode = orig.piece_code 
    || orig.piece_uid 
    || orig.traceability_code 
    || order.original_piece_id
    || 'Rastreio não localizado';

  const originalPieceUid = orig.piece_uid || orig.traceability_code || originalPieceCode;
  const traceabilityCode = orig.traceability_code || orig.piece_code || orig.piece_uid;

  const originalPieceName = orig.piece_name 
    || orig.description 
    || orig.module_name 
    || 'Peça de Produção';

  // 7. Rota e Sequenciamento Produtivo
  let rawRoute = orig.route_steps;
  let formattedRoute = [];
  if (Array.isArray(rawRoute) && rawRoute.length > 0) {
    formattedRoute = rawRoute.map(s => formatStageName(s));
  } else {
    formattedRoute = ['Corte', 'Borda', 'Separação', 'Embalagem'];
  }

  const originalPiece = {
    ...orig,
    piece_code: originalPieceCode,
    piece_uid: originalPieceUid,
    traceability_code: traceabilityCode,
    piece_name: originalPieceName,
    environment: environmentName,
    current_stage: rejectionStage,
    lot_code: clientLot,
    general_lot_code: generalLot,
    route_steps: formattedRoute
  };

  return {
    ...order,
    operator_name: operatorName,
    origin_cell_name: originCell,
    rejection_stage: rejectionStage,
    environment_name: environmentName,
    resolved_client_lot: clientLot,
    resolved_general_lot: generalLot,
    original_piece: originalPiece,
    replacement_piece: repl,
    route_steps: formattedRoute
  };
}

/**
 * Retorna o dataset canônico usado por CSV, Excel, PDF e relatórios agendados.
 * A view é criada pela migration de reconciliação do fluxo de reposição.
 */
export async function getReplacementExportRows({
  status = null,
  priority = null,
  search = null,
  dateFrom = null,
  dateTo = null,
  limit = 5000
} = {}) {
  let query = supabase
    .from('replacement_flow_export')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') query = query.eq('status', status);
  if (priority && priority !== 'all') query = query.eq('priority', priority);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);
  if (search?.trim()) {
    const term = search.trim();
    query = query.or([
      `replacement_code.ilike.%${term}%`,
      `original_piece_uid.ilike.%${term}%`,
      `replacement_piece_uid.ilike.%${term}%`,
      `lot_code.ilike.%${term}%`,
      `general_lot_code.ilike.%${term}%`,
      `order_number.ilike.%${term}%`,
      `customer_name.ilike.%${term}%`,
      `defect_name.ilike.%${term}%`
    ].join(','));
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao carregar dados para exportação: ${error.message}`);
  return data || [];
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
 * Hidrata a ordem com a linha do tempo física das peças original e substituta.
 * O relatório usa os apontamentos reais; não cria eventos sintéticos.
 */
export async function getReplacementReportOrder(order) {
  if (!order?.id) throw new Error('Ordem de reposição inválida para o relatório.');

  const pieceIds = [
    order.original_piece?.id || order.original_piece_id,
    order.replacement_piece?.id || order.replacement_piece_id,
  ].filter(Boolean);

  if (pieceIds.length === 0) {
    throw new Error('A ordem não possui peça rastreável vinculada.');
  }

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

  if (error) {
    throw new Error(`Não foi possível carregar a rastreabilidade do relatório: ${error.message}`);
  }

  return {
    ...order,
    traceability_readings: data || [],
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

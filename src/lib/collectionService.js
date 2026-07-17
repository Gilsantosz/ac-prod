import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { createReworkOrder } from '@/lib/reworkService';
import { registerTraceabilityRejection } from '@/lib/traceabilityService';

async function resolveCellId(cellId, cellName) {
  const trimmedName = cellName?.trim();
  if (cellId || !trimmedName) return cellId || null;
  const { data: cells, error } = await supabase
    .from('cells')
    .select('id')
    .ilike('name', trimmedName)
    .limit(1);
  if (error) {
    console.error('resolveCellId error:', error);
    throw error;
  }
  const result = cells?.[0]?.id || null;
  console.log('resolveCellId:', { cellName: trimmedName, result });
  return result;
}

/**
 * Busca o histórico de coletas usando a RPC otimizada do Supabase.
 */
export async function getCollectionHistory({
  cellId = null,
  cellName = null,
  workstationId = null,
  operatorId = null,
  shift = null,
  status = null,
  lotId = null,
  limit = 50,
  offset = 0,
  dateFrom = null,
  dateTo = null
}) {
  const trimmedName = cellName?.trim();
  const resolvedCellId = await resolveCellId(cellId, trimmedName);

  console.log('rpc get_collection_history call:', {
    p_cell_id: resolvedCellId,
    p_workstation_id: workstationId,
    p_operator_id: operatorId,
    p_shift: shift,
    p_status: status,
    p_lot_id: lotId,
    p_limit: limit,
    p_offset: offset,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_cell_name: trimmedName
  });

  const { data, error } = await supabase.rpc('get_collection_history', {
    p_cell_id: resolvedCellId,
    p_workstation_id: workstationId,
    p_operator_id: operatorId,
    p_shift: shift,
    p_status: status,
    p_lot_id: lotId,
    p_limit: limit,
    p_offset: offset,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_cell_name: trimmedName
  });

  if (error) {
    console.error('rpc get_collection_history error:', error);
    throw error;
  }
  console.log('rpc get_collection_history response length:', data?.length);
  return data || [];
}

/**
 * Retorna a contagem total de coletas filtradas.
 */
export async function getCollectionHistoryCount({
  cellId = null,
  cellName = null,
  workstationId = null,
  operatorId = null,
  shift = null,
  status = null,
  lotId = null,
  dateFrom = null,
  dateTo = null
}) {
  const trimmedName = cellName?.trim();
  const resolvedCellId = await resolveCellId(cellId, trimmedName);

  const { data, error } = await supabase.rpc('get_collection_history_count', {
    p_cell_id: resolvedCellId,
    p_workstation_id: workstationId,
    p_operator_id: operatorId,
    p_shift: shift,
    p_status: status,
    p_lot_id: lotId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_cell_name: trimmedName
  });

  if (error) throw error;
  return Number(data || 0);
}

/**
 * Inscreve no Supabase Realtime para escutar alterações de coletas na célula/posto
 */
export function subscribeToCollectionHistory({ cellName, cellId, callback, onStatus, channelSuffix = '' }) {
  const trimmedName = cellName?.trim();
  const suffix = channelSuffix ? `-${channelSuffix}` : '';
  const channelName = `collection-history-${trimmedName || cellId || 'all'}${suffix}`;
  const changeConfig = {
    event: '*',
    schema: 'public',
    table: 'production_collection_events',
  };
  if (trimmedName) changeConfig.filter = `cell_name=eq.${trimmedName}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      changeConfig,
      (payload) => {
        callback(payload);
      }
    )
    .subscribe((status) => onStatus?.(status));

  return channel;
}

export function unsubscribeFromCollectionHistory(channel) {
  if (!channel) return Promise.resolve();
  return supabase.removeChannel(channel);
}

/**
 * Retorna os KPIs calculados de acordo com os filtros aplicados
 */
export async function getCollectionKpis({
  cellId = null,
  cellName = null,
  workstationId = null,
  operatorId = null,
  shift = null,
  dateFrom = null,
  dateTo = null
}) {
  // Resolve nome da célula a partir do ID se necessário
  let resolvedCellName = cellName;
  if (cellId && !resolvedCellName) {
    const { data: cell } = await supabase.from('cells').select('name').eq('id', cellId).maybeSingle();
    resolvedCellName = cell?.name;
  }
  if (!resolvedCellName) {
    return { total: 0, approved: 0, rejected: 0, blocked: 0, expected: 0, pending: 0, rework: 0, replacement: 0 };
  }

  const { data: snapshot, error: snapshotError } = await supabase.rpc('get_collection_cell_snapshot', {
    p_cell_name: resolvedCellName,
    p_workstation_id: workstationId,
    p_shift: shift,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!snapshotError) return snapshot || {};

  const snapshotUnavailable = snapshotError.code === 'PGRST202'
    || /get_collection_cell_snapshot|schema cache/i.test(snapshotError.message || '');
  if (!snapshotUnavailable) throw snapshotError;

  // Compatibilidade durante a aplicação da migration 032.
  let query = supabase
    .from('production_stage_readings')
    .select('status, quantity');

  if (resolvedCellName) query = query.eq('cell_name', resolvedCellName);

  if (workstationId) query = query.eq('machine_id', workstationId);
  
  if (operatorId) {
    query = query.eq('operator_id', operatorId);
  }

  if (shift) query = query.eq('shift', shift);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const quantityOf = (row) => Math.max(Number(row.quantity) || 1, 1);
  const approved = rows.filter(r => r.status === 'approved').reduce((sum, r) => sum + quantityOf(r), 0);
  const rejected = rows.filter(r => r.status === 'rejected').reduce((sum, r) => sum + quantityOf(r), 0);
  const blocked = rows.filter(r => ['blocked', 'duplicated'].includes(r.status)).reduce((sum, r) => sum + quantityOf(r), 0);

  return {
    total: approved + rejected + blocked,
    approved,
    rejected,
    blocked,
    expected: approved,
    pending: 0,
    rework: 0,
    replacement: 0,
    active_lots: 0,
    active_pcp_batches: 0,
  };
}

/**
 * Busca as últimas leituras de uma célula/posto (Retrocompatibilidade).
 */
export async function getRecentReadsByCell({ cellName, workstationId, limit = 10 }) {
  if (!cellName) return [];
  return getCollectionHistory({ cellName, workstationId, limit });
}

/**
 * Busca a rastreabilidade completa de uma peça a partir do seu ID ou código.
 */
export async function getPieceTraceability(pieceIdOrCode) {
  if (!pieceIdOrCode) throw new Error('Código ou ID da peça inválido.');

  let query = supabase
    .from('production_pieces')
    .select(`
      *,
      production_lots (
        id,
        lot_code,
        production_orders:production_orders!production_order_id (
          id,
          order_code,
          customer_name
        )
      )
    `);

  if (pieceIdOrCode.length === 36) {
    query = query.eq('id', pieceIdOrCode);
  } else {
    query = query.eq('piece_uid', pieceIdOrCode);
  }

  const { data: piece, error: pieceError } = await query.maybeSingle();
  if (pieceError) throw pieceError;

  const resolvedPiece = piece || { piece_uid: pieceIdOrCode, piece_name: 'Peça Avulsa' };

  const { data: readings, error: readingsError } = await supabase
    .from('production_stage_readings')
    .select('*')
    .eq('tag_value', resolvedPiece.piece_uid)
    .order('created_at', { ascending: true });

  if (readingsError) throw readingsError;

  let route = [];
  if (resolvedPiece.lot_id) {
    const { data: routeData } = await supabase
      .from('production_routes')
      .select('*')
      .eq('lot_id', resolvedPiece.lot_id)
      .order('step_order', { ascending: true });
    route = routeData || [];
  }

  return {
    piece: resolvedPiece,
    readings: readings || [],
    route
  };
}

/**
 * Reprova uma peça de produção e registra a ação de auditoria.
 */
export async function rejectPieceFromCollection({
  pieceId,
  traceabilityCode,
  reason,
  notes,
  action,
  operatorId,
  operatorName,
  cellName,
  workstationId
}) {
  if (!pieceId && !traceabilityCode) throw new Error('ID ou código da peça é obrigatório.');

  const payload = {
    rawValue: traceabilityCode,
    status: 'rejected',
    operator: operatorName,
    operatorId,
    cellName,
    machineId: workstationId,
    notes: `${reason} - ${notes || ''}`
  };

  await registerTraceabilityRejection(payload);

  if (action === 'block') {
    const { data: piece } = await supabase
      .from('production_pieces')
      .select('lot_id')
      .eq('piece_uid', traceabilityCode)
      .maybeSingle();

    if (piece?.lot_id) {
      await supabase
        .from('production_lots')
        .update({ status: 'blocked' })
        .eq('id', piece.lot_id);

      await auditLog(
        AUDIT_ACTIONS.LOT_BLOCK,
        'production_lot',
        piece.lot_id,
        { reason: `Bloqueado por reprovação de peça: ${reason}`, piece_code: traceabilityCode }
      );
    }
  }

  if (action === 'rework' && pieceId) {
    await createReworkOrder({
      piece_id: pieceId,
      rework_reason_code: reason.toLowerCase().replace(/\s+/g, '_'),
      operator_id: operatorId,
      notes: notes || 'Gerado via painel de Coleta MES'
    });

    await auditLog(
      AUDIT_ACTIONS.STEP_REWORK,
      'production_piece',
      pieceId,
      { reason, notes }
    );
  } else {
    await auditLog(
      AUDIT_ACTIONS.STEP_SCRAP,
      'production_piece',
      pieceId,
      { reason, notes, action }
    );
  }

  return { success: true };
}

/**
 * Retorna o fluxo produtivo da peça
 */
export async function getPieceFlow(pieceId) {
  const { data: piece, error: pieceError } = await supabase
    .from('production_pieces')
    .select('id, piece_name, piece_uid, current_stage, status, lot_id')
    .eq('id', pieceId)
    .single();

  if (pieceError) throw pieceError;

  const { data: route, error: routeError } = await supabase
    .from('production_routes')
    .select('*')
    .eq('lot_id', piece.lot_id)
    .order('step_order', { ascending: true });

  if (routeError) throw routeError;

  const { data: readings } = await supabase
    .from('production_stage_readings')
    .select('step_name, status')
    .eq('tag_value', piece.piece_uid);

  const completedSteps = (readings || [])
    .filter(r => r.status === 'approved')
    .map(r => r.step_name);

  return {
    piece,
    route: route || [],
    completedSteps: completedSteps || [],
    currentStage: piece.current_stage,
    status: piece.status
  };
}

/**
 * Solicita reposição automática de peça de produção (cria peça substituta).
 */
export async function requestPieceReplacement({ pieceId, reason, notes }) {
  if (!pieceId) throw new Error('ID da peça original é obrigatório.');

  const { data, error } = await supabase.rpc('create_piece_replacement', {
    p_original_piece_id: pieceId,
    p_reason: reason,
    p_notes: notes || ''
  });

  if (error) throw error;
  
  await auditLog(
    'piece_replacement_created',
    'production_piece',
    pieceId,
    { action: 'replacement_created', reason, notes }
  );

  return data;
}

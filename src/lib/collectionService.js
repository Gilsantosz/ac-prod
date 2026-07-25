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
  dateTo = null,
  pcpImportBatchId = null,
  lotId = null,
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
    // Informar os sete argumentos seleciona de forma inequívoca a versão
    // acumulativa do RPC (lote ativo + atividade do turno).
    p_pcp_import_batch_id: pcpImportBatchId,
    p_lot_id: lotId,
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

  const target = typeof pieceIdOrCode === 'object'
    ? (pieceIdOrCode.piece_uid || pieceIdOrCode.traceability_code || pieceIdOrCode.piece_code || pieceIdOrCode.tag_value || pieceIdOrCode.raw_value || pieceIdOrCode.id || pieceIdOrCode.piece_id)
    : String(pieceIdOrCode);

  if (!target) throw new Error('Código ou ID da peça é obrigatório.');

  const isUuid = target.length === 36 && target.includes('-');
  let piece = null;
  let pcpRowData = null;

  try {
    // 1. Busca canônica em production_pieces por ID, piece_uid ou traceability_code
    if (isUuid) {
      const { data, error } = await supabase
        .from('production_pieces')
        .select(`
          *,
          production_lots (
            id,
            lot_code,
            customer_name,
            production_orders:production_orders!production_order_id (
              id,
              order_code,
              customer_name
            )
          )
        `)
        .eq('id', target)
        .maybeSingle();
      if (!error && data) piece = data;
    }

    if (!piece) {
      const { data, error } = await supabase
        .from('production_pieces')
        .select(`
          *,
          production_lots (
            id,
            lot_code,
            customer_name,
            production_orders:production_orders!production_order_id (
              id,
              order_code,
              customer_name
            )
          )
        `)
        .or(`piece_uid.eq.${target},traceability_code.eq.${target},id.eq.${target}`)
        .maybeSingle();
      if (!error && data) piece = data;
    }

    // 2. Busca fallback em pcp_import_rows (ledger do PCP retaguarda)
    try {
      const { data: pcpRow } = await supabase
        .from('pcp_import_rows')
        .select('normalized_payload, barcode_raw')
        .or(`barcode_raw.eq.${target},barcode_normalized.eq.${target}`)
        .limit(1)
        .maybeSingle();

      if (pcpRow?.normalized_payload) {
        pcpRowData = pcpRow.normalized_payload;
      }
    } catch (pcpErr) {
      console.warn('Erro ao consultar retaguarda pcp_import_rows:', pcpErr);
    }
  } catch (err) {
    console.warn('Erro ao buscar peça em production_pieces:', err);
  }

  // 3. Montar objeto consolidado da peça garantindo que nenhum campo físico fique vazio
  const resolvedPiece = {
    id: piece?.id || (isUuid ? target : null),
    piece_uid: piece?.piece_uid || target,
    traceability_code: piece?.traceability_code || target,
    piece_name: piece?.piece_name || pcpRowData?.pieceName || 'Peça de Produção MES',
    material: piece?.material || pcpRowData?.material || 'MDF',
    color: piece?.color || pcpRowData?.color || 'Padrão',
    thickness: Number(piece?.thickness || pcpRowData?.thickness || 15),
    width: Number(piece?.width || pcpRowData?.width || 0),
    height: Number(piece?.height || pcpRowData?.height || 0),
    length: Number(piece?.length || piece?.height || pcpRowData?.height || 0),
    environment: piece?.environment || pcpRowData?.environmentName || 'Geral',
    module_name: piece?.module_name || pcpRowData?.moduleName || 'Móvel',
    status: piece?.status || 'approved',
    current_stage: piece?.current_stage || 'Corte',
    lot_id: piece?.lot_id || null,
    production_lots: piece?.production_lots || {
      id: null,
      lot_code: pcpRowData?.lotCode || 'LOTE-PCP',
      production_orders: {
        id: null,
        order_code: pcpRowData?.orderCode || 'PED-PCP',
        customer_name: pcpRowData?.customer || 'Cliente Retaguarda'
      }
    }
  };

  const uidToSearch = resolvedPiece.piece_uid || target;
  const tcodeToSearch = resolvedPiece.traceability_code || target;
  const idToSearch = resolvedPiece.id || (isUuid ? target : null);

  let filterConditions = [
    `tag_value.eq.${uidToSearch}`,
    `tag_value.eq.${tcodeToSearch}`,
    `piece_code.eq.${uidToSearch}`,
    `piece_code.eq.${tcodeToSearch}`,
    `raw_value.eq.${uidToSearch}`,
    `raw_value.eq.${tcodeToSearch}`,
    `traceability_code.eq.${tcodeToSearch}`
  ];
  if (idToSearch) {
    filterConditions.push(`piece_id.eq.${idToSearch}`);
  }

  let readings = [];
  try {
    const { data: readingsData, error: readingsError } = await supabase
      .from('production_stage_readings')
      .select('*')
      .or(filterConditions.join(','))
      .order('created_at', { ascending: true });

    if (!readingsError && readingsData) {
      readings = readingsData;
    }
  } catch (e) {
    console.warn('Erro ao buscar leituras de rastreabilidade:', e);
  }

  // 4. Resolução de Rota Produtiva com fallback automático do PCP
  let route = [];
  if (resolvedPiece.lot_id) {
    try {
      const { data: routeData } = await supabase
        .from('production_routes')
        .select('*')
        .eq('lot_id', resolvedPiece.lot_id)
        .order('step_order', { ascending: true });
      route = routeData || [];
    } catch (e) {
      console.warn('Erro ao buscar rota produtiva do lote:', e);
    }
  }

  // Se a tabela de rotas do lote estiver vazia, montar a rota a partir do roteiro PCP da peça
  if (!route || route.length === 0) {
    const STEP_NAMES = {
      cut: 'Corte',
      edge: 'Borda',
      drill: 'Furação',
      cnc: 'Usinagem CNC',
      canal: 'Canal',
      maranello: 'Maranello',
      portajoias: 'Porta Joias',
      sorrento: 'Sorrento',
      usi_especial: 'Usi Especial',
      rasgo_freggio: 'Rasgo Freggio',
      joinery: 'Marcenaria',
      separation: 'Separação',
      packaging: 'Embalagem'
    };

    let rawSteps = piece?.route_steps;
    if (!rawSteps && pcpRowData?.route) {
      const text = String(pcpRowData.route).toUpperCase();
      rawSteps = [];
      if (text.includes('CORT')) rawSteps.push('cut');
      if (text.includes('BORD')) rawSteps.push('edge');
      if (text.includes('FUR')) rawSteps.push('drill');
      if (text.includes('CNC') || text.includes('USIN')) rawSteps.push('cnc');
      if (text.includes('MARC')) rawSteps.push('joinery');
      rawSteps.push('separation', 'packaging');
    }

    if (!rawSteps || rawSteps.length === 0) {
      rawSteps = ['cut', 'edge', 'cnc', 'separation', 'packaging'];
    }

    route = rawSteps.map((stepCode, idx) => ({
      id: `step-${idx}`,
      step_order: idx + 1,
      step_name: STEP_NAMES[stepCode] || stepCode,
      code: stepCode
    }));
  }

  return {
    piece: resolvedPiece,
    readings,
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
  defectId = null,
  disposition = 'scrap',
  operatorId,
  operatorName,
  cellName,
  workstationId
}) {
  if (!pieceId && !traceabilityCode) throw new Error('ID ou código da peça é obrigatório.');

  const rpcPayload = {
    piece_id: pieceId || null,
    traceability_code: traceabilityCode,
    reason,
    notes,
    disposition: disposition || (action === 'block' ? 'hold' : (action === 'rework' ? 'rework' : (action === 'replacement' ? 'replacement' : 'scrap'))),
    defect_id: defectId || null,
    operator_name: operatorName,
    operator_id: operatorId || null,
    cell_name: cellName,
    machine_id: workstationId || null,
    client_event_id: crypto.randomUUID()
  };

  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('register_quality_rejection', {
      p_payload: rpcPayload
    });
    if (!rpcError && rpcResult) {
      await auditLog(
        AUDIT_ACTIONS.STEP_SCRAP,
        'production_piece',
        pieceId || rpcResult.nonconformity_id,
        { reason, notes, action, disposition, rpcResult }
      );
      return { success: true, ...rpcResult };
    }
  } catch (err) {
    console.warn('RPC register_quality_rejection falhou, executando fallback local:', err);
  }

  // Fallback para rastreabilidade legada se RPC falhar
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

  await auditLog(
    AUDIT_ACTIONS.STEP_SCRAP,
    'production_piece',
    pieceId,
    { reason, notes, action }
  );

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
 * Solicita reposição de peça de produção via RPC transacional.
 * Cria entrada em replacement_orders com status 'requested' e retorna o código da ordem.
 */
export async function requestPieceReplacement({ pieceId, reason, notes, priority = 'high' }) {
  if (!pieceId) throw new Error('ID da peça original é obrigatório.');

  const { data, error } = await supabase.rpc('request_piece_replacement', {
    p_payload: {
      original_piece_id: pieceId,
      reason: reason || 'Solicitação de reposição via coleta',
      priority,
      notes: notes || ''
    }
  });

  if (error) throw error;

  await auditLog(
    'piece_replacement_requested',
    'production_piece',
    pieceId,
    { action: 'replacement_requested', reason, notes }
  );

  return data;
}

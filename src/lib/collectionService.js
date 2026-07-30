import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';


function normalizeCurrentPieceStatus(piece) {
  if (!piece) return null;
  const status = String(piece.status || '').trim().toLowerCase();
  const replacementStatus = String(piece.replacement_status || '').trim().toLowerCase();

  if (status === 'blocked') return 'blocked';
  if (['rejected', 'replacement_requested'].includes(status) || replacementStatus === 'requested') return 'rejected';
  if (['rework', 'rework_pending', 'rework_in_progress'].includes(status)) return 'rework';
  if (status === 'replaced' || replacementStatus === 'replaced') return 'replaced';
  if (['completed', 'approved', 'active', 'in_progress'].includes(status)) return 'approved';
  return status || null;
}

async function enrichCollectionRowsWithCurrentPieceStatus(rows, requestedStatus = null) {
  const pieceIds = [...new Set((rows || []).map((row) => row.piece_id).filter(Boolean))];
  if (!pieceIds.length) return rows || [];

  const { data: pieces, error } = await supabase
    .from('production_pieces')
    .select('id,status,replacement_status,lot_id,lot_code,order_number,customer_name,current_stage,piece_uid,traceability_code,piece_name,route_steps,completed_steps')
    .in('id', pieceIds);

  if (error) {
    console.warn('Não foi possível sincronizar o estado atual das peças no histórico:', error);
    return rows || [];
  }

  const pieceMap = new Map((pieces || []).map((piece) => [piece.id, piece]));
  const enriched = (rows || []).map((row) => {
    const piece = pieceMap.get(row.piece_id);
    if (!piece) return row;
    const currentStatus = normalizeCurrentPieceStatus(piece) || row.event_status;
    return {
      ...row,
      reading_status: row.event_status,
      event_status: currentStatus,
      piece_status: piece.status,
      replacement_status: piece.replacement_status,
      traceability_code: piece.traceability_code || piece.piece_uid || row.traceability_code,
      piece_name: piece.piece_name || row.piece_name,
      current_stage_name: piece.current_stage || row.current_stage_name,
      route_steps: piece.route_steps || row.route_steps || [],
      completed_steps: piece.completed_steps || row.completed_steps || [],
      lot_id: piece.lot_id || row.lot_id,
      lot_code: piece.lot_code || row.lot_code,
      order_number: piece.order_number || row.order_number,
      client_name: piece.customer_name || row.client_name,
    };
  });

  return requestedStatus ? enriched.filter((row) => row.event_status === requestedStatus) : enriched;
}

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
  return enrichCollectionRowsWithCurrentPieceStatus(data || [], status);
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
  const uniqueId = Math.random().toString(36).substring(2, 7);
  const suffix = channelSuffix ? `-${channelSuffix}-${uniqueId}` : `-${uniqueId}`;
  const channelName = `collection-history-${trimmedName || cellId || 'all'}${suffix}`;

  const changeConfig = {
    event: '*',
    schema: 'public',
    table: 'production_collection_events',
  };
  if (trimmedName) changeConfig.filter = `cell_name=eq.${trimmedName}`;

  const readingsConfig = {
    event: '*',
    schema: 'public',
    table: 'production_stage_readings',
  };
  if (trimmedName) readingsConfig.filter = `cell_name=eq.${trimmedName}`;

  try {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', changeConfig, callback)
      .on('postgres_changes', readingsConfig, callback)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'production_pieces' },
        callback,
      )
      .subscribe((status) => onStatus?.(status));

    return channel;
  } catch (err) {
    console.error('Erro ao subscrever ao canal realtime:', err);
    onStatus?.('CHANNEL_ERROR');
    return null;
  }
}

export function unsubscribeFromCollectionHistory(channel) {
  if (!channel) return Promise.resolve();
  try {
    return supabase.removeChannel(channel);
  } catch (err) {
    console.warn('Erro ao remover canal de realtime:', err);
    return Promise.resolve();
  }
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
    p_pcp_import_batch_id: pcpImportBatchId,
    p_lot_id: lotId,
  });
  if (!snapshotError && snapshot && typeof snapshot === 'object' && ('expected' in snapshot || 'approved' in snapshot)) {
    return snapshot;
  }

  // Mapeamento canônico do código da célula
  const cellCodeMap = {
    'corte': 'cut', 'cut': 'cut',
    'borda': 'edge', 'bordo': 'edge', 'edge': 'edge',
    'furação': 'drill', 'furacao': 'drill', 'drill': 'drill',
    'usinagem': 'cnc', 'cnc': 'cnc',
    'marcenaria': 'joinery', 'joinery': 'joinery',
    'separaçao': 'separation', 'separacao': 'separation', 'separation': 'separation',
    'embalagem': 'packaging', 'packaging': 'packaging'
  };
  const stepCode = cellCodeMap[resolvedCellName.toLowerCase()] || resolvedCellName.toLowerCase();

  // 1. Buscar peças ativas atreladas a lotes não encerrados/cancelados
  const { data: pieces } = await supabase
    .from('production_pieces')
    .select('id, status, rework_status, replacement_status, route_steps, requires_cut, requires_edge, requires_cnc, requires_joinery, pcp_import_batch_id, lot_id, production_lots!inner(status, pcp_import_batch_id)')
    .not('status', 'in', '("cancelled","replaced","shipped")')
    .not('production_lots.status', 'in', '("closed","shipped","cancelled")');

  let activePieces = pieces || [];
  if (pcpImportBatchId) {
    activePieces = activePieces.filter(p => (p.pcp_import_batch_id || p.production_lots?.pcp_import_batch_id) === pcpImportBatchId);
  }
  if (lotId) {
    activePieces = activePieces.filter(p => p.lot_id === lotId);
  }

  // Filtrar peças que passam por esta etapa
  const cellPieces = activePieces.filter(p => {
    const route = Array.isArray(p.route_steps) ? p.route_steps : [];
    if (route.length > 0) return route.includes(stepCode);
    if (stepCode === 'cut') return p.requires_cut !== false;
    if (stepCode === 'edge') return !!p.requires_edge;
    if (stepCode === 'cnc') return !!p.requires_cnc;
    if (stepCode === 'joinery') return !!p.requires_joinery;
    return true;
  });

  const expected = cellPieces.length;
  const rework = cellPieces.filter(p => ['rework_pending', 'rework_in_progress'].includes(p.status) || p.rework_status === 'in_progress').length;
  const replacement = cellPieces.filter(p => ['replacement_requested', 'replacement_in_production'].includes(p.status) || p.replacement_status === 'in_production').length;

  // 2. Buscar aprovadas
  const { data: approvedFacts } = await supabase
    .from('collection_stage_facts')
    .select('piece_id')
    .eq('step_code_canonico', stepCode);

  const approvedPieceIds = new Set((approvedFacts || []).map(f => f.piece_id));
  const approvedCumulative = cellPieces.filter(p => approvedPieceIds.has(p.id)).length;
  const pending = Math.max(expected - approvedCumulative, 0);

  // 3. Leituras do turno/estação
  let query = supabase
    .from('production_collection_events')
    .select('status, result_status');

  if (resolvedCellName) query = query.ilike('cell_name', resolvedCellName);
  if (workstationId) query = query.eq('machine_id', workstationId);
  if (operatorId) query = query.eq('operator_id', operatorId);
  if (shift) query = query.eq('shift', shift);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);

  const { data: events } = await query;
  const rows = events || [];

  const shiftApproved = rows.filter(r => r.status === 'synced' && r.result_status === 'approved').length;
  const shiftRejected = rows.filter(r => r.result_status === 'rejected').length;
  const shiftBlocked = rows.filter(r => ['blocked', 'duplicated'].includes(r.result_status)).length;

  return {
    total: rows.length,
    approved: approvedCumulative,
    rejected: shiftRejected,
    blocked: shiftBlocked,
    expected,
    pending,
    rework,
    replacement,
    active_lots: new Set(cellPieces.map(p => p.lot_id)).size,
    active_pcp_batches: new Set(cellPieces.map(p => p.pcp_import_batch_id || p.production_lots?.pcp_import_batch_id).filter(Boolean)).size,
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
              order_number,
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
              order_number,
              customer_name
            )
          )
        `)
        .or(`piece_uid.eq.${target},traceability_code.eq.${target},piece_code.eq.${target},id.eq.${target}`)
        .maybeSingle();
      if (!error && data) piece = data;
    }

    if (!piece && !isUuid) {
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
              order_number,
              customer_name
            )
          )
        `)
        .or(`piece_uid.ilike.%${target}%,traceability_code.ilike.%${target}%,piece_code.ilike.%${target}%`)
        .order('created_at', { ascending: false })
        .limit(1)
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

  const uidToSearch = piece?.piece_uid || target;
  const tcodeToSearch = piece?.traceability_code || piece?.piece_code || target;
  const pcodeToSearch = piece?.piece_code || target;
  const idToSearch = piece?.id || (isUuid ? target : null);

  let filterConditions = [
    `tag_value.eq.${uidToSearch}`,
    `tag_value.eq.${tcodeToSearch}`,
    `tag_value.eq.${pcodeToSearch}`,
    `tag_value.ilike.%${target}%`,
    `piece_code.eq.${uidToSearch}`,
    `piece_code.eq.${tcodeToSearch}`,
    `piece_code.eq.${pcodeToSearch}`,
    `piece_code.ilike.%${target}%`,
    `raw_value.eq.${uidToSearch}`,
    `raw_value.eq.${tcodeToSearch}`,
    `raw_value.eq.${pcodeToSearch}`,
    `raw_value.ilike.%${target}%`,
    `traceability_code.eq.${tcodeToSearch}`,
    `traceability_code.ilike.%${target}%`
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

  // O status da peça é canônico. A leitura anterior pode continuar aprovada
  // no histórico, mas não pode sobrescrever uma reprovação já confirmada.
  let computedStatus = normalizeCurrentPieceStatus(piece);
  if (!computedStatus) {
    if (readings.some((reading) => reading.status === 'rejected')) computedStatus = 'rejected';
    else if (readings.some((reading) => reading.status === 'blocked')) computedStatus = 'blocked';
    else if (readings.some((reading) => reading.status === 'approved')) computedStatus = 'approved';
    else computedStatus = 'pending';
  }

  // 3. Montar objeto consolidado da peça garantindo que nenhum campo físico fique vazio
  const resolvedPiece = {
    id: piece?.id || (isUuid ? target : null),
    piece_uid: piece?.piece_uid || target,
    traceability_code: piece?.traceability_code || piece?.piece_code || target,
    piece_code: piece?.piece_code || target,
    piece_name: piece?.piece_name || pcpRowData?.pieceName || 'Peça de Produção MES',
    material: piece?.material || pcpRowData?.material || 'MDF',
    color: piece?.color || pcpRowData?.color || 'Padrão',
    thickness: Number(piece?.thickness || pcpRowData?.thickness || 15),
    width: Number(piece?.width || pcpRowData?.width || 0),
    height: Number(piece?.height || pcpRowData?.height || 0),
    length: Number(piece?.length || piece?.height || pcpRowData?.height || 0),
    environment: piece?.environment || pcpRowData?.environmentName || 'Geral',
    module_name: piece?.module_name || pcpRowData?.moduleName || 'Móvel',
    status: computedStatus,
    current_stage: piece?.current_stage || 'Corte',
    lot_id: piece?.lot_id || null,
    lot_code: piece?.lot_code || piece?.production_lots?.lot_code || pcpRowData?.lotCode || null,
    order_number: piece?.order_number || piece?.production_lots?.production_orders?.order_number || piece?.production_lots?.production_orders?.order_code || pcpRowData?.orderCode || null,
    customer_name: piece?.customer_name || piece?.production_lots?.production_orders?.customer_name || piece?.production_lots?.customer_name || pcpRowData?.customer || null,
    replacement_status: piece?.replacement_status || 'none',
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
  defectCode = null,
  defectName = null,
  sixMCategory = 'Método',
  severity = 'medium',
  disposition = 'scrap',
  requiresReplacement = true,
  operatorId,
  operatorName,
  cellName,
  workstationId,
  clientEventId = null,
  client_event_id = null
}) {
  if (!pieceId && !traceabilityCode) throw new Error('ID ou código da peça é obrigatório.');

  let targetPieceId = pieceId || null;

  // Se pieceId não for informado e tivermos um código de rastreamento, busca o ID da peça no banco
  if (!targetPieceId && traceabilityCode) {
    try {
      const { data } = await supabase
        .from('production_pieces')
        .select('id')
        .or(`piece_uid.eq.${traceabilityCode},traceability_code.eq.${traceabilityCode},piece_code.eq.${traceabilityCode}`)
        .limit(1)
        .maybeSingle();

      if (data?.id) {
        targetPieceId = data.id;
      }
    } catch (err) {
      console.warn('Pré-resolução do código da peça para reprovação:', err);
    }
  }

  const rpcPayload = {
    piece_id: targetPieceId,
    traceability_code: traceabilityCode,
    reason,
    notes,
    disposition: disposition || (action === 'block' ? 'hold' : (action === 'rework' ? 'rework' : (action === 'replacement' ? 'replacement' : 'scrap'))),
    requires_replacement: requiresReplacement,
    defect_id: defectId || null,
    defect_code: defectCode || null,
    defect_name: defectName || reason,
    six_m_category: sixMCategory || 'Método',
    severity: severity || 'medium',
    operator_name: operatorName,
    operator_id: operatorId || null,
    cell_name: cellName,
    machine_id: workstationId || null,
    client_event_id: clientEventId || client_event_id || crypto.randomUUID()
  };

  const { data: rpcResult, error: rpcError } = await supabase.rpc('register_quality_rejection', {
    p_payload: rpcPayload
  });

  if (rpcError) {
    console.error('Erro na RPC register_quality_rejection:', rpcError);
    throw new Error(`Falha ao registrar reprovação: ${rpcError.message || rpcError}`);
  }

  if (!rpcResult?.success) {
    throw new Error(rpcResult?.message || 'A reprovação não foi confirmada pelo banco de dados.');
  }

  await auditLog(
    AUDIT_ACTIONS.STEP_SCRAP,
    'production_piece',
    pieceId || rpcResult?.nonconformity_id,
    { reason, notes, action, disposition, rpcResult }
  );

  return { success: true, ...rpcResult };
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

export const rejectPiece = rejectPieceFromCollection;

import { supabase } from '@/lib/supabaseClient';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const READY_JOINERY_STAGES = ['joinery', 'Marcenaria', 'marcenaria'];
const TERMINAL_PIECE_STATUSES = new Set(['cancelled', 'completed', 'shipped', 'replaced']);

function hasCompletedJoinery(piece) {
  return (piece?.completed_steps || [])
    .some((step) => ['joinery', 'marcenaria'].includes(String(step).trim().toLowerCase()));
}

/**
 * Agrupa a fila canônica de production_pieces no formato consumido pela
 * bancada. A etapa atual é a autoridade da fila; requires_joinery é apenas
 * um campo legado e pode permanecer falso em importações cujo roteiro já
 * contém a etapa joinery.
 */
export function groupReadyJoineryPieces(pieces = [], lots = [], batches = []) {
  const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));
  const grouped = new Map();

  pieces.forEach((piece) => {
    const stage = String(piece.current_stage || '').trim().toLowerCase();
    const status = String(piece.status || '').trim().toLowerCase();
    if (!['joinery', 'marcenaria'].includes(stage)) return;
    if (TERMINAL_PIECE_STATUSES.has(status) || hasCompletedJoinery(piece)) return;

    const lot = lotsById.get(piece.lot_id) || null;
    const batchId = piece.pcp_import_batch_id || lot?.pcp_import_batch_id || null;
    const batch = batchesById.get(batchId) || null;
    const groupId = piece.lot_id || batchId || `piece-${piece.id}`;
    const current = grouped.get(groupId) || {
      id: groupId,
      lot_code: lot?.lot_code || piece.lot_code || 'Sem lote cliente',
      current_stage: 'joinery',
      status: lot?.status || 'in_progress',
      general_lot_code: batch?.general_lot_code || null,
      production_orders: {
        order_code: lot?.order_number || piece.order_number || null,
        customer_name: lot?.customer_name || piece.customer_name || null,
        delivery_date: null,
      },
      lot_items: [],
      ready_since: piece.updated_at || piece.created_at || null,
    };

    current.lot_items.push({
      ...piece,
      quantity: 1,
      // Mantém compatibilidade visual sem voltar a depender do flag legado.
      requires_joinery: true,
    });
    grouped.set(groupId, current);
  });

  return [...grouped.values()].sort((a, b) => {
    const aTime = a.ready_since ? new Date(a.ready_since).getTime() : 0;
    const bTime = b.ready_since ? new Date(b.ready_since).getTime() : 0;
    return aTime - bTime;
  });
}

/**
 * Busca somente peças realmente liberadas para a Marcenaria. A fila antiga
 * consultava lot_items.requires_joinery, embora as importações atuais criem
 * as peças em production_pieces e avancem current_stage para joinery.
 */
export async function fetchReadyJoineryLots() {
  const { data: pieces, error: piecesError } = await supabase
    .from('production_pieces')
    .select(`
      id, piece_uid, traceability_code, piece_name, material, color,
      thickness, width, height, current_stage, status, completed_steps,
      route_steps, lot_id, lot_code, order_number, customer_name,
      pcp_import_batch_id, created_at, updated_at
    `)
    .in('current_stage', READY_JOINERY_STAGES)
    .not('status', 'in', '("cancelled","completed","shipped","replaced")')
    .order('updated_at', { ascending: true })
    .limit(1000);

  if (piecesError) throw piecesError;
  if (!pieces?.length) return [];

  const lotIds = unique(pieces.map((piece) => piece.lot_id));
  const directBatchIds = unique(pieces.map((piece) => piece.pcp_import_batch_id));

  const lotsRequest = lotIds.length
    ? supabase
      .from('production_lots')
      .select('id, lot_code, customer_name, order_number, status, pcp_import_batch_id')
      .in('id', lotIds)
    : Promise.resolve({ data: [], error: null });

  const { data: lots, error: lotsError } = await lotsRequest;
  if (lotsError) throw lotsError;

  const batchIds = unique([
    ...directBatchIds,
    ...(lots || []).map((lot) => lot.pcp_import_batch_id),
  ]);
  const batchesRequest = batchIds.length
    ? supabase
      .from('promob_import_batches')
      .select('id, general_lot_code')
      .in('id', batchIds)
    : Promise.resolve({ data: [], error: null });

  const { data: batches, error: batchesError } = await batchesRequest;
  if (batchesError) throw batchesError;

  return groupReadyJoineryPieces(pieces, lots || [], batches || []);
}

async function submitJoineryCompletion(piece, operatorSession, {
  readerName,
  justification,
  notes,
} = {}) {
  const code = piece?.traceability_code || piece?.piece_uid;
  if (!code) throw new Error('Peça sem identificação de rastreabilidade.');
  if (!operatorSession?.id || !operatorSession?.token) {
    throw new Error('Faça o login operacional antes da baixa da Marcenaria.');
  }

  const eventId = globalThis.crypto?.randomUUID?.()
    || `joinery-${piece.id}-${Date.now()}`;
  const stationName = operatorSession.selected_station_name || 'Bancada Marcenaria';

  const { data, error } = await supabase.rpc('process_production_reading', {
    p_payload: {
      client_event_id: eventId,
      rawValue: code,
      raw_value: code,
      tagValue: code,
      readerType: 'manual',
      readerName: readerName || 'Bancada Marcenaria',
      mode: 'manual',
      manualConfirmed: true,
      requiresJustification: true,
      justification: justification || 'Baixa confirmada na bancada de Marcenaria',
      operatorSessionToken: operatorSession.token,
      operator_session_token: operatorSession.token,
      operatorId: operatorSession.id,
      operator: operatorSession.name,
      shift: operatorSession.shift,
      cellName: 'Marcenaria',
      cellId: operatorSession.selected_cell_id || null,
      machineId: operatorSession.selected_machine_id || null,
      machineName: operatorSession.selected_machine_name || null,
      stationName,
      stepName: 'joinery',
      quantity: 1,
      createdAtClient: new Date().toISOString(),
      notes: notes || `Baixa Marcenaria — ${piece.piece_name || code}`,
    },
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'A baixa da Marcenaria não foi aprovada.');
  return data;
}

export function completeReadyJoineryPiece(piece, operatorSession) {
  return submitJoineryCompletion(piece, operatorSession);
}

export async function fetchManualJoineryPieces() {
  const { data: pieces, error: piecesError } = await supabase
    .from('production_pieces')
    .select(`
      id, piece_uid, traceability_code, piece_name, material, color,
      thickness, width, height, current_stage, status, completed_steps,
      route_steps, lot_id, production_order_id, pcp_import_batch_id,
      manual_joinery, manual_joinery_reason, created_at
    `)
    .eq('manual_joinery', true)
    .order('created_at', { ascending: true })
    .limit(1000);

  // Durante a janela entre publicar o front-end e aplicar a migration, a aba
  // antiga continua funcionando sem derrubar a página.
  if (piecesError) {
    if (['42703', '42P01'].includes(piecesError.code)) return [];
    throw piecesError;
  }

  const pendingPieces = (pieces || []).filter((piece) => (
    !Array.isArray(piece.completed_steps) || !piece.completed_steps.includes('joinery')
  ));
  if (!pendingPieces.length) return [];

  const lotIds = unique(pendingPieces.map((piece) => piece.lot_id));
  const directBatchIds = unique(pendingPieces.map((piece) => piece.pcp_import_batch_id));
  const lotsRequest = lotIds.length
    ? supabase
      .from('production_lots')
      .select('id, lot_code, customer_name, order_number, pcp_import_batch_id')
      .in('id', lotIds)
    : Promise.resolve({ data: [], error: null });

  const { data: lots, error: lotsError } = await lotsRequest;
  const batchIds = unique([
    ...directBatchIds,
    ...(lots || []).map((lot) => lot.pcp_import_batch_id),
  ]);
  const batchesRequest = batchIds.length
    ? supabase
      .from('promob_import_batches')
      .select('id, general_lot_code, file_name, total_parts, completed_parts, pending_parts, progress_percent')
      .in('id', batchIds)
    : Promise.resolve({ data: [], error: null });

  const { data: batches, error: batchesError } = await batchesRequest;

  if (lotsError) throw lotsError;
  if (batchesError && !['42703', '42P01'].includes(batchesError.code)) throw batchesError;

  const lotsById = new Map((lots || []).map((lot) => [lot.id, lot]));
  const batchesById = new Map((batches || []).map((batch) => [batch.id, batch]));

  return pendingPieces.map((piece) => ({
    ...piece,
    lot: lotsById.get(piece.lot_id) || null,
    batch: batchesById.get(
      piece.pcp_import_batch_id || lotsById.get(piece.lot_id)?.pcp_import_batch_id,
    ) || null,
  }));
}

export async function completeManualJoineryPiece(piece, operatorSession) {
  if (!piece?.piece_uid) throw new Error('Peça especial sem identificação interna.');
  return submitJoineryCompletion(piece, operatorSession, {
    readerName: 'Baixa Manual Marcenaria',
    justification: 'Peça especial PCP sem código de barras',
    notes: `Baixa manual Marcenaria — ${piece.piece_name || piece.piece_uid}`,
  });
}

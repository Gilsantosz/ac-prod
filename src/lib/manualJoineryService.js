import { supabase } from '@/lib/supabaseClient';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
  const batchIds = unique(pendingPieces.map((piece) => piece.pcp_import_batch_id));

  const [{ data: lots, error: lotsError }, { data: batches, error: batchesError }] = await Promise.all([
    supabase
      .from('production_lots')
      .select('id, lot_code, customer_name, order_number, pcp_import_batch_id')
      .in('id', lotIds),
    supabase
      .from('promob_import_batches')
      .select('id, general_lot_code, file_name, total_parts, completed_parts, pending_parts, progress_percent')
      .in('id', batchIds),
  ]);

  if (lotsError) throw lotsError;
  if (batchesError && !['42703', '42P01'].includes(batchesError.code)) throw batchesError;

  const lotsById = new Map((lots || []).map((lot) => [lot.id, lot]));
  const batchesById = new Map((batches || []).map((batch) => [batch.id, batch]));

  return pendingPieces.map((piece) => ({
    ...piece,
    lot: lotsById.get(piece.lot_id) || null,
    batch: batchesById.get(piece.pcp_import_batch_id) || null,
  }));
}

export async function completeManualJoineryPiece(piece, operatorSession) {
  if (!piece?.piece_uid) throw new Error('Peça especial sem identificação interna.');
  if (!operatorSession?.id) throw new Error('Faça o login operacional antes da baixa manual.');

  const eventId = globalThis.crypto?.randomUUID?.()
    || `manual-joinery-${piece.id}-${Date.now()}`;

  const { data, error } = await supabase.rpc('process_production_reading', {
    p_payload: {
      client_event_id: eventId,
      rawValue: piece.piece_uid,
      tagValue: piece.piece_uid,
      readerType: 'manual',
      readerName: 'Baixa Manual Marcenaria',
      mode: 'manual',
      manualConfirmed: true,
      justification: 'Peça especial PCP sem código de barras',
      operatorId: operatorSession.id,
      operator: operatorSession.name,
      shift: operatorSession.shift,
      cellName: 'Marcenaria',
      stationName: 'Marcenaria',
      stepName: 'joinery',
      quantity: 1,
      createdAtClient: new Date().toISOString(),
      notes: `Baixa manual Marcenaria — ${piece.piece_name || piece.piece_uid}`,
    },
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'A baixa manual não foi aprovada.');
  return data;
}

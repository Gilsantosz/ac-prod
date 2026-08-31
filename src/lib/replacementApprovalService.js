import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';

export async function getReplacementApprovalContext(orderId) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const { data, error } = await supabase.rpc('get_replacement_order_context', {
    p_order_id: orderId,
  });

  if (error) throw new Error(`Falha ao carregar a reposição selecionada: ${error.message}`);
  if (!data?.order || !data?.original_piece) {
    throw new Error('O banco não retornou o vínculo exato da peça reprovada.');
  }
  if (String(data.order.original_piece_id) !== String(data.original_piece.id)) {
    throw new Error('A ordem aberta não corresponde à peça reprovada retornada pelo banco.');
  }

  return {
    order: data.order,
    originalPiece: data.original_piece,
    replacementPiece: data.replacement_piece || null,
    cells: [],
    routeSteps: Array.isArray(data.route_steps) ? data.route_steps : [],
    barcode: data.barcode || data.original_piece.traceability_code || data.original_piece.piece_uid || null,
    replacementCode: data.replacement_code || data.order.replacement_code || null,
    integrity: data.integrity || null,
    automaticEntriesSupported: false,
    approvalMode: 'station_queue',
  };
}

export async function approveReplacement(orderId, { priority = null } = {}) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const payload = priority ? { priority } : {};
  const { data, error } = await supabase.rpc('approve_piece_replacement', {
    p_order_id: orderId,
    p_payload: payload,
  });

  if (error) throw error;
  if (!data?.success) {
    throw new Error(data?.message || data?.error || 'Não foi possível aprovar a reposição.');
  }
  if (Number(data?.automatic_entries || 0) !== 0 || (data?.approved_cells || []).length > 0) {
    throw new Error('O servidor retornou uma baixa automática indevida durante a aprovação.');
  }

  await auditLog(
    'replacement_approved_for_station',
    'replacement_orders',
    orderId,
    {
      action: 'replacement_approved_for_station',
      priority: priority || null,
      approval_mode: data?.approval_mode || 'station_queue',
      automatic_entries: 0,
      approved_cells: [],
      replacement_piece_id: data?.replacement_piece_id || null,
      replacement_barcode: data?.replacement_barcode || null,
      next_step: data?.next_step || null,
      first_cell_id: data?.first_cell_id || null,
    },
  );

  return data;
}

/**
 * Compatibilidade temporária com chamadas antigas. Células e observações são
 * deliberadamente ignoradas: aprovar não representa produção.
 */
export async function approveReplacementWithCells(orderId, options = {}) {
  return approveReplacement(orderId, { priority: options?.priority || null });
}

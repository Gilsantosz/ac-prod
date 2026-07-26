import { supabase } from '@/lib/supabaseClient';
import { auditLog } from '@/lib/auditLog';

export async function getReplacementApprovalContext(orderId) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const { data, error } = await supabase.rpc('get_replacement_approval_cells', {
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
    cells: Array.isArray(data.cells) ? data.cells : [],
    routeSteps: Array.isArray(data.route_steps) ? data.route_steps : [],
    barcode: data.barcode || data.original_piece.traceability_code || data.original_piece.piece_uid || null,
    replacementCode: data.replacement_code || data.order.replacement_code || null,
    integrity: data.integrity || null,
  };
}

export async function approveReplacementWithCells(
  orderId,
  { priority = 'high', notes = '', selectedCells = [] } = {},
) {
  if (!orderId) throw new Error('ID da ordem de reposição é obrigatório.');

  const normalizedCells = (selectedCells || [])
    .filter((cell) => cell?.cell_id && cell?.step_code)
    .map((cell) => ({
      cell_id: cell.cell_id,
      cell_name: cell.cell_name,
      step_code: cell.step_code,
      step_name: cell.step_name || cell.cell_name,
    }));

  const { data, error } = await supabase.rpc('approve_piece_replacement', {
    p_order_id: orderId,
    p_payload: {
      priority,
      notes: notes.trim(),
      selected_cells: normalizedCells,
    },
  });

  if (error) throw error;

  await auditLog(
    'replacement_approved',
    'replacement_orders',
    orderId,
    {
      action: 'replacement_approved',
      priority,
      notes: notes.trim(),
      selected_cells: normalizedCells,
      automatic_entries: Number(data?.automatic_entries || 0),
      replacement_barcode: data?.replacement_barcode || null,
    },
  );

  return data;
}

import { supabase } from '@/lib/supabaseClient';

const isJoinery = (step) => ['joinery', 'marcenaria'].includes(String(step || '').trim().toLowerCase());

export function joineryPieceState(piece) {
  if (['cancelled', 'replaced'].includes(piece.status)) return { key: 'excluded', label: piece.status === 'cancelled' ? 'Cancelada' : 'Substituída' };
  if ((piece.completed_steps || []).some(isJoinery)) return { key: 'released', label: 'Marcenaria concluída' };
  if (['rejected', 'blocked', 'rework'].includes(piece.status)) return { key: 'issue', label: { rejected: 'Reprovada', blocked: 'Bloqueada', rework: 'Em retrabalho' }[piece.status] };
  if (isJoinery(piece.current_stage)) return { key: 'pending', label: 'Na Marcenaria · aguardando coleta' };
  return { key: 'upstream', label: 'Aguardando etapa anterior' };
}

export function summarizeJoinery(pieces) {
  const counts = { released: 0, pending: 0, issue: 0, upstream: 0, excluded: 0 };
  pieces.forEach((piece) => { counts[joineryPieceState(piece).key] += 1; });
  const total = pieces.length - counts.excluded;
  return { ...counts, total, percent: total ? Math.round(counts.released / total * 100) : 0 };
}

// Read only and scoped to the selected lot. Stable pagination avoids truncated progress.
export async function fetchJoineryLotPieces({ lotId, pieceIds = [] }) {
  if (!lotId && !pieceIds.length) return [];
  const pieces = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.from('production_pieces').select('id, piece_uid, traceability_code, piece_name, material, color, width, height, thickness, current_stage, status, completed_steps, route_steps, manual_joinery, updated_at');
    query = lotId ? query.eq('lot_id', lotId) : query.in('id', pieceIds);
    const { data, error } = await query.order('id').range(from, from + 499);
    if (error) throw error;
    pieces.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  return pieces.filter((piece) => isJoinery(piece.current_stage) || piece.manual_joinery || [...(piece.route_steps || []), ...(piece.completed_steps || [])].some(isJoinery));
}

/**
 * AC.Prod MES — Service de Retrabalho (Rework)
 * 
 * Gerencia a rejeição de peças defeituosas e a geração automática de peças substitutas
 * com código UID diferenciado (ex: sufixo -R) para controle de qualidade e histórico.
 */

import { supabase } from '@/lib/supabaseClient';

/**
 * Busca todos os motivos de retrabalho ativos cadastrados.
 */
export async function getReworkReasons() {
  const { data, error } = await supabase
    .from('rework_reasons')
    .select('*')
    .eq('active', true)
    .order('description', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Cria uma nova ordem de retrabalho para uma peça.
 * Chama a RPC segura 'create_rework_order' do banco.
 * 
 * @param {Object} payload
 * @param {string} payload.piece_id - UUID da peça original avariada
 * @param {string} payload.rework_reason_code - Código do motivo do retrabalho (ex: peca_lascada)
 * @param {string} [payload.operator_id] - UUID do operador
 * @param {string} [payload.notes] - Observações
 */
export async function createReworkOrder(payload) {
  if (!payload.piece_id) throw new Error('Peça original é obrigatória.');
  if (!payload.rework_reason_code) throw new Error('Motivo do retrabalho é obrigatório.');

  const operatorId = payload.operator_id || (await supabase.auth.getUser()).data.user?.id;

  const { data, error } = await supabase.rpc('create_rework_order', {
    p_payload: {
      piece_id: payload.piece_id,
      rework_reason_code: payload.rework_reason_code,
      operator_id: operatorId,
      notes: payload.notes || ''
    }
  });

  if (error) throw new Error(`Falha ao registrar retrabalho: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Erro inesperado na geração do retrabalho.');

  return data;
}

/**
 * Busca todas as ordens de retrabalho.
 */
export async function getReworkOrders() {
  const { data, error } = await supabase
    .from('rework_orders')
    .select(`
      *,
      original_piece:production_pieces!original_piece_id ( id, piece_uid, piece_name, current_stage ),
      replacement_piece:production_pieces!replacement_piece_id ( id, piece_uid, piece_name, current_stage, status ),
      rework_reasons ( description )
    `)
    .order('reported_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

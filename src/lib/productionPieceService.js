/**
 * AC.Prod MES — Fase 3: Service de Peças Canônicas
 *
 * Toda operação de escrita passa por RPCs com SECURITY DEFINER no banco.
 * O cliente nunca escreve diretamente em production_pieces ou production_events.
 *
 * @see /supabase/migrations/026_production_pieces.sql
 * @see src/lib/traceabilityService.js  (coleta por código)
 */

import { supabase } from '@/lib/supabaseClient';

// ─── Tipos de origem (espelho do CHECK no banco) ───────────────────────────────

export const PIECE_SOURCE_ORIGINS = {
  MANUAL:      'manual',
  PROMOB_XML:  'promob_xml',
  CSV:         'csv',
  XLSX:        'xlsx',
  API:         'api',
  REWORK:      'rework',
  CUT_PLAN:    'cut_plan',
  DUPLICATE:   'duplicate',
};

// ─── Tipos de status ───────────────────────────────────────────────────────────

export const PIECE_STATUS = {
  CREATED:     'created',
  PLANNED:     'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETED:   'completed',
  BLOCKED:     'blocked',
  REJECTED:    'rejected',
  REWORK:      'rework',
  SHIPPED:     'shipped',
  CANCELLED:   'cancelled',
};

// ─── Criar peça canônica ───────────────────────────────────────────────────────

/**
 * Cria uma peça canônica com piece_uid imutável gerado pelo banco.
 * Nunca exige cut_plan_id.
 *
 * @param {Object} payload - Dados da peça
 * @param {string} [payload.source_origin='manual'] - Origem da peça
 * @param {string} [payload.piece_name] - Nome da peça
 * @param {string} [payload.production_order_id] - UUID do pedido
 * @param {string} [payload.lot_id] - UUID do lote
 * @param {string} [payload.cut_plan_id] - UUID do plano de corte (OPCIONAL)
 * @returns {Promise<{piece_id, piece_uid, traceability_code, status}>}
 */
export async function createPiece(payload = {}) {
  const { data, error } = await supabase.rpc('create_production_piece', {
    p_payload: {
      source_origin: PIECE_SOURCE_ORIGINS.MANUAL,
      ...payload,
      // Garantir que cut_plan_id nunca venha como string vazia
      cut_plan_id:      payload.cut_plan_id      || null,
      cut_plan_item_id: payload.cut_plan_item_id || null,
    },
  });

  if (error) {
    throw new Error(
      error.code === 'PGRST202'
        ? 'A estrutura de peças canônicas ainda não foi aplicada no Supabase (migration 026).'
        : `Falha ao criar peça: ${error.message}`
    );
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Falha desconhecida ao criar peça.');
  }

  return data;
}

// ─── Criar múltiplas peças em lote ────────────────────────────────────────────

/**
 * Cria múltiplas peças de uma vez (loop sequencial para garantir piece_uid único).
 * Retorna array de resultados com sucesso e erros individuais.
 *
 * @param {Array<Object>} pieces - Lista de payloads de peças
 * @param {Function} [onProgress] - Callback chamado após cada peça criada
 */
export async function createPiecesBatch(pieces = [], onProgress = null) {
  const results = [];
  for (let i = 0; i < pieces.length; i++) {
    try {
      const result = await createPiece(pieces[i]);
      results.push({ index: i, success: true, ...result });
    } catch (err) {
      results.push({ index: i, success: false, error: err.message });
    }
    onProgress?.({ current: i + 1, total: pieces.length, results });
  }
  return results;
}

// ─── Buscar peça por ID ou código ─────────────────────────────────────────────

/**
 * Busca uma peça por ID (uuid) ou por traceability_code / piece_uid.
 *
 * @param {string} idOrCode - UUID, piece_uid ou traceability_code
 */
export async function getPiece(idOrCode) {
  if (!idOrCode) throw new Error('Informe o ID ou código da peça.');

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = uuidPattern.test(idOrCode);

  let query = supabase.from('production_pieces').select(`
    *,
    production_orders ( id, order_code, order_number, customer_name ),
    production_lots   ( id, lot_code, product_name, status )
  `);

  if (isUuid) {
    query = query.eq('id', idOrCode);
  } else {
    query = query.or(
      `traceability_code.eq.${idOrCode},piece_uid.eq.${idOrCode}`
    );
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Falha ao buscar peça: ${error.message}`);
  return data || null;
}

// ─── Buscar peças por lote ─────────────────────────────────────────────────────

/**
 * Busca todas as peças de um lote.
 *
 * @param {string} lotId - UUID do lote
 * @param {Object} [options] - Filtros
 * @param {string} [options.status] - Filtrar por status
 * @param {string} [options.current_stage] - Filtrar por etapa atual
 */
export async function getPiecesByLot(lotId, options = {}) {
  if (!lotId) throw new Error('Informe o ID do lote.');

  let query = supabase
    .from('production_pieces')
    .select('*')
    .eq('lot_id', lotId)
    .order('piece_name', { ascending: true });

  if (options.status) query = query.eq('status', options.status);
  if (options.current_stage) query = query.eq('current_stage', options.current_stage);

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar peças do lote: ${error.message}`);
  return data || [];
}

// ─── Buscar peças por pedido ───────────────────────────────────────────────────

/**
 * Busca todas as peças de um pedido de produção.
 *
 * @param {string} productionOrderId - UUID do pedido
 * @param {Object} [options] - Filtros opcionais
 */
export async function getPiecesByOrder(productionOrderId, options = {}) {
  if (!productionOrderId) throw new Error('Informe o ID do pedido.');

  let query = supabase
    .from('production_pieces')
    .select('*')
    .eq('production_order_id', productionOrderId)
    .order('lot_id', { ascending: true })
    .order('piece_name', { ascending: true });

  if (options.status) query = query.eq('status', options.status);
  if (options.source_origin) query = query.eq('source_origin', options.source_origin);
  if (typeof options.is_blocked === 'boolean') {
    query = query.eq('is_blocked', options.is_blocked);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar peças do pedido: ${error.message}`);
  return data || [];
}

// ─── Avançar etapa de uma peça ─────────────────────────────────────────────────

/**
 * Avança a peça para a próxima etapa da rota produtiva.
 *
 * @param {string} pieceId - UUID da peça
 * @param {Object} payload - Dados do avanço
 * @param {string} payload.to_stage - Nome da etapa destino
 * @param {string} [payload.cell_name] - Célula onde ocorreu
 * @param {string} [payload.operator_id] - UUID do operador
 * @param {string} [payload.notes] - Observações
 */
export async function advancePieceStage(pieceId, payload = {}) {
  if (!pieceId) throw new Error('Informe o ID da peça.');
  if (!payload.to_stage) throw new Error('Informe a etapa destino.');

  const { data, error } = await supabase.rpc('advance_piece_stage', {
    p_piece_id: pieceId,
    p_payload:  payload,
  });

  if (error) throw new Error(`Falha ao avançar etapa: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Falha ao avançar etapa.');
  return data;
}

// ─── Bloquear peça ─────────────────────────────────────────────────────────────

/**
 * Bloqueia uma peça. Requer role admin ou manager.
 *
 * @param {string} pieceId - UUID da peça
 * @param {string} reason - Motivo obrigatório
 */
export async function blockPiece(pieceId, reason) {
  if (!pieceId) throw new Error('Informe o ID da peça.');
  if (!String(reason || '').trim()) throw new Error('Motivo de bloqueio é obrigatório.');

  const { data, error } = await supabase.rpc('block_piece', {
    p_piece_id: pieceId,
    p_reason:   reason,
  });

  if (error) throw new Error(`Falha ao bloquear peça: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Falha ao bloquear peça.');
  return data;
}

// ─── Cancelar peça ─────────────────────────────────────────────────────────────

/**
 * Cancela uma peça (estado final irreversível). Requer admin ou manager.
 *
 * @param {string} pieceId - UUID da peça
 * @param {string} reason - Motivo obrigatório
 */
export async function cancelPiece(pieceId, reason) {
  if (!pieceId) throw new Error('Informe o ID da peça.');
  if (!String(reason || '').trim()) throw new Error('Motivo de cancelamento é obrigatório.');

  const { data, error } = await supabase.rpc('cancel_piece', {
    p_piece_id: pieceId,
    p_reason:   reason,
  });

  if (error) throw new Error(`Falha ao cancelar peça: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Falha ao cancelar peça.');
  return data;
}

// ─── Buscar histórico de eventos de uma peça ──────────────────────────────────

/**
 * Retorna o histórico completo de eventos de uma peça.
 *
 * @param {string} pieceId - UUID da peça
 */
export async function getPieceEvents(pieceId) {
  if (!pieceId) throw new Error('Informe o ID da peça.');

  const { data, error } = await supabase
    .from('production_events')
    .select('*')
    .eq('piece_id', pieceId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Falha ao buscar eventos: ${error.message}`);
  return data || [];
}

// ─── Buscar eventos recentes (para dashboard de rastreabilidade) ───────────────

/**
 * Retorna eventos recentes, filtráveis por célula, lote e data.
 *
 * @param {Object} params
 * @param {string} [params.cell_name] - Filtro por célula
 * @param {string} [params.lot_id] - Filtro por lote
 * @param {string} [params.date] - Filtro por data (YYYY-MM-DD)
 * @param {number} [params.limit=30] - Limite de registros
 */
export async function getRecentPieceEvents(params = {}) {
  const limit = params.limit || 30;

  let query = supabase
    .from('production_events')
    .select('*, production_pieces(piece_uid, piece_name, status)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.cell_name) query = query.eq('cell_name', params.cell_name);
  if (params.lot_id)    query = query.eq('lot_id', params.lot_id);
  if (params.date) {
    const start = `${params.date}T00:00:00.000Z`;
    const end   = `${params.date}T23:59:59.999Z`;
    query = query.gte('created_at', start).lte('created_at', end);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao buscar eventos recentes: ${error.message}`);
  return data || [];
}

// ─── Gerar dados de etiqueta para impressão ───────────────────────────────────

/**
 * Monta o objeto de dados para impressão de etiqueta de uma peça.
 * Usado pelo módulo de etiquetas (ZPL, PDF, etc.)
 *
 * @param {Object} piece - Objeto piece completo (de getPiece)
 * @returns {Object} Dados formatados para etiqueta
 */
export function generatePieceLabelData(piece) {
  if (!piece) throw new Error('Peça não encontrada.');

  return {
    // Identificação
    piece_uid:         piece.piece_uid,
    traceability_code: piece.traceability_code,
    barcode_value:     piece.traceability_code,

    // Conteúdo da etiqueta
    piece_name:        piece.piece_name || '',
    environment:       piece.environment || '',
    module_name:       piece.module_name || '',
    description:       piece.description || '',

    // Dimensões (formatadas)
    dimensions: piece.thickness && piece.width && piece.height
      ? `${piece.thickness}mm × ${piece.width}mm × ${piece.height}mm`
      : null,

    // Material
    material: piece.material || '',
    color:    piece.color    || '',

    // Vínculo
    lot_code:     piece.production_lots?.lot_code     || '',
    order_code:   piece.production_orders?.order_code || '',
    order_number: piece.production_orders?.order_number || '',

    // Status
    status:        piece.status,
    current_stage: piece.current_stage,
    source_origin: piece.source_origin,

    // Gerado em
    generated_at: new Date().toISOString(),
  };
}

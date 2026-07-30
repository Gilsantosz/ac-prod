/**
 * Utilitário de Formatação de Dados Orientativos da Peça para Rastreabilidade MES
 */

/**
 * Retorna o cabeçalho orientativo completo e padronizado da peça para exibição em modais e painéis de rastreabilidade.
 * Exemplo de retorno:
 * "PEÇA TESTE 38 - CORTE + BORDA + USINAGEM + MARCENARIA - PTA INF ESQ 2D MARANELLO TOPO PRETO ABSOLUTO - 672X18X346.5 - 672X346.5X1"
 *
 * @param {Object} piece Objeto da peça (canonical ou DB)
 * @param {Array} route Rota produtiva (opcional)
 * @returns {string} String orientativa formatada
 */
export function formatPieceOrientingHeader(piece, route = []) {
  if (!piece) return '';

  const name = (piece.piece_name || piece.name || piece.piece_code || piece.piece_uid || 'PEÇA').trim().toUpperCase();

  // 1. Rota formatada com +
  let routeStr = '';
  if (Array.isArray(route) && route.length > 0) {
    routeStr = route
      .map((r) => (typeof r === 'string' ? r : r.step_name || r.name || r.code))
      .filter(Boolean)
      .join(' + ')
      .toUpperCase();
  } else if (Array.isArray(piece.route_steps) && piece.route_steps.length > 0) {
    const STEP_MAP = {
      cut: 'CORTE', corte: 'CORTE',
      edge: 'BORDA', borda: 'BORDA',
      drill: 'FURAÇÃO', furacao: 'FURAÇÃO',
      cnc: 'USINAGEM', usinagem: 'USINAGEM',
      maranello: 'MARANELLO',
      joinery: 'MARCENARIA', marcenaria: 'MARCENARIA',
      separation: 'SEPARAÇÃO', separacao: 'SEPARAÇÃO',
      packaging: 'EMBALAGEM', embalagem: 'EMBALAGEM'
    };
    routeStr = piece.route_steps.map((s) => STEP_MAP[s] || String(s).toUpperCase()).join(' + ');
  } else if (piece.route_text || piece.route) {
    routeStr = String(piece.route_text || piece.route).replace(/->/g, '+').toUpperCase();
  }

  // 2. Descrição / Módulo / Ambiente / Cor / Material
  const descParts = [
    piece.description,
    piece.module_name,
    piece.environment || piece.environment_name,
    piece.color,
    piece.material
  ]
    .filter(Boolean)
    .map((s) => String(s).trim().toUpperCase());

  // Remover duplicatas
  const uniqueDesc = Array.from(new Set(descParts)).join(' ');

  // 3. Medidas físicas finais (Largura x Espessura x Comprimento/Altura)
  const width = piece.width || piece.width_mm || '';
  const thickness = piece.thickness || piece.thickness_mm || '';
  const length = piece.length || piece.height || piece.length_mm || '';

  let dimStr = '';
  if (width && thickness && length) {
    dimStr = `${width}X${thickness}X${length}`;
  } else if (width && length) {
    dimStr = `${width}X${length}`;
  }

  // 4. Medidas de Corte / Bruto + Quantidade
  const cutWidth = piece.cut_width || (width ? String(width) : '');
  const cutLength = piece.cut_length || (length ? String(length) : '');
  const qty = piece.quantity || piece.qty || 1;

  let cutDimStr = '';
  if (cutWidth && cutLength) {
    cutDimStr = `${cutWidth}X${cutLength}X${qty}`;
  }

  const parts = [
    name,
    routeStr,
    uniqueDesc,
    dimStr,
    cutDimStr
  ].filter(Boolean);

  return parts.join(' - ');
}

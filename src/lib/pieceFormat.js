/**
 * Utilitário de Formatação de Dados Orientativos da Peça para Rastreabilidade MES
 */

/**
 * Clean & Deduplicate helper
 */
function cleanSegment(str) {
  if (!str) return '';
  return String(str).trim().toUpperCase();
}

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

  const name = cleanSegment(piece.piece_name || piece.name || piece.piece_code || piece.piece_uid || 'PEÇA');

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

  // 2. Descrição / Módulo / Ambiente / Cor
  const rawDesc = cleanSegment(piece.description);
  const rawModule = cleanSegment(piece.module_name);
  const rawEnv = cleanSegment(piece.environment || piece.environment_name);
  const rawColor = cleanSegment(piece.color);

  // Evitar duplicar se a descrição já contiver a rota ou o nome
  const descParts = [];
  if (rawDesc && !rawDesc.includes(name)) descParts.push(rawDesc);
  if (rawModule && !rawDesc.includes(rawModule)) descParts.push(rawModule);
  if (rawEnv && !rawDesc.includes(rawEnv)) descParts.push(rawEnv);
  if (rawColor && !rawDesc.includes(rawColor)) descParts.push(rawColor);

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

/**
 * Retorna todo o contexto orientativo da peça para etiquetas e relatórios PDF:
 * Linha 1 (Cabeçalho): Peça + Rota + Descrição + Medidas + Cor
 * Linha 2 (Subdetalhes): Matéria-prima + Chapa + Fita + Dimensões Físicas
 *
 * @param {Object} piece Objeto da peça
 * @param {Array} route Rota produtiva (opcional)
 * @returns {Object} { header: string, details: string }
 */
export function formatPieceFullContext(piece, route = []) {
  if (!piece) {
    return {
      header: 'PEÇA DE REPOSIÇÃO - CORTE - PROMOB',
      details: 'MDF BRANCO TX 15MM'
    };
  }

  const header = formatPieceOrientingHeader(piece, route);

  // 1. Matéria Prima / Chapa
  const mat = cleanSegment(piece.material || piece.sheet_material || 'MDF BRANCO ARTICO TX 2F');

  // 2. Dimensões da chapa / matéria prima bruta
  const rawSheet = piece.sheet_dimensions || piece.raw_sheet || (piece.sheet_width && piece.sheet_length ? `${piece.sheet_width}X${piece.sheet_length}X${piece.thickness || 15}MM` : null);

  // 3. Fita de Borda / Espessura
  const edgeTape = piece.edge_tape_info || piece.edge_tape || '0';
  const thickness = `${piece.thickness || piece.thickness_mm || 15}mm`;

  // 4. Largura x Comprimento
  const w = piece.width || piece.width_mm || '';
  const l = piece.length || piece.length_mm || piece.height || '';
  const dimsStr = (w && l) ? `${w}x${l}mm` : '';

  const detailParts = [mat];
  if (rawSheet && !mat.includes(rawSheet)) detailParts.push(rawSheet);
  if (edgeTape) detailParts.push(edgeTape);
  if (thickness) detailParts.push(thickness);
  if (dimsStr && !header.includes(dimsStr)) detailParts.push(dimsStr);

  const details = detailParts.filter(Boolean).join(' • ');

  return {
    header,
    details
  };
}

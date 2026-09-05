/**
 * AC.Prod MES — Regras de Validação de Acesso a Células por Operador
 * 
 * Garante que usuários operacionais acessem estritamente as células
 * cadastradas e permitidas para o seu perfil/sessão operacional.
 */

/**
 * Retorna a lista de células (nomes ou objetos) autorizadas para o operador/usuário.
 * 
 * @param {Object} params
 * @param {Object} [params.user] - Usuário logado no Supabase Auth/Profile
 * @param {Object} [params.opSession] - Sessão operacional ativa (useOperatorSession)
 * @param {Array} [params.allCells] - Lista completa de células ativas no sistema
 * @returns {Array} Lista de objetos de células autorizadas
 */
export function getOperatorAllowedCells({ user, opSession, allCells = [] }) {
  // A sessão operacional é a autoridade da estação, inclusive quando o
  // usuário do sistema é administrador. O perfil administrativo não pode
  // ampliar silenciosamente o escopo do operador que assumiu a coleta.
  if (opSession) {
    if (!Array.isArray(opSession.cells) || opSession.cells.length === 0) {
      return [];
    }

    // Pode vir como array de objetos [{ id, name }] ou strings de nomes
    const opCellNamesOrIds = new Set(
      opSession.cells.map(c => (typeof c === 'string' ? c.toLowerCase() : String(c.name || c.id || '').toLowerCase()))
    );

    // Se temos todas as células, filtra as correspondentes
    if (allCells.length > 0) {
      const matched = allCells.filter(c => 
        opCellNamesOrIds.has(String(c.name).toLowerCase()) || 
        opCellNamesOrIds.has(String(c.id).toLowerCase())
      );
      if (matched.length > 0) return matched;
    }

    // Se não bateu com allCells ou allCells está vazio, constrói lista a partir da sessão
    return opSession.cells.map(c => typeof c === 'string' ? { id: c, name: c } : c);
  }

  // Fora de uma estação assumida por operador, administradores mantêm o
  // acesso amplo necessário às telas de gestão.
  if (user?.role === 'admin') {
    return allCells;
  }

  // 2. Se o usuário do sistema possui células vinculadas (managed_cells ou cell)
  const userCellNames = new Set(
    Array.isArray(user?.managed_cells) && user.managed_cells.length > 0
      ? user.managed_cells.map(n => String(n).toLowerCase())
      : user?.cell
        ? [String(user.cell).toLowerCase()]
        : []
  );

  if (userCellNames.size > 0) {
    if (allCells.length > 0) {
      const matched = allCells.filter(c => userCellNames.has(String(c.name).toLowerCase()));
      if (matched.length > 0) return matched;
    }
    return Array.from(userCellNames).map(name => ({ id: name, name }));
  }

  // 3. Usuário operacional sem nenhuma célula cadastrada
  if (user?.role === 'operator' || opSession) {
    return [];
  }

  // Fallback para outros perfis (Viewer/Supervisor/Manager)
  return allCells;
}

/**
 * Verifica se um operador possui permissão para acessar uma determinada célula.
 * 
 * @param {string} targetCellNameOrId - Nome ou ID da célula (ex: "Marcenaria", "Corte")
 * @param {Object} context - Objeto com { user, opSession, allCells }
 * @returns {boolean} True se o acesso for permitido
 */
export function isCellPermittedForOperator(targetCellNameOrId, context = {}) {
  if (!targetCellNameOrId) return false;
  if (context.user?.role === 'admin' && !context.opSession) return true;

  const allowedCells = getOperatorAllowedCells(context);
  if (!allowedCells || allowedCells.length === 0) return false;

  const targetLower = String(targetCellNameOrId).toLowerCase();

  return allowedCells.some(cell => {
    const cName = String(cell.name || cell.id || cell).toLowerCase();
    const cType = String(cell.type || '').toLowerCase();
    return cName === targetLower || (targetLower === 'marcenaria' && cType === 'joinery');
  });
}

/**
 * Verifica se o operador atual possui permissão explícita para a Marcenaria.
 */
export function hasMarcenariaAccess(context = {}) {
  if (context.user?.role === 'admin' && !context.opSession) return true;
  return isCellPermittedForOperator('Marcenaria', context) || isCellPermittedForOperator('marcenaria', context);
}

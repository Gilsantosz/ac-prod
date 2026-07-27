import { describe, it, expect } from 'vitest';
import { 
  getOperatorAllowedCells, 
  isCellPermittedForOperator, 
  hasMarcenariaAccess 
} from '../operatorCellRules';

describe('operatorCellRules', () => {
  const allCells = [
    { id: '1', name: 'Corte', type: 'cutting' },
    { id: '2', name: 'Borda', type: 'edging' },
    { id: '3', name: 'Furação', type: 'drilling' },
    { id: '4', name: 'Marcenaria', type: 'joinery' },
  ];

  it('permite acesso total para administradores', () => {
    const user = { role: 'admin' };
    const allowed = getOperatorAllowedCells({ user, allCells });
    expect(allowed).toHaveLength(4);
    expect(hasMarcenariaAccess({ user, allCells })).toBe(true);
    expect(isCellPermittedForOperator('Corte', { user, allCells })).toBe(true);
  });

  it('restringe operador à lista de células cadastradas na sessão operacional', () => {
    const opSession = {
      name: 'Carlos Silva',
      cells: [{ id: '1', name: 'Corte' }, { id: '2', name: 'Borda' }]
    };
    const user = { role: 'operator' };

    const allowed = getOperatorAllowedCells({ user, opSession, allCells });
    expect(allowed).toHaveLength(2);
    expect(allowed.map(c => c.name)).toEqual(['Corte', 'Borda']);

    expect(isCellPermittedForOperator('Corte', { user, opSession, allCells })).toBe(true);
    expect(isCellPermittedForOperator('Borda', { user, opSession, allCells })).toBe(true);
    expect(isCellPermittedForOperator('Furação', { user, opSession, allCells })).toBe(false);
    expect(hasMarcenariaAccess({ user, opSession, allCells })).toBe(false);
  });

  it('libera Marcenaria somente para operador com cadastro na célula Marcenaria', () => {
    const opSessionMarcenaria = {
      name: 'João Marceneiro',
      cells: [{ id: '4', name: 'Marcenaria' }]
    };
    const user = { role: 'operator' };

    expect(hasMarcenariaAccess({ user, opSession: opSessionMarcenaria, allCells })).toBe(true);
    expect(isCellPermittedForOperator('Corte', { user, opSession: opSessionMarcenaria, allCells })).toBe(false);
  });

  it('bloqueia operador sem nenhuma célula no cadastro', () => {
    const opSessionVazia = {
      name: 'Sem Célula',
      cells: []
    };
    const user = { role: 'operator', cell: null, managed_cells: [] };

    const allowed = getOperatorAllowedCells({ user, opSession: opSessionVazia, allCells });
    expect(allowed).toHaveLength(0);
    expect(isCellPermittedForOperator('Corte', { user, opSession: opSessionVazia, allCells })).toBe(false);
    expect(hasMarcenariaAccess({ user, opSession: opSessionVazia, allCells })).toBe(false);
  });
});

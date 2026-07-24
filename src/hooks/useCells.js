import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getCells } from '@/lib/cellsGoalsService';
import { useAuth } from '@/lib/AuthContext';

const HOURS_KEY = { '1º Turno': 'hoursShift1', '2º Turno': 'hoursShift2', '3º Turno': 'hoursShift3' };

// Hook central de células cadastradas. Usado por formulários e painéis
// para que todo o sistema reflita o cadastro de células e horas por turno.
export function useCells() {
  const { user } = useAuth();
  const { data: cells = [], isLoading } = useQuery({
    queryKey: ['cells'],
    queryFn: getCells,
    initialData: [],
  });

  const scopedCells = useMemo(() => {
    if (!user || user.role === 'admin') return cells;
    const allowedNames = Array.isArray(user.managed_cells) && user.managed_cells.length
      ? user.managed_cells
      : user.cell
        ? [user.cell]
        : [];
    if (user.role === 'operator' || allowedNames.length > 0) {
      return cells.filter((cell) => allowedNames.includes(cell.name));
    }
    return cells;
  }, [cells, user]);

  const activeCells = useMemo(
    () => scopedCells.filter((c) => c.active !== false),
    [scopedCells]
  );

  // Retorna as horas trabalhadas de uma célula em um turno
  const getShiftHours = (cellName, shift) => {
    const cell = scopedCells.find((c) => c.name === cellName);
    if (!cell) return null;
    return cell[HOURS_KEY[shift]] ?? 8;
  };

  // Retorna o cadastro completo de uma célula pelo nome
  const getCell = (cellName) => scopedCells.find((c) => c.name === cellName) || null;

  return { cells: scopedCells, activeCells, getShiftHours, getCell, isLoading };
}

export { HOURS_KEY };

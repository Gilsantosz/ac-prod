import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getCells } from '@/lib/cellsGoalsService';
import { useAuth } from '@/lib/AuthContext';
import { getOperatorAllowedCells } from '@/lib/operatorCellRules';

const HOURS_KEY = { '1º Turno': 'hoursShift1', '2º Turno': 'hoursShift2', '3º Turno': 'hoursShift3' };

// Hook central de células cadastradas. Usado por formulários e painéis
// para que todo o sistema reflita o cadastro de células e horas por turno.
export function useCells() {
  const { user } = useAuth();
  const { data: cells = [], isLoading, refetch } = useQuery({
    queryKey: ['cells'],
    queryFn: getCells,
    initialData: [],
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });

  const scopedCells = useMemo(() => {
    return getOperatorAllowedCells({ user, allCells: cells });
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

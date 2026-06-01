import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { base44 } from '@/lib/localDb';

const HOURS_KEY = { '1º Turno': 'hoursShift1', '2º Turno': 'hoursShift2', '3º Turno': 'hoursShift3' };

// Hook central de células cadastradas. Usado por formulários e painéis
// para que todo o sistema reflita o cadastro de células e horas por turno.
export function useCells() {
  const { data: cells = [], isLoading } = useQuery({
    queryKey: ['cells'],
    queryFn: () => base44.entities.Cell.list('-created_date', 200),
    initialData: [],
  });

  const activeCells = useMemo(
    () => cells.filter((c) => c.active !== false),
    [cells]
  );

  // Retorna as horas trabalhadas de uma célula em um turno
  const getShiftHours = (cellName, shift) => {
    const cell = cells.find((c) => c.name === cellName);
    if (!cell) return null;
    return cell[HOURS_KEY[shift]] ?? 8;
  };

  // Retorna o cadastro completo de uma célula pelo nome
  const getCell = (cellName) => cells.find((c) => c.name === cellName) || null;

  return { cells, activeCells, getShiftHours, getCell, isLoading };
}

export { HOURS_KEY };
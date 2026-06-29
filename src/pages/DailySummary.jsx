import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { Calendar, ClipboardList, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { buildDailySummary } from '@/lib/dailySummary';
import { useCells } from '@/hooks/useCells';
import SummaryKpis from '@/components/daily/SummaryKpis';
import SummaryTable from '@/components/daily/SummaryTable';
import DailyProductionMatrix from '@/components/daily/DailyProductionMatrix';
import DailyGoalEditor from '@/components/daily/DailyGoalEditor';
import CloseShiftButton from '@/components/daily/CloseShiftButton';
import ExportDailyButton from '@/components/daily/ExportDailyButton';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function DailySummary() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [selectedShifts, setSelectedShifts] = useState(['1º Turno', '2º Turno', '3º Turno']);
  const [selectedCells, setSelectedCells] = useState([]);
  const { activeCells } = useCells();

  const { data: entries = [] } = useQuery({
    queryKey: ['production', date],
    queryFn: () => base44.entities.ProductionEntry.filter({ date }, '-created_date', 1000),
    initialData: [],
  });

  const { data: goals = [], refetch: refetchGoals } = useQuery({
    queryKey: ['productionDailyGoals', date],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_daily_goals').select('*').eq('date', date);
      if (error) {
        if (/schema cache|does not exist|production_daily_goals/i.test(error.message || '')) return [];
        throw error;
      }
      return data || [];
    },
    initialData: [],
  });

  const toggleShift = (shiftName) => {
    setSelectedShifts((prev) =>
      prev.includes(shiftName) ? prev.filter((s) => s !== shiftName) : [...prev, shiftName]
    );
  };

  const toggleCell = (cellName) => {
    setSelectedCells((prev) =>
      prev.includes(cellName) ? prev.filter((c) => c !== cellName) : [...prev, cellName]
    );
  };

  const shiftTriggerText = useMemo(() => {
    if (selectedShifts.length === 0) return 'Nenhum turno';
    if (selectedShifts.length === 3) return 'Todos os turnos';
    return selectedShifts.join(', ');
  }, [selectedShifts]);

  const cellTriggerText = useMemo(() => {
    if (selectedCells.length === 0) return 'Todas as células';
    if (selectedCells.length === activeCells.length) return 'Todas as células';
    if (selectedCells.length > 2) return `${selectedCells.length} selecionadas`;
    return selectedCells.join(', ');
  }, [selectedCells, activeCells]);

  const filtered = useMemo(
    () => entries.filter((e) => selectedShifts.includes(e.shift) && (selectedCells.length === 0 || selectedCells.includes(e.cell))),
    [entries, selectedShifts, selectedCells]
  );

  const filteredGoals = useMemo(
    () => goals.filter((goal) => selectedShifts.includes(goal.shift) && (selectedCells.length === 0 || selectedCells.includes(goal.cell_name || goal.cell))),
    [goals, selectedShifts, selectedCells]
  );

  const summary = useMemo(() => buildDailySummary(filtered, filteredGoals), [filtered, filteredGoals]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Resumo Diário"
        subtitle="Acumulado por turno, célula e unidade operacional."
        icon={ClipboardList}
        actions={
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto">
            {/* Seletor de Data em Cápsula */}
            <div className="flex items-center gap-2 bg-card border border-border/80 rounded-full px-4 py-2 w-full sm:w-auto shrink-0 shadow-sm">
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border-0 p-0 h-auto w-full sm:w-36 focus-visible:ring-0 text-foreground bg-transparent font-medium focus:outline-none [color-scheme:light] dark:[color-scheme:dark]" />
            </div>

            {/* Seletor de Turno em Cápsula */}
            <div className="w-full sm:w-44 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between gap-2 text-left font-normal bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full focus:ring-0 focus:ring-offset-0 shadow-sm px-4">
                    <span className="truncate">{shiftTriggerText}</span>
                    <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full sm:w-44 rounded-2xl">
                  <DropdownMenuLabel>Filtrar por Turno</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={selectedShifts.length === 3} onCheckedChange={(c) => setSelectedShifts(c ? ['1º Turno', '2º Turno', '3º Turno'] : [])}>Todos os turnos</DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={selectedShifts.includes('1º Turno')} onCheckedChange={() => toggleShift('1º Turno')}>1º Turno</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={selectedShifts.includes('2º Turno')} onCheckedChange={() => toggleShift('2º Turno')}>2º Turno</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={selectedShifts.includes('3º Turno')} onCheckedChange={() => toggleShift('3º Turno')}>3º Turno</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Seletor de Célula em Cápsula */}
            <div className="w-full sm:w-52 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between gap-2 text-left font-normal bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full focus:ring-0 focus:ring-offset-0 shadow-sm px-4">
                    <span className="truncate">{cellTriggerText}</span>
                    <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full sm:w-52 rounded-2xl">
                  <DropdownMenuLabel>Filtrar por Célula</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={selectedCells.length === 0} onCheckedChange={() => setSelectedCells([])}>Todas as células</DropdownMenuCheckboxItem>
                  {activeCells.length > 0 && <DropdownMenuSeparator />}
                  {activeCells.map((c) => (
                    <DropdownMenuCheckboxItem key={c.id} checked={selectedCells.includes(c.name)} onCheckedChange={() => toggleCell(c.name)}>{c.name}</DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <ExportDailyButton date={date} shift={selectedShifts} cell={selectedCells} summary={summary} disabled={filtered.length === 0 && filteredGoals.length === 0} />
        <CloseShiftButton date={date} disabled={filtered.length === 0 && filteredGoals.length === 0} />
      </div>

      {user?.role !== 'operator' && (
        <DailyGoalEditor date={date} activeCells={activeCells} onSaved={refetchGoals} />
      )}

      <SummaryKpis total={summary.total} summary={summary} />

      <DailyProductionMatrix rows={summary.matrixByCell} shifts={summary.shifts} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SummaryTable title="Produção por Célula" rows={summary.byCell} keyLabel="Célula" keyField="cell" />
        <SummaryTable title="Produção por Turno" rows={summary.byShift} keyLabel="Turno" keyField="shift" />
      </div>
    </div>
  );
}

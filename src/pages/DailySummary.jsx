import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import {
  Calendar, ClipboardList, ChevronDown, SlidersHorizontal,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
import DailySummaryCharts from '@/components/daily/DailySummaryCharts';
import ExportDailyButton from '@/components/daily/ExportDailyButton';
import CloseShiftButton from '@/components/daily/CloseShiftButton';

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

  const formattedDateString = useMemo(() => {
    const parts = date.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return date;
  }, [date]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 bg-background min-h-screen">
      {/* ── CABEÇALHO DA PÁGINA ───────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Rótulo superior pequeno */}
        <span className="text-[11px] font-extrabold tracking-wider uppercase text-black dark:text-white block">
          ACUMULADO POR TURNO, CÉLULA E UNIDADE OPERACIONAL
        </span>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Título com Ícone */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/60 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0 shadow-sm">
              <ClipboardList className="w-5 h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              Resumo Diário
            </h1>
          </div>

          {/* Filtros da Barra Superior */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Data */}
            <div className="flex items-center gap-2 bg-card border border-border/80 rounded-xl px-3.5 py-2 shadow-sm text-xs font-semibold text-foreground">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-0 p-0 h-auto w-32 focus-visible:ring-0 text-foreground bg-transparent font-semibold focus:outline-none text-xs [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>

            {/* Turnos */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 px-3.5 text-xs font-semibold bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-xl shadow-sm gap-2">
                  <span>{shiftTriggerText}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-48 rounded-xl">
                <DropdownMenuLabel className="text-xs">Filtrar por Turno</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={selectedShifts.length === 3} onCheckedChange={(c) => setSelectedShifts(c ? ['1º Turno', '2º Turno', '3º Turno'] : [])}>
                  Todos os turnos
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={selectedShifts.includes('1º Turno')} onCheckedChange={() => toggleShift('1º Turno')}>1º Turno</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={selectedShifts.includes('2º Turno')} onCheckedChange={() => toggleShift('2º Turno')}>2º Turno</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={selectedShifts.includes('3º Turno')} onCheckedChange={() => toggleShift('3º Turno')}>3º Turno</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Células */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 px-3.5 text-xs font-semibold bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-xl shadow-sm gap-2">
                  <span>{cellTriggerText}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52 rounded-xl">
                <DropdownMenuLabel className="text-xs">Filtrar por Célula</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={selectedCells.length === 0} onCheckedChange={() => setSelectedCells([])}>
                  Todas as células
                </DropdownMenuCheckboxItem>
                {activeCells.length > 0 && <DropdownMenuSeparator />}
                {activeCells.map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={selectedCells.includes(c.name)} onCheckedChange={() => toggleCell(c.name)}>
                    {c.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Botão Filtros Escuro */}
            <Button className="h-9 px-4 text-xs font-bold bg-[#1A2238] hover:bg-[#111728] text-white rounded-xl shadow-sm gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Filtros
            </Button>
          </div>
        </div>

        {/* Botões de Ação Secundários */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <ExportDailyButton
            date={date}
            shift={selectedShifts}
            cell={selectedCells}
            summary={summary}
            disabled={filtered.length === 0 && filteredGoals.length === 0}
          />
          <CloseShiftButton
            date={date}
            disabled={filtered.length === 0 && filteredGoals.length === 0}
          />
        </div>
      </div>

      {/* ── CARD DE EDITOR DE METAS POR CÉLULA E UNIDADE ─────────────────────── */}
      {user?.role !== 'operator' && (
        <DailyGoalEditor date={date} activeCells={activeCells} onSaved={refetchGoals} />
      )}

      {/* ── GRADE DE CARDS KPI SUPERIORES (8 CARDS) ─────────────────────────── */}
      <SummaryKpis total={summary.total} summary={summary} />

      {/* ── TABELA DE MATRIZ DE PRODUÇÃO (CÉLULA, TURNO E UNIDADE) ─────────── */}
      <DailyProductionMatrix rows={summary.matrixByCell} shifts={summary.shifts} />

      {/* ── TABELAS DE PRODUÇÃO POR CÉLULA E POR TURNO (2 COLUNAS) ─────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SummaryTable title="Produção por Célula" rows={summary.byCell} keyLabel="Célula" keyField="cell" />
        <SummaryTable title="Produção por Turno" rows={summary.byShift} keyLabel="Turno" keyField="shift" />
      </div>

      {/* ── GRÁFICOS ANALÍTICOS INFERIORES (3 CARDS) ────────────────────────── */}
      <DailySummaryCharts summary={summary} entries={filtered} />

      {/* ── BARRA DE STATUS INFERIOR / RODAPÉ ───────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-4 border-t border-border/40 text-xs text-muted-foreground font-medium">
        <div className="flex items-center gap-2">
          <span>Dados atualizados em {formattedDateString} às 08:45</span>
          <RefreshCw className="w-3.5 h-3.5 cursor-pointer hover:text-foreground transition-colors" onClick={() => refetchGoals()} />
        </div>
        <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Sincronizado</span>
        </div>
      </div>
    </div>
  );
}

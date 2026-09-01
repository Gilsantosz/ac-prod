import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar, CalendarRange, ClipboardList, ChevronDown,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { aggregateDailyGoals, buildDailySummary } from '@/lib/dailySummary';
import {
  fetchDailySummaryYearBounds,
  fetchProductionEntriesRange,
  fetchProductionGoalsRange,
} from '@/lib/dailySummaryData';
import { ANNUAL_FILTER_DISABLED, getDailySummaryPeriod } from '@/lib/dailySummaryPeriod';
import { buildDashboardYearOptions } from '@/lib/dashboardPeriod';
import { useCells } from '@/hooks/useCells';
import { getCanonicalCellKey } from '@/lib/productionStagePolicyService';
import SummaryKpis from '@/components/daily/SummaryKpis';
import SummaryTable from '@/components/daily/SummaryTable';
import DailyProductionMatrix from '@/components/daily/DailyProductionMatrix';
import DailySummaryCharts from '@/components/daily/DailySummaryCharts';
import ExportDailyButton from '@/components/daily/ExportDailyButton';
import CloseShiftButton from '@/components/daily/CloseShiftButton';

function getLocalDateStr(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBefore(dateStr, amount) {
  const parts = String(dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  const value = new Date(parts[0], parts[1] - 1, parts[2]);
  value.setDate(value.getDate() - amount);
  return getLocalDateStr(value);
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function DailySummary() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => getLocalDateStr());
  const [year, setYear] = useState(ANNUAL_FILTER_DISABLED);
  const [selectedShifts, setSelectedShifts] = useState(['1º Turno', '2º Turno', '3º Turno']);
  const [selectedCells, setSelectedCells] = useState([]);
  const { activeCells } = useCells();
  const period = useMemo(() => getDailySummaryPeriod(date, year), [date, year]);
  const { fromDate, toDate, annual: annualMode } = period;

  // 1. Snapshot produtivo do período selecionado (carregamento prioritário)
  const {
    data: entries = [],
    dataUpdatedAt: entriesUpdatedAt,
    isFetching: isFetchingEntries,
    isError: entriesError,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: ['production', 'daily-summary', fromDate, toDate],
    queryFn: () => fetchProductionEntriesRange(fromDate, toDate),
    placeholderData: [],
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchInterval: annualMode ? false : 30_000, // Fallback a cada 30 segundos
  });

  const {
    data: goals = [],
    dataUpdatedAt: goalsUpdatedAt,
    isFetching: isFetchingGoals,
    isError: goalsError,
    refetch: refetchGoals,
  } = useQuery({
    queryKey: ['productionDailyGoals', fromDate, toDate],
    queryFn: () => fetchProductionGoalsRange(fromDate, toDate),
    placeholderData: [],
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchInterval: annualMode ? false : 30_000, // Fallback a cada 30 segundos
  });

  const {
    data: yearBounds,
    refetch: refetchYearBounds,
  } = useQuery({
    queryKey: ['daily-summary-year-bounds'],
    queryFn: fetchDailySummaryYearBounds,
    staleTime: 5 * 60 * 1000,
  });

  const availableYears = useMemo(
    () => buildDashboardYearOptions(yearBounds?.oldestDate, yearBounds?.newestDate),
    [yearBounds],
  );

  // 2. Histórico de 7 dias, usado apenas na visualização diária
  const isMainDataLoaded = !isFetchingEntries && !isFetchingGoals;
  const historyStart = useMemo(() => daysBefore(date, 6), [date]);

  const {
    data: historyEntries = [],
    dataUpdatedAt: historyUpdatedAt,
    isFetching: isFetchingHistory,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['daily-summary-history', historyStart, date],
    queryFn: () => fetchProductionEntriesRange(historyStart, date),
    placeholderData: [],
    enabled: isMainDataLoaded && !annualMode,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const {
    data: historyGoals = [],
    refetch: refetchHistoryGoals,
  } = useQuery({
    queryKey: ['daily-summary-history-goals', historyStart, date],
    queryFn: () => fetchProductionGoalsRange(historyStart, date),
    placeholderData: [],
    enabled: isMainDataLoaded && !annualMode,
    staleTime: 30_000,
    refetchInterval: 60_000,
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

  const canonicalSelectedCells = useMemo(
    () => new Set(selectedCells.map((c) => getCanonicalCellKey(c))),
    [selectedCells]
  );

  const filtered = useMemo(
    () => entries.filter((e) =>
      selectedShifts.includes(e.shift) &&
      (canonicalSelectedCells.size === 0 || canonicalSelectedCells.has(getCanonicalCellKey(e.cell)))
    ),
    [entries, selectedShifts, canonicalSelectedCells]
  );

  const filteredGoals = useMemo(
    () => goals.filter((goal) =>
      selectedShifts.includes(goal.shift) &&
      (canonicalSelectedCells.size === 0 || canonicalSelectedCells.has(getCanonicalCellKey(goal.cell_name || goal.cell)))
    ),
    [goals, selectedShifts, canonicalSelectedCells]
  );

  const summaryCells = useMemo(
    () => (selectedCells.length > 0 ? selectedCells : activeCells.map((cell) => cell.name)),
    [selectedCells, activeCells],
  );
  const summaryGoals = useMemo(
    () => annualMode ? aggregateDailyGoals(filteredGoals) : filteredGoals,
    [annualMode, filteredGoals],
  );
  const summary = useMemo(
    () => buildDailySummary(filtered, summaryGoals, {
      activeCells: summaryCells,
      shifts: selectedShifts,
    }),
    [filtered, summaryGoals, summaryCells, selectedShifts],
  );

  const evolutionData = useMemo(() => {
    if (annualMode) {
      return MONTH_LABELS.map((monthLabel, index) => {
        const monthPrefix = `${year}-${String(index + 1).padStart(2, '0')}`;
        const monthEntries = filtered.filter((entry) => entry.date?.startsWith(monthPrefix));
        const monthGoals = aggregateDailyGoals(
          filteredGoals.filter((goal) => goal.date?.startsWith(monthPrefix)),
        );
        const monthSummary = buildDailySummary(monthEntries, monthGoals, {
          activeCells: summaryCells,
          shifts: selectedShifts,
        });
        const target = monthSummary.totalsByUnit.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
        const realized = monthSummary.totalsByUnit.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);

        return {
          date: monthLabel,
          rate: target > 0 ? Math.round((realized / target) * 1000) / 10 : 0,
          target,
          realized,
        };
      });
    }

    return Array.from({ length: 7 }, (_, index) => {
      const day = daysBefore(date, 6 - index);
      const dayEntries = historyEntries.filter((entry) =>
        entry.date === day
        && selectedShifts.includes(entry.shift)
        && (canonicalSelectedCells.size === 0 || canonicalSelectedCells.has(getCanonicalCellKey(entry.cell)))
      );
      const dayGoals = historyGoals.filter((goal) =>
        goal.date === day
        && selectedShifts.includes(goal.shift)
        && (canonicalSelectedCells.size === 0 || canonicalSelectedCells.has(getCanonicalCellKey(goal.cell_name || goal.cell)))
      );
      const daySummary = buildDailySummary(dayEntries, dayGoals, {
        activeCells: summaryCells,
        shifts: selectedShifts,
      });
      const target = daySummary.totalsByUnit.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
      const realized = daySummary.totalsByUnit.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);
      const [, month, dayOfMonth] = day.split('-');

      return {
        date: `${dayOfMonth}/${month}`,
        rate: target > 0 ? Math.round((realized / target) * 1000) / 10 : 0,
        target,
        realized,
      };
    });
  }, [annualMode, date, filtered, filteredGoals, historyEntries, historyGoals, selectedShifts, canonicalSelectedCells, summaryCells, year]);

  const formattedPeriodString = useMemo(() => {
    if (annualMode) return `ano de ${year}`;
    const parts = date.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return date;
  }, [annualMode, date, year]);

  const lastUpdatedAt = Math.max(entriesUpdatedAt || 0, goalsUpdatedAt || 0, historyUpdatedAt || 0);
  const lastUpdatedTime = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';
  const isFetching = isFetchingEntries || isFetchingGoals || (!annualMode && isFetchingHistory);
  const hasSyncError = entriesError || goalsError || (!annualMode && historyError);
  const refreshAll = async () => {
    const refreshers = [refetchEntries, refetchGoals, refetchYearBounds];
    if (!annualMode) refreshers.push(refetchHistory, refetchHistoryGoals);
    await Promise.all(refreshers.map((refetch) => refetch({ throwOnError: true })));
  };
  const handleRefresh = async () => {
    try {
      await refreshAll();
      toast.success('Dados do resumo atualizados.');
    } catch (error) {
      toast.error(error?.message || 'Não foi possível atualizar os dados do resumo.');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 bg-background min-h-screen">
      {/* ── CABEÇALHO DA PÁGINA ───────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Rótulo superior pequeno */}
        <span className="text-[11px] font-extrabold tracking-wider uppercase text-black dark:text-white block">
          {annualMode ? `METAS E PRODUÇÃO CONSOLIDADAS DE ${year}` : 'ACUMULADO POR TURNO, CÉLULA E UNIDADE OPERACIONAL'}
        </span>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Título com Ícone */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/60 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0 shadow-sm">
              <ClipboardList className="w-5 h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {annualMode ? `Resumo Anual — ${year}` : 'Resumo Diário'}
            </h1>
          </div>

          {/* Filtros da Barra Superior */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Ano */}
            <div className={`w-48 rounded-xl shadow-sm ${annualMode ? 'ring-2 ring-indigo-500/25' : ''}`}>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger
                  aria-label="Ano do resumo"
                  className="w-full h-9 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-xl focus:ring-0 focus:ring-offset-0 px-3.5 text-xs font-semibold"
                >
                  <CalendarRange className={`mr-2 h-4 w-4 shrink-0 ${annualMode ? 'text-indigo-600' : 'text-muted-foreground'}`} />
                  <SelectValue placeholder="Selecionar ano" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value={ANNUAL_FILTER_DISABLED}>Visualização diária</SelectItem>
                  {availableYears.map((availableYear) => (
                    <SelectItem key={availableYear} value={availableYear}>Ano completo · {availableYear}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data */}
            <div
              className={`flex items-center gap-2 bg-card border border-border/80 rounded-xl px-3.5 py-2 shadow-sm text-xs font-semibold text-foreground ${annualMode ? 'opacity-50' : ''}`}
              title={annualMode ? 'Selecione “Visualização diária” para alterar a data' : 'Selecionar data'}
            >
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <Input
                aria-label="Data do resumo"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={annualMode}
                className="border-0 p-0 h-auto w-32 focus-visible:ring-0 text-foreground bg-transparent font-semibold focus:outline-none text-xs [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>

            {/* Turnos */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="Filtrar por turno" variant="outline" className="h-9 px-3.5 text-xs font-semibold bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-xl shadow-sm gap-2">
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
                <Button aria-label="Filtrar por célula" variant="outline" className="h-9 px-3.5 text-xs font-semibold bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-xl shadow-sm gap-2">
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

            {/* Atualização explícita das consultas do período atual */}
            <Button
              type="button"
              onClick={handleRefresh}
              disabled={isFetching}
              className="h-9 px-4 text-xs font-bold bg-[#1A2238] hover:bg-[#111728] text-white rounded-xl shadow-sm gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              {isFetching ? 'Atualizando' : 'Atualizar dados'}
            </Button>
          </div>
        </div>

        {/* Botões de Ação Secundários */}
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <ExportDailyButton
            date={date}
            period={{
              from: fromDate,
              to: toDate,
              label: period.label,
              title: annualMode ? 'Resumo Anual de Produção' : 'Resumo Diário de Produção',
              filename: annualMode ? `resumo-anual-${year}` : `resumo-diario-${date}`,
            }}
            shift={selectedShifts}
            cell={selectedCells}
            summary={summary}
            generatedBy={user?.name || user?.email || ''}
            cells={activeCells}
          />
          {!annualMode && (
            <CloseShiftButton
              date={date}
              shift={selectedShifts}
              cell={selectedCells}
            />
          )}
        </div>
      </div>

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
      <DailySummaryCharts
        summary={summary}
        entries={filtered}
        evolutionData={evolutionData}
        attainmentLabel={annualMode ? `Ano ${year}` : 'Hoje'}
      />

      {/* ── BARRA DE STATUS INFERIOR / RODAPÉ ───────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-4 border-t border-border/40 text-xs text-muted-foreground font-medium">
        <div className="flex items-center gap-2">
          <span>Dados de {formattedPeriodString} atualizados às {lastUpdatedTime}</span>
          <button
            type="button"
            className="rounded-full p-1 hover:bg-secondary hover:text-foreground transition-colors"
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Atualizar dados do resumo"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className={`flex items-center gap-1.5 font-bold ${hasSyncError ? 'text-red-600' : isFetching ? 'text-blue-600' : 'text-emerald-600 dark:text-emerald-400'}`}>
          <span className={`w-2 h-2 rounded-full ${hasSyncError ? 'bg-red-500' : isFetching ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span>{hasSyncError ? 'Falha na sincronização' : isFetching ? 'Atualizando' : 'Sincronizado em tempo real'}</span>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Package, Target, Gauge, AlertTriangle, Monitor, Minimize2, LayoutDashboard, FlaskConical, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';
import { runSeedTestData } from '@/lib/seedTestData';
import PageHeader from '@/components/ui/PageHeader';
import { useKiosk } from '@/lib/KioskContext';
import { useCells } from '@/hooks/useCells';
import {
  isFullscreenActive,
  isFullscreenSupported,
  enterFullscreen,
  exitFullscreen
} from '@/lib/fullscreenService';
import KioskCellControl from '@/components/dashboard/KioskCellControl';
import KpiCard from '@/components/dashboard/KpiCard';
import HourlyChart from '@/components/dashboard/HourlyChart';
import TrendChart from '@/components/dashboard/TrendChart';
import ShiftCellPanel from '@/components/dashboard/ShiftCellPanel';
import HighPerformerPanel from '@/components/dashboard/HighPerformerPanel';
import GoalProjection from '@/components/dashboard/GoalProjection';
import EfficiencyAlert from '@/components/dashboard/EfficiencyAlert';
import GoalProgressPanel from '@/components/dashboard/GoalProgressPanel';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import ExportMenu from '@/components/dashboard/ExportMenu';
import CellReportButton from '@/components/dashboard/CellReportButton';
import { sumBy, groupBy, efficiency, scrapRate, isCritical, highPerformers, projectGoal, detectEfficiencyDrop, monthlyGoalTracking, detectSustainedLowEfficiency, efficiencyTrend } from '@/lib/productionMetrics';
import WeeklyEfficiencyChart from '@/components/dashboard/WeeklyEfficiencyChart';
import WeeklyRankingPanel from '@/components/dashboard/WeeklyRankingPanel';
import { weeklyRanking } from '@/lib/weeklyRanking';
import { useLowEfficiencyAlert } from '@/hooks/useLowEfficiencyAlert';
import LowEfficiencyAlertModal from '@/components/dashboard/LowEfficiencyAlertModal';
import MonthlyGoalTracker from '@/components/dashboard/MonthlyGoalTracker';
import SortablePanels from '@/components/dashboard/SortablePanels';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { usePerformanceAlert } from '@/hooks/usePerformanceAlert';
import { useEfficiencyDropAlert } from '@/hooks/useEfficiencyDropAlert';
import DailyProductionCard from '@/components/dashboard/DailyProductionCard';
import DashboardLayoutSettings from '@/components/dashboard/DashboardLayoutSettings';
import RealtimeCellProgressPanel from '@/components/dashboard/RealtimeCellProgressPanel';
import GeneralLotProgressPanel from '@/components/dashboard/GeneralLotProgressPanel';

const PANEL_IDS = ['realtimeProgress', 'generalLotProgress', 'monthlyTracker', 'dailyProduction', 'charts', 'weeklyRanking', 'effDrop', 'goalProgress', 'goalProjection', 'weeklyTrend', 'highPerformers'];

async function fetchDashboardProductionEntries(referenceDate) {
  const reference = new Date(`${referenceDate}T12:00:00`);
  const rangeStart = new Date(reference.getFullYear(), reference.getMonth(), 1);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const rangeEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const startDate = format(rangeStart, 'yyyy-MM-dd');
  const endDate = format(rangeEnd, 'yyyy-MM-dd');
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('production_entries')
      .select('*')
      .gte('date', startDate)
      .lt('date', endDate)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows.map(row => ({ ...row, created_date: row.created_at }));
}

export default function Dashboard({ kioskModeOverride = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useTheme();
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  async function handleSeed() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const result = await runSeedTestData(10);
      setSeedResult(result);
      // Invalida cache para recarregar os dados
      await queryClient.invalidateQueries();
    } catch (e) {
      setSeedResult({ errors: [e.message] });
    } finally {
      setSeeding(false);
    }
  }

  const [filters, setFilters] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    shift: 'all',
    cell: 'all',
  });

  const { data: all = [] } = useQuery({
    queryKey: ['production', filters.date],
    queryFn: () => fetchDashboardProductionEntries(filters.date),
    initialData: [],
    staleTime: 0,
    refetchOnMount: true,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['dailyGoals'],
    queryFn: () => base44.entities.DailyGoal.list('-date', 200),
    initialData: [],
  });

  const { activeCells } = useCells();
  const validCellNames = useMemo(() => activeCells.map(c => c.name.trim()), [activeCells]);

  const cells = useMemo(() => validCellNames, [validCellNames]);


  const { kiosk: contextKiosk, toggleKiosk } = useKiosk();
  const kiosk = kioskModeOverride || contextKiosk;

  const handleOpenKiosk = async () => {
    try {
      if (isFullscreenSupported()) {
        await enterFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen bloqueado ou falhou:', error);
    }
    navigate('/quiosque');
  };

  const handleExitKiosk = async () => {
    try {
      if (isFullscreenActive()) {
        await exitFullscreen();
      }
    } catch (error) {
      console.warn('Erro ao sair de tela cheia:', error);
    }
    if (kioskModeOverride) {
      navigate('/');
    } else {
      toggleKiosk();
    }
  };

  const [kioskCell, setKioskCell] = useState('all');
  const [rotating, setRotating] = useState(false);

  // Garante uma célula válida selecionada ao entrar no quiosque
  // Inicia com 'all' para mostrar dados consolidados de todas as células
  useEffect(() => {
    if (kiosk && kioskCell !== 'all' && cells.length && !cells.includes(kioskCell)) setKioskCell('all');
    if (!kiosk) { setKioskCell('all'); setRotating(false); }
  }, [kiosk, kioskCell, cells]);


  const activeCell = kiosk && kioskCell !== 'all' ? kioskCell : filters.cell;

  const filtered = useMemo(() => all.filter((e) => {
    const eCell = (e.cell || '').trim();
    if (!validCellNames.includes(eCell)) return false;
    if (filters.date && e.date !== filters.date) return false;
    if (filters.shift !== 'all' && e.shift !== filters.shift) return false;
    if (activeCell !== 'all' && eCell !== activeCell) return false;
    return true;
  }), [all, filters, activeCell, validCellNames]);


  const totalProduced = sumBy(filtered, 'produced');
  const totalTarget = sumBy(filtered, 'target');
  const totalScrap = sumBy(filtered, 'scrap');
  const eff = efficiency(totalProduced, totalTarget);
  const critCount = filtered.filter(isCritical).length;

  const byHour = useMemo(() => groupBy(filtered, 'hour'), [filtered]);
  const byShift = useMemo(() => {
    const grouped = groupBy(filtered, 'shift');
    const result = [...grouped];
    const shifts = ['1º Turno', '2º Turno', '3º Turno'];
    shifts.forEach(shiftName => {
      if (!grouped.some(g => g.key === shiftName)) {
        result.push({ key: shiftName, produced: 0, target: 0, scrap: 0, downtime: 0, count: 0, efficiency: 0, scrapRate: 0 });
      }
    });
    return result;
  }, [filtered]);
  const byCell = useMemo(() => {
    const grouped = groupBy(filtered, 'cell');
    const result = [...grouped];
    cells.forEach(cellName => {
      if (!grouped.some(g => g.key.toLowerCase().trim() === cellName.toLowerCase().trim())) {
        result.push({ key: cellName, produced: 0, target: 0, scrap: 0, downtime: 0, count: 0, efficiency: 0, scrapRate: 0 });
      }
    });
    return result;
  }, [filtered, cells]);
  const performers = useMemo(() => highPerformers(filtered, 95), [filtered]);
  const projection = useMemo(() => projectGoal(filtered, 3), [filtered]);
  const effDrop = useMemo(() => detectEfficiencyDrop(filtered, 3, 10), [filtered]);
  const monthlyTracking = useMemo(() => {
    const validEntries = all.filter(e => validCellNames.includes(e.cell));
    const validGoals = goals.filter(g => validCellNames.includes(g.cell));
    const cellEntries = activeCell === 'all' ? validEntries : validEntries.filter(e => e.cell === activeCell);
    const cellGoals = activeCell === 'all' ? validGoals : validGoals.filter(g => g.cell === activeCell);
    return monthlyGoalTracking(cellEntries, cellGoals);
  }, [all, goals, activeCell, validCellNames]);

  const cellMonthlyTrackings = useMemo(() => {
    if (activeCell !== 'all') return [];
    const cellMap = {};
    all.forEach(e => {
      if (!e.cell) return;
      if (!cellMap[e.cell]) cellMap[e.cell] = { entries: [], goals: [] };
      cellMap[e.cell].entries.push(e);
    });
    goals.forEach(g => {
      if (!g.cell) return;
      if (!cellMap[g.cell]) cellMap[g.cell] = { entries: [], goals: [] };
      cellMap[g.cell].goals.push(g);
    });
    
    const trackings = [];
    for (const [cellName, data] of Object.entries(cellMap)) {
      if (!validCellNames.includes(cellName)) continue;
      const tr = monthlyGoalTracking(data.entries, data.goals);
      if (tr && tr.target > 0) trackings.push({ cell: cellName, ...tr });
    }
    return trackings.sort((a, b) => b.completedPct - a.completedPct);
  }, [all, goals, activeCell, validCellNames]);
  const ranking = useMemo(
    () => weeklyRanking(all.filter(e => validCellNames.includes(e.cell)), goals.filter(g => validCellNames.includes(g.cell)), filters.date ? new Date(filters.date + 'T00:00:00') : new Date()),
    [all, goals, filters.date, validCellNames]
  );

  const weeklyTrend = useMemo(
    () => efficiencyTrend(all.filter(e => validCellNames.includes(e.cell)), filters.cell, 7, filters.date ? new Date(filters.date + 'T00:00:00') : new Date()),
    [all, filters.cell, filters.date, validCellNames]
  );
  const weeklyTrendLabel = filters.cell === 'all' ? 'Todas as células' : filters.cell;

  const goalProgress = useMemo(() => {
    return goals
      .filter((g) => {
        if (!validCellNames.includes(g.cell)) return false;
        if (filters.date && g.date !== filters.date) return false;
        if (filters.shift !== 'all' && g.shift !== filters.shift) return false;
        if (filters.cell !== 'all' && g.cell !== filters.cell) return false;
        return true;
      })
      .map((g) => {
        const produced = filtered
          .filter((e) => e.cell === g.cell && e.shift === g.shift && e.date === g.date)
          .reduce((acc, e) => acc + (Number(e.produced) || 0), 0);
        return { cell: g.cell, shift: g.shift, target: Number(g.target) || 0, produced };
      })
      .filter((it) => it.target > 0);
  }, [goals, filtered, filters, validCellNames]);

  usePerformanceAlert(performers);
  useEfficiencyDropAlert(effDrop);

  // Monitora células com eficiência < 70% por 3h+ seguidas (sobre os dados do dia selecionado)
  const dayEntries = useMemo(
    () => all.filter((e) => !filters.date || e.date === filters.date),
    [all, filters.date]
  );
  const lowEffAlerts = useMemo(
    () => detectSustainedLowEfficiency(dayEntries, 70, 3),
    [dayEntries]
  );
  const lowEff = useLowEfficiencyAlert(lowEffAlerts);

  const chartsRef = useRef(null);
  const { order, hidden, sizes, reorder, toggleHidden, toggleSize } = useDashboardLayout(PANEL_IDS);

  const panels = useMemo(() => [
    { id: 'realtimeProgress', title: 'Produção em Tempo Real', node: <RealtimeCellProgressPanel date={filters.date} kioskCell={kioskCell} filterCell={kiosk ? kioskCell : filters.cell} /> },
    { id: 'generalLotProgress', title: 'Lotes Gerais PCP', node: <GeneralLotProgressPanel /> },
    { id: 'monthlyTracker', title: 'Acompanhamento Mensal', node: <MonthlyGoalTracker tracking={monthlyTracking} cellTrackings={cellMonthlyTrackings} /> },
    { id: 'dailyProduction', title: 'Produção Diária', node: <DailyProductionCard filtered={filtered} kiosk={kiosk} kioskCell={kioskCell} /> },
    { id: 'weeklyRanking', title: 'Ranking Semanal', node: <WeeklyRankingPanel ranking={ranking} /> },
    { id: 'effDrop', title: 'Alerta de Eficiência', node: <EfficiencyAlert alert={effDrop} /> },
    { id: 'goalProgress', title: 'Progresso do Turno', node: <GoalProgressPanel items={goalProgress} /> },
    { id: 'goalProjection', title: 'Projeção de Meta', node: <GoalProjection projection={projection} /> },
    { id: 'weeklyTrend', title: 'Tendência Semanal', node: <WeeklyEfficiencyChart data={weeklyTrend} cellLabel={weeklyTrendLabel} /> },
    { id: 'highPerformers', title: 'Operadores Destaque', node: <HighPerformerPanel performers={performers} /> },
    {
      id: 'charts',
      title: 'Gráficos de Produtividade',
      node: (
        <div ref={chartsRef} className={kiosk ? 'space-y-4 bg-background' : 'space-y-6 bg-background'}>
          <div className={kiosk ? 'grid grid-cols-1 xl:grid-cols-2 gap-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
            <HourlyChart grouped={byHour} />
            <TrendChart grouped={byHour} />
          </div>
          <div className={kiosk ? 'grid grid-cols-1 xl:grid-cols-2 gap-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
            <ShiftCellPanel title="Produtividade por Turno" subtitle="Comparativo entre turnos" grouped={byShift} />
            <ShiftCellPanel title="Produtividade por Célula" subtitle="Comparativo entre células" grouped={byCell} />
          </div>
        </div>
      ),
    },
  ], [filters.date, filters.cell, monthlyTracking, cellMonthlyTrackings, ranking, effDrop, goalProgress, projection, weeklyTrend, weeklyTrendLabel, performers, byHour, byShift, byCell, kiosk, kioskCell, filtered]);

  return (
    <div className={kiosk ? 'p-4 space-y-4' : 'p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6'}>
      <LowEfficiencyAlertModal open={lowEff.open} alerts={lowEff.alerts} onDismiss={lowEff.dismiss} />
      {!kiosk && (
        <>
          <PageHeader
            title={`Painéis de Produtividade`}
            subtitle="Indicadores automáticos por turno, célula e hora."
            icon={LayoutDashboard}
            actions={
              <DashboardFilters filters={filters} setFilters={setFilters} cells={cells} />
            }
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <CellReportButton cells={cells} allEntries={all} date={filters.date} />
            <ExportMenu entries={filtered} allEntries={all} filters={filters} chartsRef={chartsRef} />
            <DashboardLayoutSettings panels={panels} hidden={hidden} sizes={sizes} toggleHidden={toggleHidden} toggleSize={toggleSize} />
            <Button
              variant="outline"
              className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm"
              onClick={handleOpenKiosk}
            >
              <Monitor className="w-4 h-4" /> Modo Quiosque
            </Button>
            <Button
              variant="outline"
              className="gap-2 bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/40 rounded-full shadow-sm"
              onClick={handleSeed}
              disabled={seeding}
              title="Insere 10 dias de dados de produção de teste para validar gráficos"
            >
              <FlaskConical className="w-4 h-4" />
              {seeding ? 'Gerando...' : 'Dados de Teste'}
            </Button>
            {seedResult && (
              <span className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
                seedResult.errors?.length
                  ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400'
                  : 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400'
              }`}>
                {seedResult.errors?.length
                  ? `Erro: ${seedResult.errors[0]}`
                  : `✓ ${seedResult.entries} lançamentos · ${seedResult.occurrences} ocorrências · ${seedResult.goals} metas · ${seedResult.operators} operadores`
                }
              </span>
            )}
          </div>
        </>
      )}
      {kiosk && (
        <div className="bg-card/40 backdrop-blur-md border border-border/40 p-4 sm:p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:shadow-md transition-all duration-300">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
            Painéis{kioskCell !== 'all' ? ` · ${kioskCell}` : ''}
          </h1>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <button
              className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl border border-border/80 bg-card text-muted-foreground hover:text-foreground active:scale-95 transition-all"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Ativar Modo Claro' : 'Ativar Modo Escuro'}
            >
              {theme === 'dark' ? (
                <Sun className="w-4.5 h-4.5 text-amber-400" />
              ) : (
                <Moon className="w-4.5 h-4.5 text-indigo-400" />
              )}
            </button>
            <DashboardLayoutSettings panels={panels} hidden={hidden} sizes={sizes} toggleHidden={toggleHidden} toggleSize={toggleSize} />
            <KioskCellControl cells={cells} active={kioskCell} setActive={setKioskCell} rotating={rotating} setRotating={setRotating} />
            <Button variant="default" className="w-full sm:w-auto gap-2 min-h-[44px]" onClick={handleExitKiosk}>
              <Minimize2 className="w-4 h-4" /> Sair do Quiosque
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard index={0} title="Total Produzido" value={totalProduced.toLocaleString('pt-BR')} icon={Package} accent="accent" sub={`${filtered.length} registros`} />
        <KpiCard index={1} title="Meta Total" value={totalTarget.toLocaleString('pt-BR')} icon={Target} accent="primary" />
        <KpiCard index={2} title="Eficiência" value={eff} unit="%" icon={Gauge} accent={eff >= 90 ? 'accent' : eff >= 70 ? 'warning' : 'danger'} sub={`Refugo ${scrapRate(totalScrap, totalProduced)}%`} />
        <KpiCard index={3} title="Falhas Críticas" value={critCount} icon={AlertTriangle} accent={critCount ? 'danger' : 'accent'} />
      </div>

      <div key="sortable-panels">
        <SortablePanels panels={panels} order={order} sizes={sizes} onReorder={reorder} onToggleHide={toggleHidden} onToggleSize={toggleSize} />
      </div>
    </div>
  );
}

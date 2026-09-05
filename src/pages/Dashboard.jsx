import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Monitor, Minimize2, LayoutDashboard, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

import ExecutiveDashboard from '@/components/reports/ExecutiveDashboard';
import OperationalInsights from '@/components/reports/OperationalInsights';
import { buildOperationalAnalysis, aggregateAnalysis, normalizeAnalysisEntries } from '@/lib/operationalAnalysis';
import { getProductionMetricRule } from '@/lib/productionUnitRules';
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
import HourlyChart from '@/components/dashboard/HourlyChart';
import ShiftCellPanel from '@/components/dashboard/ShiftCellPanel';
import GoalProgressPanel from '@/components/dashboard/GoalProgressPanel';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import ExportMenu from '@/components/dashboard/ExportMenu';
import CellReportButton from '@/components/dashboard/CellReportButton';
import { highPerformers, detectEfficiencyDrop, monthlyGoalTracking, detectSustainedLowEfficiency, efficiencyTrend } from '@/lib/productionMetrics';
import WeeklyEfficiencyChart from '@/components/dashboard/WeeklyEfficiencyChart';
import { useLowEfficiencyAlert } from '@/hooks/useLowEfficiencyAlert';
import LowEfficiencyAlertModal from '@/components/dashboard/LowEfficiencyAlertModal';
import MonthlyGoalTracker from '@/components/dashboard/MonthlyGoalTracker';
import SortablePanels from '@/components/dashboard/SortablePanels';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { usePerformanceAlert } from '@/hooks/usePerformanceAlert';
import { useEfficiencyDropAlert } from '@/hooks/useEfficiencyDropAlert';
import DashboardLayoutSettings from '@/components/dashboard/DashboardLayoutSettings';
import RealtimeCellProgressPanel from '@/components/dashboard/RealtimeCellProgressPanel';
import GeneralLotProgressPanel from '@/components/dashboard/GeneralLotProgressPanel';
import AnnualProductionSummary from '@/components/dashboard/AnnualProductionSummary';
import {
  ANNUAL_FILTER_DISABLED,
  buildDashboardYearOptions,
  isAnnualFilterActive,
  matchesDashboardPeriod,
} from '@/lib/dashboardPeriod';
import {
  fetchDashboardProductionEntries,
  fetchDashboardYearBounds,
} from '@/lib/dashboardData';

const PANEL_IDS = ['insights', 'realtimeProgress', 'generalLotProgress', 'hourly', 'cellChart', 'shiftChart', 'monthlyTracker', 'goalProgress', 'weeklyTrend'];

export default function Dashboard({ kioskModeOverride = false }) {
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();

  const [filters, setFilters] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    year: ANNUAL_FILTER_DISABLED,
    shift: 'all',
    cell: 'all',
  });
  const annualMode = isAnnualFilterActive(filters.year);

  const { data: all = [], isFetching: productionLoading, isError: productionError, dataUpdatedAt } = useQuery({
    queryKey: ['production', 'dashboard', filters.date, filters.year],
    queryFn: () => fetchDashboardProductionEntries(filters.date, filters.year),
    initialData: [],
    initialDataUpdatedAt: 0,
    staleTime: 10_000,
    refetchOnMount: true,
    // Realtime invalida ['production']; o intervalo é apenas contingência.
    refetchInterval: annualMode ? false : 60_000,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['dailyGoals'],
    queryFn: () => base44.entities.DailyGoal.list('-date', 200),
    initialData: [],
  });

  const { data: yearBounds } = useQuery({
    queryKey: ['dashboard-production-year-bounds'],
    queryFn: fetchDashboardYearBounds,
    staleTime: 5 * 60 * 1000,
  });

  const availableYears = useMemo(
    () => buildDashboardYearOptions(yearBounds?.oldestDate, yearBounds?.newestDate),
    [yearBounds],
  );

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
    if (!matchesDashboardPeriod(e.date, filters.date, filters.year)) return false;
    if (filters.shift !== 'all' && e.shift !== filters.shift) return false;
    if (activeCell !== 'all' && eCell !== activeCell) return false;
    return true;
  }), [all, filters, activeCell, validCellNames]);


  const analysis = useMemo(() => buildOperationalAnalysis(filtered), [filtered]);
  const [selectedUnit, setSelectedUnit] = useState('');
  const chartUnits = useMemo(() => {
    const units = new Map(analysis.units.map((unit) => [unit.key, unit]));
    goals.filter((g) => validCellNames.includes(g.cell) && (activeCell === 'all' || g.cell === activeCell)).forEach((goal) => {
      const rule = getProductionMetricRule(goal);
      if (!units.has(rule.unit)) units.set(rule.unit, { key: rule.unit, unitLabel: rule.unitLabel });
    });
    return [...units.values()];
  }, [analysis.units, goals, validCellNames, activeCell]);
  const chartUnit = chartUnits.find((u) => u.key === selectedUnit) || chartUnits[0];
  const chartEntries = useMemo(() => analysis.entries.filter((e) => e.metric_unit === chartUnit?.key), [analysis, chartUnit]);
  const chartHistory = useMemo(() => normalizeAnalysisEntries(all).filter((e) => validCellNames.includes(e.cell)
    && e.metric_unit === chartUnit?.key && (activeCell === 'all' || e.cell === activeCell)
    && (filters.shift === 'all' || e.shift === filters.shift)), [all, validCellNames, chartUnit, activeCell, filters.shift]);
  const byHour = useMemo(() => aggregateAnalysis(chartEntries, (e) => e.hour).map((r) => ({ ...r, efficiency: r.attainment })), [chartEntries]);
  const byShift = useMemo(() => aggregateAnalysis(chartEntries, (e) => e.shift).map((r) => ({ ...r, efficiency: r.attainment })), [chartEntries]);
  const byCell = useMemo(() => aggregateAnalysis(chartEntries, (e) => e.cell).map((r) => ({ ...r, efficiency: r.attainment })), [chartEntries]);
  const performers = useMemo(() => highPerformers(filtered, 95), [filtered]);
  const effDrop = useMemo(() => detectEfficiencyDrop(annualMode ? [] : filtered, 3, 10), [annualMode, filtered]);
  const dashboardReferenceDate = useMemo(
    () => filters.date ? new Date(`${filters.date}T12:00:00`) : new Date(),
    [filters.date],
  );
  const monthlyTracking = useMemo(() => {
    const validEntries = chartHistory;
    const validGoals = goals.filter(g => validCellNames.includes(g.cell) && getProductionMetricRule(g).unit === chartUnit?.key && (filters.shift === 'all' || g.shift === filters.shift));
    const cellEntries = activeCell === 'all' ? validEntries : validEntries.filter(e => e.cell === activeCell);
    const cellGoals = activeCell === 'all' ? validGoals : validGoals.filter(g => g.cell === activeCell);
    return monthlyGoalTracking(cellEntries, cellGoals, dashboardReferenceDate);
  }, [chartHistory, goals, activeCell, validCellNames, dashboardReferenceDate, filters.shift, chartUnit]);

  const cellMonthlyTrackings = useMemo(() => {
    if (activeCell !== 'all') return [];
    const cellMap = {};
    chartHistory.forEach(e => {
      if (!e.cell) return;
      if (!cellMap[e.cell]) cellMap[e.cell] = { entries: [], goals: [] };
      cellMap[e.cell].entries.push(e);
    });
    goals.forEach(g => {
      if (!validCellNames.includes(g.cell) || getProductionMetricRule(g).unit !== chartUnit?.key || (filters.shift !== 'all' && g.shift !== filters.shift)) return;
      if (!cellMap[g.cell]) cellMap[g.cell] = { entries: [], goals: [] };
      cellMap[g.cell].goals.push(g);
    });
    
    const trackings = [];
    for (const [cellName, data] of Object.entries(cellMap)) {
      if (!validCellNames.includes(cellName)) continue;
      const tr = monthlyGoalTracking(data.entries, data.goals, dashboardReferenceDate);
      if (tr && tr.target > 0) trackings.push({ cell: cellName, ...tr });
    }
    return trackings.sort((a, b) => b.completedPct - a.completedPct);
  }, [chartHistory, goals, activeCell, validCellNames, dashboardReferenceDate, filters.shift, chartUnit]);
  const weeklyTrend = useMemo(
    () => efficiencyTrend(chartHistory, activeCell, 7, filters.date ? new Date(filters.date + 'T00:00:00') : new Date()),
    [chartHistory, activeCell, filters.date]
  );
  const weeklyTrendLabel = `${activeCell === 'all' ? 'Todas as células' : activeCell} · ${chartUnit?.unitLabel || ''}`;

  const goalProgress = useMemo(() => {
    if (annualMode) return [];
    return goals
      .filter((g) => {
        if (!validCellNames.includes(g.cell)) return false;
        if (filters.date && g.date !== filters.date) return false;
        if (filters.shift !== 'all' && g.shift !== filters.shift) return false;
        if (activeCell !== 'all' && g.cell !== activeCell) return false;
        if (getProductionMetricRule(g).unit !== chartUnit?.key) return false;
        return true;
      })
      .map((g) => {
        const produced = chartEntries
          .filter((e) => e.cell === g.cell && e.shift === g.shift && e.date === g.date)
          .reduce((acc, e) => acc + (Number(e.produced) || 0), 0);
        return { cell: g.cell, shift: g.shift, target: Number(g.target) || 0, produced };
      })
      .filter((it) => it.target > 0);
  }, [annualMode, goals, chartEntries, filters, activeCell, validCellNames, chartUnit]);

  const alertPerformers = useMemo(() => annualMode ? [] : performers, [annualMode, performers]);
  usePerformanceAlert(alertPerformers);
  useEfficiencyDropAlert(effDrop);

  // Monitora células com eficiência < 70% por 3h+ seguidas (sobre os dados do dia selecionado)
  const dayEntries = useMemo(
    () => annualMode ? [] : all.filter((e) => !filters.date || e.date === filters.date),
    [annualMode, all, filters.date]
  );
  const lowEffAlerts = useMemo(
    () => detectSustainedLowEfficiency(dayEntries, 70, 3),
    [dayEntries]
  );
  const lowEff = useLowEfficiencyAlert(lowEffAlerts);

  const chartsRef = useRef(null);
  const { order, hidden, sizes, reorder, toggleHidden, toggleSize, ready: layoutReady, saving: layoutSaving } = useDashboardLayout(PANEL_IDS);

  const panels = useMemo(() => {
    const result = [{ id: 'insights', title: 'Leitura do período', node: <OperationalInsights analysis={analysis} compact /> }];

    if (!annualMode) {
      result.push({
        id: 'realtimeProgress',
        title: 'Produção em Tempo Real',
        node: <RealtimeCellProgressPanel date={filters.date} kioskCell={kioskCell} filterCell={kiosk ? kioskCell : filters.cell} />,
      });
    }

    result.push({ id: 'generalLotProgress', title: 'Lotes Gerais PCP', node: <GeneralLotProgressPanel /> });
    result.push({
      id: 'monthlyTracker',
      title: annualMode ? `Resumo Anual ${filters.year}` : 'Acompanhamento Mensal',
      node: annualMode
        ? <AnnualProductionSummary unitLabel={chartUnit?.unitLabel} entries={chartEntries} year={filters.year} chartRef={chartsRef} loading={productionLoading} />
        : <MonthlyGoalTracker tracking={monthlyTracking} cellTrackings={cellMonthlyTrackings} />,
    });
    if (!annualMode) {
      result.push(
        { id: 'goalProgress', title: 'Progresso do Turno', node: <GoalProgressPanel items={goalProgress} /> },
        { id: 'weeklyTrend', title: 'Tendência Semanal', node: <WeeklyEfficiencyChart data={weeklyTrend} cellLabel={weeklyTrendLabel} /> },
      );
    }

    if (!annualMode) result.push({ id: 'hourly', title: 'Produção por hora', node: <HourlyChart grouped={byHour} unitLabel={chartUnit?.unitLabel} /> });
    result.push({ id: 'shiftChart', title: 'Comparativo por turno', node: <ShiftCellPanel title="Produção por turno" subtitle={`Mesmo recorte · ${chartUnit?.unitLabel || ''}`} grouped={byShift} unitLabel={chartUnit?.unitLabel} /> });
    result.push({ id: 'cellChart', title: 'Comparativo por célula', node: <ShiftCellPanel title="Produção por célula" subtitle={`Mesmo recorte · ${chartUnit?.unitLabel || ''}`} grouped={byCell} unitLabel={chartUnit?.unitLabel} /> });

    return result;
  }, [annualMode, filters.date, filters.cell, filters.year, monthlyTracking, cellMonthlyTrackings, goalProgress, weeklyTrend, weeklyTrendLabel, performers, byHour, byShift, byCell, kiosk, kioskCell, filtered, productionLoading, analysis, chartEntries, chartUnit]);

  return (
    <div className={kiosk ? 'p-4 space-y-4' : 'p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6'}>
      <LowEfficiencyAlertModal open={lowEff.open} alerts={lowEff.alerts} onDismiss={lowEff.dismiss} />
      {!kiosk && (
        <>
          <PageHeader
            title={`Painéis de Produtividade`}
            subtitle={annualMode
              ? `Resumo consolidado de janeiro a dezembro de ${filters.year}.`
              : 'Indicadores automáticos por turno, célula e hora.'}
            icon={LayoutDashboard}
            actions={
              <DashboardFilters filters={filters} setFilters={setFilters} cells={cells} years={availableYears} />
            }
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <CellReportButton
              cells={cells}
              allEntries={all}
              date={annualMode ? null : filters.date}
              periodLabel={annualMode ? `Ano de ${filters.year}` : ''}
            />
            <ExportMenu entries={filtered} allEntries={all} filters={filters} chartsRef={chartsRef} />
            <DashboardLayoutSettings disabled={!layoutReady} saving={layoutSaving} panels={panels} hidden={hidden} sizes={sizes} toggleHidden={toggleHidden} toggleSize={toggleSize} />
            <Button
              variant="outline"
              className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm"
              onClick={handleOpenKiosk}
            >
              <Monitor className="w-4 h-4" /> Modo Quiosque
            </Button>
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
            <DashboardLayoutSettings disabled={!layoutReady} saving={layoutSaving} panels={panels} hidden={hidden} sizes={sizes} toggleHidden={toggleHidden} toggleSize={toggleSize} />
            <KioskCellControl cells={cells} active={kioskCell} setActive={setKioskCell} rotating={rotating} setRotating={setRotating} />
            <Button variant="default" className="w-full sm:w-auto gap-2 min-h-[44px]" onClick={handleExitKiosk}>
              <Minimize2 className="w-4 h-4" /> Sair do Quiosque
            </Button>
          </div>
        </div>
      )}

      {productionError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível atualizar a produção. Os dados abaixo podem estar desatualizados.</p>}
      <p role="status" className="text-xs text-muted-foreground">{productionLoading ? 'Atualizando indicadores…' : dataUpdatedAt ? `Última consulta: ${new Date(dataUpdatedAt).toLocaleTimeString('pt-BR')}` : 'Aguardando dados de produção.'}</p>
      {dataUpdatedAt > 0 && <ExecutiveDashboard analysis={analysis} />}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-4">
        <span className="text-sm font-medium">Unidade dos gráficos</span>
        {chartUnits.map((unit) => <button type="button" key={unit.key} aria-pressed={unit.key === chartUnit?.key} onClick={() => setSelectedUnit(unit.key)} className={`rounded-full border px-4 py-2 text-sm capitalize ${unit.key === chartUnit?.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>{unit.unitLabel}</button>)}
        <span className="text-xs text-muted-foreground">Arraste os gráficos ou use as setas para reposicionar. Ajuste tamanho e visibilidade em Layout.</span>
      </div>

      <div key="sortable-panels">
        <SortablePanels editable={layoutReady} panels={panels} order={order} sizes={sizes} onReorder={reorder} onToggleHide={toggleHidden} onToggleSize={toggleSize} />
      </div>
    </div>
  );
}

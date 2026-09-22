import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { Monitor, Minimize2, LayoutDashboard, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

import ExecutiveDashboard from '@/components/reports/ExecutiveDashboard';
import OperationalInsights from '@/components/reports/OperationalInsights';
import { aggregateAnalysis } from '@/lib/operationalAnalysis';
import { buildDashboardGoalAnalysis, aggregateGoalBuckets } from '@/lib/dashboardGoalAnalysis';
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
import { detectEfficiencyDrop, detectSustainedLowEfficiency } from '@/lib/productionMetrics';
import WeeklyEfficiencyChart from '@/components/dashboard/WeeklyEfficiencyChart';
import { useLowEfficiencyAlert } from '@/hooks/useLowEfficiencyAlert';
import LowEfficiencyAlertModal from '@/components/dashboard/LowEfficiencyAlertModal';
import GoalPeriodSummary from '@/components/dashboard/GoalPeriodSummary';
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
  getDashboardPeriodRange,
} from '@/lib/dashboardPeriod';
import {
  fetchDashboardProductionEntries,
  fetchDashboardYearBounds,
  fetchDashboardGoalContext,
} from '@/lib/dashboardData';

const PANEL_IDS = ['generalLotProgress', 'hourly', 'cellChart', 'shiftChart', 'weeklyTrend', 'insights', 'realtimeProgress', 'monthlyTracker', 'goalProgress'];

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

  const { data: all = [], isFetching: productionLoading, isError: productionError, dataUpdatedAt, refetch: refetchProduction } = useQuery({
    queryKey: ['production', 'dashboard', filters.date, filters.year],
    queryFn: () => fetchDashboardProductionEntries(filters.date, filters.year),
    initialData: [],
    initialDataUpdatedAt: 0,
    staleTime: 10_000,
    refetchOnMount: true,
    // Realtime invalida ['production']; o intervalo é apenas contingência.
    refetchInterval: annualMode ? false : 60_000,
  });

  const { data: goalData, isFetching: goalsLoading, isError: goalsError,
    dataUpdatedAt: goalsUpdatedAt, refetch: refetchGoals } = useQuery({
    queryKey: ['dailyGoals', 'dashboard', filters.date, filters.year],
    queryFn: () => fetchDashboardGoalContext(filters.date, filters.year),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchInterval: 60_000,
  });
  const goals = goalData?.goals || [];
  const calendar = goalData?.calendar || [];
  const analysisStatus = productionError || goalsError ? 'error'
    : !dataUpdatedAt || !goalsUpdatedAt ? 'loading' : 'ready';

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


  const activeCell = kiosk ? kioskCell : filters.cell;

  const [selectedUnit, setSelectedUnit] = useState('');
  const setKioskFilterCell = useCallback((cell) => { setKioskCell(cell); setSelectedUnit(''); }, []);
  const period = useMemo(() => ({
    from: annualMode ? `${filters.year}-01-01` : filters.date,
    to: annualMode ? `${filters.year}-12-31` : filters.date,
  }), [annualMode, filters.year, filters.date]);
  const scopeFilters = useMemo(() => ({ ...filters, cell: activeCell }), [filters, activeCell]);
  const allUnitAnalysis = useMemo(() => buildDashboardGoalAnalysis(all, goals, {
    period, filters: scopeFilters, validCells: validCellNames, calendar, status: analysisStatus,
  }), [all, goals, calendar, period, scopeFilters, validCellNames, analysisStatus]);
  const chartUnits = useMemo(() => {
    const result = allUnitAnalysis.units.map((u) => ({ key: u.key, unitLabel: u.unitLabel }));
    if (selectedUnit && !result.some((u) => u.key === selectedUnit)) result.push({ key: selectedUnit, unitLabel: ({ pieces: 'peças', sheets: 'chapas', meters: 'metros', covers: 'capas' })[selectedUnit] });
    return result;
  }, [allUnitAnalysis, selectedUnit]);
  const chartUnit = chartUnits.find((u) => u.key === selectedUnit) || chartUnits[0];
  const goalContext = useMemo(() => ({ goals, calendar, validCells: validCellNames, status: analysisStatus }), [goals, calendar, validCellNames, analysisStatus]);
  const analysis = useMemo(() => buildDashboardGoalAnalysis(all, goals, {
    ...goalContext, period, filters: { ...scopeFilters, metric_unit: chartUnit?.key },
  }), [all, goals, goalContext, period, scopeFilters, chartUnit?.key]);
  const chartEntries = analysis.entries;
  const selectedLotIds = useMemo(() => [...new Set(chartEntries.map((entry) => entry.lot_id).filter(Boolean))].sort(), [chartEntries]);
  // No fabricated hourly target: the registry defines whole-shift goals.
  const byHour = useMemo(() => aggregateAnalysis(chartEntries, (e) => e.hour)
    .map((r) => ({ ...r, target: null, efficiency: null })), [chartEntries]);
  const byShift = useMemo(() => aggregateGoalBuckets(analysis.goalBuckets, (e) => e.shift)
    .map((r) => ({ ...r, efficiency: r.attainment })), [analysis]);
  const byCell = useMemo(() => analysis.cells.map((r) => ({ ...r, key: r.cell, efficiency: r.attainment })), [analysis]);
  const performers = useMemo(() => analysisStatus !== 'ready' ? [] : analysis.cells
    .filter((c) => c.attainment != null && c.attainment >= 100)
    .map((c) => ({ ...c, key: `${c.cell} · ${c.unitLabel}`, efficiency: Math.round(c.attainment) })), [analysis, analysisStatus]);
  const explicitHourlyEntries = useMemo(() => chartEntries.filter((e) => !e.client_event_id && !e._reportedUnit && e.target > 0), [chartEntries]);
  const effDrop = useMemo(() => detectEfficiencyDrop(annualMode || analysisStatus !== 'ready' ? [] : explicitHourlyEntries, 3, 10), [annualMode, analysisStatus, explicitHourlyEntries]);
  const historyAnalysis = useMemo(() => buildDashboardGoalAnalysis(all, goals, {
    ...goalContext, period: { from: getDashboardPeriodRange(filters.date, filters.year).startDate, to: period.to },
    filters: { ...scopeFilters, metric_unit: chartUnit?.key },
  }), [all, goals, goalContext, filters.date, filters.year, period.to, scopeFilters, chartUnit?.key]);
  const monthAnalysis = useMemo(() => buildDashboardGoalAnalysis(all, goals, {
    ...goalContext, period: { from: period.from.slice(0, 7) + '-01', to: period.to },
    filters: { ...scopeFilters, metric_unit: chartUnit?.key },
  }), [all, goals, goalContext, period, scopeFilters, chartUnit?.key]);
  const weeklyTrend = useMemo(() => {
    const groups = aggregateGoalBuckets(historyAnalysis.goalBuckets, (b) => b.date);
    return Array.from({ length: 7 }, (_, i) => {
      const date = format(subDays(new Date(`${filters.date}T12:00:00`), 6 - i), 'yyyy-MM-dd');
      const group = groups.find((g) => g.key === date);
      return { date, label: date.slice(8) + '/' + date.slice(5, 7), produced: group?.produced ?? null,
        target: group?.target ?? null, efficiency: group?.attainment ?? null };
    });
  }, [historyAnalysis, filters.date]);
  const weeklyTrendLabel = `${activeCell === 'all' ? 'Todas as células' : activeCell} · ${chartUnit?.unitLabel || ''} · metas vigentes`;
  const goalProgress = useMemo(() => annualMode ? [] : analysis.goalBuckets
    .filter((b) => b.target > 0 && !b.measurementPending && !b.unavailable), [annualMode, analysis]);

  const alertPerformers = useMemo(() => annualMode ? [] : performers, [annualMode, performers]);
  usePerformanceAlert(alertPerformers);
  useEfficiencyDropAlert(effDrop);

  // Monitora células com eficiência < 70% por 3h+ seguidas (sobre os dados do dia selecionado)
  const dayEntries = useMemo(
    () => annualMode || analysisStatus !== 'ready' ? [] : explicitHourlyEntries,
    [annualMode, analysisStatus, explicitHourlyEntries]
  );
  const lowEffAlerts = useMemo(
    () => detectSustainedLowEfficiency(dayEntries, 70, 3),
    [dayEntries]
  );
  const lowEff = useLowEfficiencyAlert(lowEffAlerts);

  const chartsRef = useRef(null);
  const { order, hidden, sizes, reorder, toggleHidden, toggleSize, ready: layoutReady, saving: layoutSaving } = useDashboardLayout(PANEL_IDS);

  const panels = useMemo(() => {
    const result = [
      { id: 'generalLotProgress', title: 'Lotes Gerais PCP', node: <GeneralLotProgressPanel lotIds={selectedLotIds} /> },
    ];

    if (!annualMode) {
      result.push(
        { id: 'hourly', title: 'Produção por hora', node: <HourlyChart grouped={byHour} unitLabel={chartUnit?.unitLabel} subtitle="Volume por hora · a meta do turno não é rateada sem programação horária" /> },
        { id: 'cellChart', title: 'Comparativo por célula', node: <ShiftCellPanel title="Produção por célula" subtitle={`Mesmo recorte · ${chartUnit?.unitLabel || ''}`} grouped={byCell} unitLabel={chartUnit?.unitLabel} /> },
        { id: 'shiftChart', title: 'Comparativo por turno', node: <ShiftCellPanel title="Produção por turno" subtitle={`Mesmo recorte · ${chartUnit?.unitLabel || ''}`} grouped={byShift} unitLabel={chartUnit?.unitLabel} /> },
        { id: 'weeklyTrend', title: 'Tendência Semanal', node: <WeeklyEfficiencyChart data={weeklyTrend} cellLabel={weeklyTrendLabel} /> },
      );
    } else {
      result.push(
        { id: 'cellChart', title: 'Comparativo por célula', node: <ShiftCellPanel title="Produção por célula" subtitle={`Mesmo recorte · ${chartUnit?.unitLabel || ''}`} grouped={byCell} unitLabel={chartUnit?.unitLabel} /> },
        { id: 'shiftChart', title: 'Comparativo por turno', node: <ShiftCellPanel title="Produção por turno" subtitle={`Mesmo recorte · ${chartUnit?.unitLabel || ''}`} grouped={byShift} unitLabel={chartUnit?.unitLabel} /> },
      );
    }

    result.push({ id: 'insights', title: 'Leitura do período', node: <OperationalInsights analysis={analysis} compact /> });

    if (!annualMode) {
      result.push({
        id: 'realtimeProgress',
        title: 'Avanço da meta por célula',
        node: <RealtimeCellProgressPanel analysis={analysis} date={filters.date} shift={filters.shift} loading={productionLoading} />,
      });
    }

    result.push({
      id: 'monthlyTracker',
      title: annualMode ? `Resumo Anual ${filters.year}` : 'Acompanhamento Mensal',
      node: annualMode
        ? <AnnualProductionSummary unitLabel={chartUnit?.unitLabel} entries={chartEntries} analysis={analysis} year={filters.year} chartRef={chartsRef} loading={productionLoading} />
        : <GoalPeriodSummary analysis={monthAnalysis} title="Acumulado do mês até a data selecionada" />,
    });

    if (!annualMode) {
      result.push({ id: 'goalProgress', title: 'Progresso do Turno', node: <GoalProgressPanel items={goalProgress} /> });
    }

    return result;
  }, [annualMode, filters.date, filters.cell, filters.year, monthAnalysis, goalProgress, weeklyTrend, weeklyTrendLabel, performers, byHour, byShift, byCell, kiosk, kioskCell, productionLoading, analysis, chartEntries, chartUnit, filters.shift, selectedLotIds]);

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
              <DashboardFilters filters={filters} setFilters={(update) => { const next = typeof update === 'function' ? update(filters) : update; if (next.cell !== filters.cell) setSelectedUnit(''); setFilters(next); }} cells={cells} years={availableYears} />
            }
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <CellReportButton
              cells={cells}
              allEntries={all}
              goalContext={{ ...goalContext, period, filters: { ...scopeFilters, metric_unit: chartUnit?.key } }}
              date={annualMode ? null : filters.date}
              periodLabel={annualMode ? `Ano de ${filters.year}` : ''}
            />
            <ExportMenu entries={chartEntries} allEntries={all} goalContext={goalContext} filters={{ ...filters, cell: activeCell, metric_unit: chartUnit?.key }} chartsRef={chartsRef} />
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
            <KioskCellControl cells={cells} active={kioskCell} setActive={setKioskFilterCell} rotating={rotating} setRotating={setRotating} />
            <Button variant="default" className="w-full sm:w-auto gap-2 min-h-[44px]" onClick={handleExitKiosk}>
              <Minimize2 className="w-4 h-4" /> Sair do Quiosque
            </Button>
          </div>
        </div>
      )}

      {productionError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não foi possível atualizar a produção. Os dados abaixo podem estar desatualizados.</p>}
      {goalsError && <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">Não foi possível confirmar as metas ou o calendário. Isso não significa que não há metas cadastradas. Os percentuais estão suspensos.</div>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-muted-foreground">{productionLoading ? 'Atualizando indicadores…' : dataUpdatedAt ? `Última consulta: ${new Date(dataUpdatedAt).toLocaleTimeString('pt-BR')}` : 'Aguardando dados de produção.'} {goalsLoading ? 'Consultando metas…' : goalsUpdatedAt ? `Metas consultadas: ${new Date(goalsUpdatedAt).toLocaleTimeString('pt-BR')}` : 'Aguardando metas.'}</p><Button variant="outline" size="sm" disabled={productionLoading || goalsLoading} onClick={() => Promise.all([refetchProduction(), refetchGoals()])}>Atualizar produção e metas</Button></div>
      {dataUpdatedAt > 0 && <ExecutiveDashboard analysis={analysis} />}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-4">
        <span className="text-sm font-medium">Unidade dos indicadores e gráficos</span>
        {chartUnits.map((unit) => <button type="button" key={unit.key} aria-pressed={unit.key === chartUnit?.key} onClick={() => setSelectedUnit(unit.key)} className={`rounded-full border px-4 py-2 text-sm capitalize ${unit.key === chartUnit?.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>{unit.unitLabel}</button>)}
        <span className="text-xs text-muted-foreground">Arraste os gráficos ou use as setas para reposicionar. Ajuste tamanho e visibilidade em Layout.</span>
      </div>

      <div key="sortable-panels">
        <SortablePanels editable={layoutReady} panels={panels} order={order} sizes={sizes} onReorder={reorder} onToggleHide={toggleHidden} onToggleSize={toggleSize} />
      </div>
    </div>
  );
}

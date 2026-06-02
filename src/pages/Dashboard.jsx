import { useState, useMemo, useRef, useEffect } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Package, Target, Gauge, AlertTriangle, Monitor, Minimize2, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import { useKiosk } from '@/lib/KioskContext';
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

const PANEL_IDS = ['monthlyTracker', 'charts', 'weeklyRanking', 'effDrop', 'goalProgress', 'goalProjection', 'weeklyTrend', 'highPerformers'];

export default function Dashboard() {
  const [filters, setFilters] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    shift: 'all',
    cell: 'all',
  });

  const { data: all = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 500),
    initialData: [],
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['dailyGoals'],
    queryFn: () => base44.entities.DailyGoal.list('-date', 200),
    initialData: [],
  });

  const cells = useMemo(() => [...new Set(all.map((e) => e.cell).filter(Boolean))], [all]);

  const { kiosk, toggleKiosk } = useKiosk();
  const [kioskCell, setKioskCell] = useState('all');
  const [rotating, setRotating] = useState(false);

  // Garante uma célula válida selecionada ao entrar no quiosque
  useEffect(() => {
    if (kiosk && cells.length && !cells.includes(kioskCell)) setKioskCell(cells[0]);
    if (!kiosk) { setKioskCell('all'); setRotating(false); }
  }, [kiosk, cells]);  

  const filtered = useMemo(() => all.filter((e) => {
    if (filters.date && e.date !== filters.date) return false;
    if (filters.shift !== 'all' && e.shift !== filters.shift) return false;
    if (filters.cell !== 'all' && e.cell !== filters.cell) return false;
    if (kiosk && kioskCell !== 'all' && e.cell !== kioskCell) return false;
    return true;
  }), [all, filters, kiosk, kioskCell]);

  const totalProduced = sumBy(filtered, 'produced');
  const totalTarget = sumBy(filtered, 'target');
  const totalScrap = sumBy(filtered, 'scrap');
  const eff = efficiency(totalProduced, totalTarget);
  const critCount = filtered.filter(isCritical).length;

  const byHour = groupBy(filtered, 'hour');
  const byShift = groupBy(filtered, 'shift');
  const byCell = groupBy(filtered, 'cell');
  const performers = useMemo(() => highPerformers(filtered, 95), [filtered]);
  const projection = useMemo(() => projectGoal(filtered, 3), [filtered]);
  const effDrop = useMemo(() => detectEfficiencyDrop(filtered, 3, 10), [filtered]);
  const monthlyTracking = useMemo(() => monthlyGoalTracking(all, goals), [all, goals]);
  const ranking = useMemo(
    () => weeklyRanking(all, goals, filters.date ? new Date(filters.date + 'T00:00:00') : new Date()),
    [all, goals, filters.date]
  );

  const weeklyTrend = useMemo(
    () => efficiencyTrend(all, filters.cell, 7, filters.date ? new Date(filters.date + 'T00:00:00') : new Date()),
    [all, filters.cell, filters.date]
  );
  const weeklyTrendLabel = filters.cell === 'all' ? 'Todas as células' : filters.cell;

  const goalProgress = useMemo(() => {
    return goals
      .filter((g) => {
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
  }, [goals, filtered, filters]);

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
  const { order, reorder } = useDashboardLayout(PANEL_IDS);

  const panels = useMemo(() => [
    { id: 'monthlyTracker', node: <MonthlyGoalTracker tracking={monthlyTracking} /> },
    { id: 'weeklyRanking', node: <WeeklyRankingPanel ranking={ranking} /> },
    { id: 'effDrop', node: <EfficiencyAlert alert={effDrop} /> },
    { id: 'goalProgress', node: <GoalProgressPanel items={goalProgress} /> },
    { id: 'goalProjection', node: <GoalProjection projection={projection} /> },
    { id: 'weeklyTrend', node: <WeeklyEfficiencyChart data={weeklyTrend} cellLabel={weeklyTrendLabel} /> },
    { id: 'highPerformers', node: <HighPerformerPanel performers={performers} /> },
    {
      id: 'charts',
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
  ], [monthlyTracking, ranking, effDrop, goalProgress, projection, weeklyTrend, weeklyTrendLabel, performers, byHour, byShift, byCell, kiosk]);

  return (
    <div className={kiosk ? 'p-4 space-y-4' : 'p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6'}>
      <LowEfficiencyAlertModal open={lowEff.open} alerts={lowEff.alerts} onDismiss={lowEff.dismiss} />
      {!kiosk && (
        <PageHeader
          title={`Painéis de Produtividade`}
          subtitle="Indicadores automáticos por turno, célula e hora."
          icon={LayoutDashboard}
          actions={
            <>
              <DashboardFilters filters={filters} setFilters={setFilters} cells={cells} />
              <CellReportButton cells={cells} allEntries={all} date={filters.date} />
              <ExportMenu entries={filtered} allEntries={all} filters={filters} chartsRef={chartsRef} />
              <Button variant="outline" className="gap-2 min-h-[44px] md:min-h-[40px] bg-white/10 border-white/20 text-white hover:bg-white/20" onClick={toggleKiosk}>
                <Monitor className="w-4 h-4" /> Modo Quiosque
              </Button>
            </>
          }
        />
      )}
      {kiosk && (
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl font-extrabold text-foreground">
            Painéis{kioskCell !== 'all' ? ` · ${kioskCell}` : ''}
          </h1>
          <div className="flex items-center gap-3">
            <KioskCellControl cells={cells} active={kioskCell} setActive={setKioskCell} rotating={rotating} setRotating={setRotating} />
            <Button variant="default" className="gap-2 min-h-[44px]" onClick={toggleKiosk}>
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

      {filtered.length === 0 ? (
        <div key="no-data" className="space-y-6">
          <MonthlyGoalTracker tracking={monthlyTracking} />
          <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
            Nenhum dado para os filtros selecionados. Registre produção na aba "Entrada de Produção".
          </div>
        </div>
      ) : kiosk ? (
        <div key="kiosk" className="space-y-4">
          {order.map((id) => {
            const p = panels.find((x) => x.id === id);
            return p ? <div key={id}>{p.node}</div> : null;
          })}
        </div>
      ) : (
        <div key="sortable-panels">
          <SortablePanels panels={panels} order={order} onReorder={reorder} gap="space-y-6" />
        </div>
      )}
    </div>
  );
}
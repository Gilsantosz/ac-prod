import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Download, Gauge, LineChart, ScanLine, Target, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { monthlySeries, monthlyByCell, monthOverMonth, seasonalityAlerts, executiveSummary, nextMonthProjection, cellBenchmark } from '@/lib/reportMetrics';
import { exportProductionCsv } from '@/lib/exportReports';
import { useCells } from '@/hooks/useCells';
import { seriesByCell } from '@/lib/trendMetrics';
import ExecutiveDashboard from '@/components/reports/ExecutiveDashboard';
import NextMonthForecast from '@/components/reports/NextMonthForecast';
import CellBenchmark from '@/components/reports/CellBenchmark';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import SeasonalityAlerts from '@/components/reports/SeasonalityAlerts';
import MonthSummary from '@/components/reports/MonthSummary';
import MonthlyTrendChart from '@/components/reports/MonthlyTrendChart';
import CellTrendChart from '@/components/reports/CellTrendChart';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TraceabilityReadingsReport from '@/components/reports/TraceabilityReadingsReport';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import TrendLineChart from '@/components/trend/TrendLineChart';
import TrendSummaryCards from '@/components/trend/TrendSummaryCards';
import ExportTrendButton from '@/components/trend/ExportTrendButton';

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState({ from: '', to: '' });
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const reportRef = useRef(null);
  const { getCell } = useCells();
  const requestedTab = searchParams.get('tab');
  const activeTab = ['production', 'traceability', 'trend'].includes(requestedTab) ? requestedTab : 'production';

  const { data: all = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 2000),
    initialData: [],
  });

  const filtered = useMemo(() => all.filter((e) => {
    if (range.from && e.date < range.from) return false;
    if (range.to && e.date > range.to) return false;
    return true;
  }), [all, range]);

  const series = useMemo(() => monthlySeries(filtered), [filtered]);
  const byCell = useMemo(() => monthlyByCell(filtered), [filtered]);
  const mom = useMemo(() => monthOverMonth(series), [series]);
  const alerts = useMemo(() => seasonalityAlerts(filtered, 15), [filtered]);
  const summary = useMemo(() => executiveSummary(filtered), [filtered]);
  const forecast = useMemo(() => nextMonthProjection(series), [series]);
  const benchmark = useMemo(() => cellBenchmark(filtered), [filtered]);
  const monthEntries = useMemo(
    () => all.filter((e) => e.date && e.date.slice(0, 7) === month),
    [all, month]
  );
  const byCellTrend = useMemo(() => seriesByCell(monthEntries, month, getCell), [monthEntries, month, getCell]);
  const trendCells = useMemo(() => byCellTrend.map((c) => c.cell), [byCellTrend]);

  const buildTrendPivot = (key) => {
    if (!byCellTrend.length) return [];
    const days = byCellTrend[0].series.map((p) => p.day);
    return days.map((day, idx) => {
      const row = { day };
      byCellTrend.forEach(({ cell, series: cellSeries }) => {
        row[cell] = cellSeries[idx]?.[key] ?? null;
      });
      return row;
    });
  };

  const oeeTrendData = useMemo(() => buildTrendPivot('oee'), [byCellTrend]);
  const prodTrendData = useMemo(() => buildTrendPivot('productivity'), [byCellTrend]);

  const handleExport = () => {
    if (!filtered.length) {
      toast.error('Nenhum dado para exportar no período selecionado');
      return;
    }
    exportProductionCsv(filtered);
    toast.success('CSV exportado');
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Relatórios Analíticos"
        subtitle="Produtividade mês a mês e histórico de performance das células."
        icon={LineChart}
        actions={
          <Button variant="outline" className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm" onClick={handleExport}>
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        }
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => setSearchParams(value === 'production' ? {} : { tab: value }, { replace: true })}
        className="space-y-5"
      >
        <TabsList className="h-auto p-1 bg-card border border-border rounded-md">
          <TabsTrigger value="production" className="h-9 gap-2"><LineChart className="w-4 h-4" /> Produção</TabsTrigger>
          <TabsTrigger value="traceability" className="h-9 gap-2"><ScanLine className="w-4 h-4" /> Rastreabilidade</TabsTrigger>
          <TabsTrigger value="trend" className="h-9 gap-2"><TrendingUp className="w-4 h-4" /> Tendência</TabsTrigger>
        </TabsList>
        <TabsContent value="production" className="space-y-5">
          <DateRangeFilter range={range} setRange={setRange} />
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">Nenhum dado de produção para o período selecionado.</div>
          ) : (
            <>
              <ExecutiveDashboard summary={summary} />
              <SeasonalityAlerts alerts={alerts} />
              <MonthSummary mom={mom} />
              <MonthlyTrendChart series={series} />
              <NextMonthForecast forecast={forecast} />
              <CellBenchmark benchmark={benchmark} />
              <CellTrendChart cells={byCell.cells} rows={byCell.rows} />
            </>
          )}
        </TabsContent>
        <TabsContent value="traceability"><TraceabilityReadingsReport /></TabsContent>
        <TabsContent value="trend" className="space-y-5">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-2.5 w-full sm:w-auto">
            <div className="space-y-1.5 w-full sm:w-48 shrink-0">
              <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider leading-none">Mês</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full bg-card border-border/80 text-foreground rounded-full pl-4 pr-10 shadow-sm [color-scheme:light] dark:[color-scheme:dark]" />
            </div>
            <div className="w-full sm:w-auto shrink-0 flex">
              <ExportTrendButton month={month} targetRef={reportRef} disabled={monthEntries.length === 0} />
            </div>
          </div>

          {monthEntries.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
              Nenhum dado de produção para o mês selecionado.
            </div>
          ) : (
            <div ref={reportRef} className="space-y-6 bg-background">
              <TrendSummaryCards byCell={byCellTrend} />
              <TrendLineChart title="Evolução do OEE (%)" icon={Gauge} data={oeeTrendData} cells={trendCells} unit="%" />
              <TrendLineChart title="Evolução da Produtividade (%)" icon={Target} data={prodTrendData} cells={trendCells} unit="%" />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

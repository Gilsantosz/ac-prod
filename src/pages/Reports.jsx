import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gauge, LineChart, Target, TrendingUp } from 'lucide-react';
import { endOfMonth, format, parseISO } from 'date-fns';
import { useCells } from '@/hooks/useCells';
import { seriesByCell } from '@/lib/trendMetrics';
import { useAuth } from '@/lib/AuthContext';
import { fetchProductionReportSnapshot } from '@/lib/reports/productionReportData';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { formatDatePtBr, getDefaultReportPeriod } from '@/lib/reports/reportDataUtils';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import TrendLineChart from '@/components/trend/TrendLineChart';
import TrendSummaryCards from '@/components/trend/TrendSummaryCards';
import ExportTrendButton from '@/components/trend/ExportTrendButton';
import ExportReportMenu from '@/components/reports/ExportReportMenu';

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState(() => getDefaultReportPeriod());
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const reportRef = useRef(null);
  const { getCell } = useCells();
  const { user } = useAuth();
  const requestedTab = searchParams.get('tab');
  const activeTab = ['production', 'trend'].includes(requestedTab) ? requestedTab : 'production';
  const validRange = Boolean(range.from && range.to && range.from <= range.to);

  const productionQuery = useQuery({
    queryKey: ['report', 'production-analysis', range.from, range.to, 'all-cells', 'all-shifts'],
    queryFn: () => fetchProductionReportSnapshot({ period: range, filters: { cell: 'all', shift: 'all' } }),
    enabled: activeTab === 'production' && validRange,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const productionReport = useMemo(() => productionQuery.data
    ? createProductionAnalysisReport(productionQuery.data, { generatedBy: user?.name || user?.email || '' })
    : null, [productionQuery.data, user?.email, user?.name]);
  const filtered = productionQuery.data?.entries || [];
  const analysis = productionReport?.metadata?.analysis || {};
  const { series = [], byCell = { cells: [], rows: [] }, mom = null, alerts = [], summary = null, forecast = null, benchmark = { labels: [], months: [], byCell: {}, cells: [] } } = analysis;

  const trendPeriod = useMemo(() => {
    const from = `${month}-01`;
    return { from, to: format(endOfMonth(parseISO(from)), 'yyyy-MM-dd') };
  }, [month]);
  const trendQuery = useQuery({
    queryKey: ['report', 'production-trend', trendPeriod.from, trendPeriod.to],
    queryFn: () => fetchProductionReportSnapshot({ period: trendPeriod, includeComparison: false }),
    enabled: activeTab === 'trend',
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const monthEntries = trendQuery.data?.entries || [];
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

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Relatórios Analíticos"
        subtitle="Produtividade mês a mês e histórico de performance das células."
        icon={LineChart}
        actions={<ExportReportMenu report={productionReport} disabled={!filtered.length || productionQuery.isFetching} />}
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => setSearchParams(value === 'production' ? {} : { tab: value }, { replace: true })}
        className="space-y-5"
      >
        <TabsList className="h-auto p-1 bg-card border border-border rounded-md">
          <TabsTrigger value="production" className="h-9 gap-2"><LineChart className="w-4 h-4" /> Produção</TabsTrigger>
          <TabsTrigger value="trend" className="h-9 gap-2"><TrendingUp className="w-4 h-4" /> Tendência</TabsTrigger>
        </TabsList>
        <TabsContent value="production" className="space-y-5">
          <DateRangeFilter range={range} setRange={setRange} />
          {productionQuery.data?.comparisonPeriod && (
            <p className="text-xs text-muted-foreground px-1">
              Comparação automática: {formatDatePtBr(productionQuery.data.comparisonPeriod.from)} a {formatDatePtBr(productionQuery.data.comparisonPeriod.to)} · snapshot de {filtered.length.toLocaleString('pt-BR')} registro(s).
            </p>
          )}
          {!validRange ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">Informe um período válido para gerar a análise.</div>
          ) : productionQuery.isLoading ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">Carregando o snapshot completo do período...</div>
          ) : productionQuery.isError ? (
            <div className="text-center py-20 text-destructive border border-dashed border-destructive/40 rounded-2xl">Não foi possível carregar o relatório: {productionQuery.error?.message}</div>
          ) : filtered.length === 0 ? (
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

          {trendQuery.isLoading ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">Carregando tendência do mês...</div>
          ) : trendQuery.isError ? (
            <div className="text-center py-20 text-destructive border border-dashed border-destructive/40 rounded-2xl">Não foi possível carregar a tendência: {trendQuery.error?.message}</div>
          ) : monthEntries.length === 0 ? (
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

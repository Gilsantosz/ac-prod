import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gauge, LineChart, Target, TrendingUp, RefreshCw } from 'lucide-react';
import { endOfMonth, format, parseISO } from 'date-fns';
import { useCells } from '@/hooks/useCells';
import { seriesByCell } from '@/lib/trendMetrics';
import { useAuth } from '@/lib/AuthContext';
import { fetchProductionReportSnapshot } from '@/lib/reports/productionReportData';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { formatDatePtBr, getDefaultReportPeriod } from '@/lib/reports/reportDataUtils';
import ExecutiveDashboard from '@/components/reports/ExecutiveDashboard';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import OperationalInsights from '@/components/reports/OperationalInsights';
import ProductionAnalysisCharts from '@/components/reports/ProductionAnalysisCharts';
import { Button } from '@/components/ui/button';
import { normalizeAnalysisEntries } from '@/lib/operationalAnalysis';
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
  const { getCell, activeCells = [] } = useCells();
  const [cell, setCell] = useState('all');
  const [shift, setShift] = useState('all');
  const { user } = useAuth();
  const requestedTab = searchParams.get('tab');
  const activeTab = ['production', 'trend'].includes(requestedTab) ? requestedTab : 'production';
  const validRange = Boolean(range.from && range.to && range.from <= range.to);

  const productionQuery = useQuery({
    queryKey: ['report', 'production-analysis', range.from, range.to, cell, shift],
    queryFn: () => fetchProductionReportSnapshot({ period: range, filters: { cell, shift } }),
    enabled: activeTab === 'production' && validRange,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const productionReport = useMemo(() => productionQuery.data
    ? createProductionAnalysisReport(productionQuery.data, { generatedBy: user?.name || user?.email || '' })
    : null, [productionQuery.data, user?.email, user?.name]);
  const filtered = productionReport?.metadata?.analysis?.entries || [];
  const analysis = productionReport?.metadata?.analysis || {};

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
  const monthEntries = useMemo(() => normalizeAnalysisEntries(trendQuery.data?.entries || []), [trendQuery.data]);
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
        subtitle="Resultados por unidade, prioridades de investigação e evolução da produção."
        icon={LineChart}
        actions={activeTab === 'production' ? <ExportReportMenu report={productionReport} disabled={!validRange || !filtered.length || productionQuery.isFetching || productionQuery.isError} /> : null}
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
          <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-4">
            <DateRangeFilter range={range} setRange={setRange} />
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-muted-foreground space-y-1 min-w-0 flex-1 sm:flex-none">Célula<select aria-label="Célula do relatório" value={cell} onChange={(e) => setCell(e.target.value)} className="block w-full sm:w-52 h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"><option value="all">Todas as células</option>{activeCells.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}</select></label>
              <label className="text-xs font-medium text-muted-foreground space-y-1">Turno<select aria-label="Turno do relatório" value={shift} onChange={(e) => setShift(e.target.value)} className="block h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"><option value="all">Todos os turnos</option>{['1º Turno', '2º Turno', '3º Turno'].map((t) => <option key={t}>{t}</option>)}</select></label>
              <Button variant="outline" disabled={!validRange || productionQuery.isFetching} onClick={() => productionQuery.refetch()} className="gap-2"><RefreshCw className={`h-4 w-4 ${productionQuery.isFetching ? 'animate-spin' : ''}`} />Atualizar análise</Button>
            </div>
          </div>
          {productionQuery.data?.comparisonPeriod && (
            <p className="text-xs text-muted-foreground px-1">
              Comparação automática: {formatDatePtBr(productionQuery.data.comparisonPeriod.from)} a {formatDatePtBr(productionQuery.data.comparisonPeriod.to)} · {filtered.length.toLocaleString('pt-BR')} registros válidos · Atualizado às {new Date(productionQuery.data.generatedAt).toLocaleTimeString('pt-BR')}.
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
              <ExecutiveDashboard analysis={analysis} />
              <OperationalInsights analysis={analysis} />
              <ProductionAnalysisCharts report={productionReport} />
            </>
          )}
        </TabsContent>
        <TabsContent value="trend" className="space-y-5">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-2.5 w-full sm:w-auto">
            <div className="space-y-1.5 w-full sm:w-48 shrink-0">
              <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider leading-none">Mês</Label>
              <Input type="month" value={month} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }} className="w-full bg-card border-border/80 text-foreground rounded-full pl-4 pr-10 shadow-sm [color-scheme:light] dark:[color-scheme:dark]" />
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

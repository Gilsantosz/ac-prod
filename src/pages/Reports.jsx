import { useMemo, useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Download, LineChart } from 'lucide-react';
import { toast } from 'sonner';
import { monthlySeries, monthlyByCell, monthOverMonth, seasonalityAlerts, executiveSummary, nextMonthProjection, cellBenchmark } from '@/lib/reportMetrics';
import { exportProductionCsv } from '@/lib/exportReports';
import ExecutiveDashboard from '@/components/reports/ExecutiveDashboard';
import NextMonthForecast from '@/components/reports/NextMonthForecast';
import CellBenchmark from '@/components/reports/CellBenchmark';
import DateRangeFilter from '@/components/reports/DateRangeFilter';
import SeasonalityAlerts from '@/components/reports/SeasonalityAlerts';
import MonthSummary from '@/components/reports/MonthSummary';
import MonthlyTrendChart from '@/components/reports/MonthlyTrendChart';
import CellTrendChart from '@/components/reports/CellTrendChart';
import PageHeader from '@/components/ui/PageHeader';

export default function Reports() {
  const [range, setRange] = useState({ from: '', to: '' });

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
      <DateRangeFilter range={range} setRange={setRange} />

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum dado de produção para o período selecionado.
        </div>
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
    </div>
  );
}
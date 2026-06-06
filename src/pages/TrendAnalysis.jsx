import { useState, useMemo, useRef } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { TrendingUp, Gauge, Target } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCells } from '@/hooks/useCells';
import { seriesByCell } from '@/lib/trendMetrics';
import TrendLineChart from '@/components/trend/TrendLineChart';
import TrendSummaryCards from '@/components/trend/TrendSummaryCards';
import ExportTrendButton from '@/components/trend/ExportTrendButton';
import PageHeader from '@/components/ui/PageHeader';

export default function TrendAnalysis() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const { getCell } = useCells();
  const reportRef = useRef(null);

  const { data: all = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 2000),
    initialData: [],
  });

  const monthEntries = useMemo(
    () => all.filter((e) => e.date && e.date.slice(0, 7) === month),
    [all, month]
  );

  const byCell = useMemo(() => seriesByCell(monthEntries, month, getCell), [monthEntries, month, getCell]);
  const cells = useMemo(() => byCell.map((c) => c.cell), [byCell]);

  // Pivota: uma linha por dia, uma coluna por célula
  const buildPivot = (key) => {
    if (!byCell.length) return [];
    const days = byCell[0].series.map((p) => p.day);
    return days.map((day, idx) => {
      const row = { day };
      byCell.forEach(({ cell, series }) => {
        row[cell] = series[idx]?.[key] ?? null;
      });
      return row;
    });
  };

  const oeeData = useMemo(() => buildPivot('oee'), [byCell]);
  const prodData = useMemo(() => buildPivot('productivity'), [byCell]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Análise de Tendência"
        subtitle="Evolução diária de OEE e produtividade por célula ao longo do mês."
        icon={TrendingUp}
        actions={
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-2.5 w-full sm:w-auto">
            <div className="space-y-1.5 w-full sm:w-40 shrink-0">
              <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider leading-none">Mês</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full bg-card border-border/80 text-foreground rounded-full px-4 shadow-sm [color-scheme:light] dark:[color-scheme:dark]" />
            </div>
            <div className="w-full sm:w-auto shrink-0 flex">
              <ExportTrendButton month={month} targetRef={reportRef} disabled={monthEntries.length === 0} />
            </div>
          </div>
        }
      />

      {monthEntries.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum dado de produção para o mês selecionado.
        </div>
      ) : (
        <div ref={reportRef} className="space-y-6 bg-background">
          <TrendSummaryCards byCell={byCell} />
          <TrendLineChart title="Evolução do OEE (%)" icon={Gauge} data={oeeData} cells={cells} unit="%" />
          <TrendLineChart title="Evolução da Produtividade (%)" icon={Target} data={prodData} cells={cells} unit="%" />
        </div>
      )}
    </div>
  );
}
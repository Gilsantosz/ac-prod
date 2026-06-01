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
    <div className="p-6 lg:p-8 space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 text-white p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Análise de Tendência</h1>
            <p className="text-white/70 text-sm">Evolução diária de OEE e produtividade por célula ao longo do mês.</p>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/70">Mês</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44 bg-white/10 border-white/20 text-white [color-scheme:dark]"
            />
          </div>
          <ExportTrendButton month={month} targetRef={reportRef} disabled={monthEntries.length === 0} />
        </div>
      </div>

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
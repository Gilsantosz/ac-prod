import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Gauge } from 'lucide-react';
import { formatMetric } from '@/lib/operationalAnalysis';
import { formatDatePtBr } from '@/lib/reports/reportDataUtils';

// The same filtered snapshot as the other dashboard charts; no fallback to a different date.
export default function RealtimeCellProgressPanel({ analysis, date, shift, loading = false }) {
  const cells = analysis?.cells || [];
  return <Card className="p-5 border-border/60">
    <h3 className="flex items-center gap-2 font-semibold"><Gauge className="h-4 w-4 text-primary" />Avanço da meta por célula</h3>
    <p className="text-xs text-muted-foreground mt-1 mb-4">{formatDatePtBr(date)} · {shift === 'all' ? 'Todos os turnos' : shift} · unidade selecionada</p>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Atualizando o recorte…</p>
      : !cells.length ? <p className="text-sm text-muted-foreground py-5">Nenhum registro para os filtros selecionados.</p>
        : <div className="space-y-3">{cells.map((cell) => <div key={cell.key} className="rounded-xl border border-border/40 bg-secondary/20 p-3">
          <div className="flex justify-between items-baseline gap-3 flex-wrap mb-2"><strong className="text-sm">{cell.cell}</strong><span className="text-sm tabular-nums">{formatMetric(cell.produced)} / {formatMetric(cell.target)} {cell.unitLabel}</span></div>
          {cell.attainment == null ? <p className="text-xs text-muted-foreground">Sem base de meta</p> : <><Progress value={Math.min(100, cell.attainment)} className="[&>div]:bg-gradient-to-r [&>div]:from-emerald-400 [&>div]:to-emerald-700" /><p className="mt-2 text-xs text-muted-foreground">{formatMetric(cell.attainment)}% da meta · saldo de {formatMetric(cell.gap)} {cell.unitLabel}</p></>}
        </div>)}</div>}
  </Card>;
}

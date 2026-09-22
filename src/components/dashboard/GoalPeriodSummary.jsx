import { CalendarRange } from 'lucide-react';
import { formatMetric } from '@/lib/operationalAnalysis';
import { aggregateGoalBuckets } from '@/lib/dashboardGoalAnalysis';

// Accumulation, not a calendar-day extrapolation pretending to predict output.
export default function GoalPeriodSummary({ analysis, title }) {
  if (!analysis) return null;
  const months = aggregateGoalBuckets(analysis.goalBuckets, (b) => b.date.slice(0, 7) + '|' + b.metric_unit);
  return <section className="rounded-2xl border border-border/70 bg-card p-5">
    <h3 className="flex items-center gap-2 font-semibold"><CalendarRange className="h-5 w-5 text-sky-600" />{title}</h3>
    <p className="mt-1 text-xs text-muted-foreground">Metas vigentes nos dias úteis do calendário · unidade selecionada · sem projeção automática de ritmo.</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full text-sm text-left whitespace-nowrap"><thead><tr>{['Mês', 'Produção', 'Meta acumulada', 'Atingimento'].map((t) => <th key={t} className="p-2 border-b border-border text-xs text-muted-foreground">{t}</th>)}</tr></thead><tbody>
      {months.map((m) => <tr key={m.key}><td className="p-2">{m.key.split('|')[0].split('-').reverse().join('/')}</td><td className="p-2 tabular-nums">{m.count ? formatMetric(m.produced) : m.measurementPending ? 'A medir' : 'Sem apontamento'} {m.unitLabel}</td><td className="p-2 tabular-nums">{formatMetric(m.target)} {m.unitLabel}</td><td className="p-2 tabular-nums">{formatMetric(m.attainment)}{m.attainment != null ? '%' : ''}</td></tr>)}
    </tbody></table></div>
    {!months.length && <p className="text-sm text-muted-foreground py-4">Sem dados para os filtros selecionados.</p>}
    <p className="mt-4 text-xs text-muted-foreground">Produção por volume em peças sem medição de metros/chapas não compõe um percentual nessas unidades. Dias sem apontamento não comprovam parada física.</p>
  </section>;
}

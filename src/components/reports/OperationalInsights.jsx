import { useState } from 'react';
import { Lightbulb, ArrowUpRight, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { formatMetric } from '@/lib/operationalAnalysis';
import { goalStatusLabel } from '@/lib/dashboardGoalAnalysis';

export default function OperationalInsights({ analysis, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  if (!analysis || (!analysis.recordCount && !analysis.goalCoverage)) return null;
  const insights = compact && !expanded ? analysis.insights.slice(0, 3) : analysis.insights;
  const rows = analysis.goalBuckets || [];
  return <section className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 sm:p-6" aria-label="Insights de produção e metas">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-amber-500/10 p-2.5"><Lightbulb className="h-5 w-5 text-amber-600" /></span><div><h2 className="font-semibold">Leitura do período</h2><p className="text-xs sm:text-sm text-muted-foreground mt-1">O que foi medido, qual meta se aplica e o que conferir.</p></div></div>
      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium shrink-0">{analysis.insights.length} dicas</span>
    </div>
    <div className={`mt-5 grid grid-cols-1 ${compact ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-3`}>
      {insights.map((item) => {
        const Icon = item.level === 'attention' ? AlertTriangle : item.level === 'positive' ? CheckCircle2 : Info;
        return <article key={item.id} className="min-w-0 rounded-xl border border-border/60 bg-secondary/10 p-4">
          <div className="flex items-start gap-2"><Icon className={`h-4 w-4 mt-0.5 shrink-0 ${item.level === 'attention' ? 'text-amber-600 dark:text-amber-400' : item.level === 'positive' ? 'text-emerald-600' : 'text-sky-600'}`} /><h3 className="font-semibold text-sm leading-snug">{item.title}</h3></div>
          <p className="text-sm leading-relaxed mt-3">{item.evidence}</p>
          <div className="mt-3 rounded-lg bg-background/70 p-3 text-xs leading-relaxed text-muted-foreground"><ArrowUpRight className="inline h-3.5 w-3.5 mr-1" /><strong>Próxima verificação: </strong>{item.action}</div>
        </article>;
      })}
    </div>
    {compact && analysis.insights.length > 3 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="mt-4 min-h-10 text-sm font-semibold text-primary underline-offset-4 hover:underline">{expanded ? 'Mostrar menos' : `Ver todas as ${analysis.insights.length} dicas`}</button>}
    {rows.length > 0 && <details className="mt-4 rounded-xl border border-border/60 p-3">
      <summary className="cursor-pointer py-1 text-sm font-semibold">Conferir produção × meta e origem do cadastro</summary>
      <p className="mt-2 mb-3 text-xs text-muted-foreground">Meta integral por dia e turno, independente do número de baixas. Não é uma meta por hora.</p>
      <div className="max-h-72 overflow-auto"><table className="w-full text-xs text-left whitespace-nowrap"><thead className="sticky top-0 bg-card"><tr>{['Data', 'Célula / turno', 'Unidade', 'Produzido', 'Meta', 'Origem', 'Situação'].map((t) => <th key={t} className="p-2 font-semibold border-b border-border">{t}</th>)}</tr></thead><tbody>
        {rows.slice(0, 200).map((r) => <tr key={r.key} className="border-b border-border/40"><td className="p-2">{r.date.split('-').reverse().join('/')}</td><td className="p-2">{r.cell} · {r.shift}</td><td className="p-2">{r.unitLabel}</td><td className="p-2 tabular-nums">{r.measurementPending && !r.count ? 'A medir' : r.count ? formatMetric(r.produced) : 'Sem apontamento'}</td><td className="p-2 tabular-nums">{formatMetric(r.target)}</td><td className="p-2">{r.goal_date?.split('-').reverse().join('/') || '—'}</td><td className="p-2">{goalStatusLabel(r.status)}</td></tr>)}
      </tbody></table></div>
      {rows.length > 200 && <p className="text-xs mt-2 text-muted-foreground">Exibindo 200 de {rows.length} grupos. Exporte o relatório para a conferência completa.</p>}
    </details>}
    <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium py-2">Como ler estes indicadores</summary><div className="space-y-2 mt-2">{analysis.methodology.map((value) => <p key={value}>{value}</p>)}</div>{analysis.excludedCount > 0 && <p className="mt-2">{analysis.excludedCount} registro(s) não válido(s) excluído(s).</p>}</details>
  </section>;
}

import { Lightbulb, ArrowUpRight } from 'lucide-react';

export default function OperationalInsights({ analysis, compact = false }) {
  if (!analysis?.recordCount) return null;
  const insights = compact ? analysis.insights.slice(0, 3) : analysis.insights;
  return <section className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
    <div className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-500" /><h2 className="font-semibold">O que os dados mostram</h2></div>
    <p className="text-sm text-muted-foreground mt-1 mb-5">Observações do período e próximos pontos de verificação.</p>
    <div className={`grid grid-cols-1 ${compact ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-3`}>
      {insights.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-border/60 bg-secondary/20 p-4">
        <div className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.level === 'attention' ? 'bg-amber-500' : item.level === 'positive' ? 'bg-emerald-500' : 'bg-sky-500'}`} /><h3 className="font-semibold text-sm">{item.title}</h3></div>
        <p className="text-sm leading-relaxed mt-2">{item.evidence}</p>
        <p className="text-xs leading-relaxed text-muted-foreground mt-3"><ArrowUpRight className="inline h-3.5 w-3.5 mr-1" /><strong>Verificar: </strong>{item.action}</p>
      </article>)}
    </div>
    {!compact && <details className="mt-5 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium py-2">Como ler estes indicadores</summary><ul className="list-disc pl-5 space-y-2 mt-2">{analysis.methodology.map((text) => <li key={text}>{text}</li>)}</ul>{analysis.excludedCount > 0 && <p className="mt-2">{analysis.excludedCount} registro(s) estornado(s) ou não válido(s) excluído(s).</p>}</details>}
  </section>;
}

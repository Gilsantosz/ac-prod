import { Package, Target, Gauge, Clock } from 'lucide-react';
import { formatMetric } from '@/lib/operationalAnalysis';

export default function ExecutiveDashboard({ analysis }) {
  if (!analysis) return null;
  const cards = [
    { label: 'Produção registrada', icon: Package, field: 'produced', note: 'Volume de operações por unidade', color: 'text-emerald-600' },
    { label: 'Meta do recorte', icon: Target, field: 'target', note: 'Soma das metas lançadas', color: 'text-sky-600' },
    { label: 'Atingimento da meta', icon: Gauge, field: 'attainment', note: 'Produzido ÷ meta · não é OEE', color: 'text-violet-600' },
    { label: 'Paradas registradas', icon: Clock, field: 'downtime', note: `${analysis.recordCount.toLocaleString('pt-BR')} registros válidos analisados`, color: 'text-amber-600' },
  ];
  return <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-4">
    {cards.map(({ label, icon: Icon, field, note, color }) => <section key={field} className="relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-700 via-emerald-500 to-sky-400" />
      <div className="flex items-center justify-between gap-2 mb-4"><h2 className="text-sm font-medium text-muted-foreground">{label}</h2><Icon className={`h-5 w-5 shrink-0 ${color}`} /></div>
      {field === 'downtime' ? <p className="text-3xl font-bold tabular-nums">{formatMetric(analysis.downtime)} <span className="text-sm font-normal text-muted-foreground">min</span></p>
        : analysis.units.length ? <div className="space-y-2">{analysis.units.map((unit) => <div key={unit.key} className="flex flex-wrap items-baseline justify-between gap-x-2"><span className="text-2xl font-bold tabular-nums">{formatMetric(unit[field])}{field === 'attainment' && unit[field] != null ? '%' : ''}</span><span className="text-xs text-muted-foreground">{unit.unitLabel}</span></div>)}</div> : <p className="text-xl text-muted-foreground">Sem registros</p>}
      <p className="text-xs leading-relaxed text-muted-foreground mt-4">{note}</p>
    </section>)}
  </div>;
}

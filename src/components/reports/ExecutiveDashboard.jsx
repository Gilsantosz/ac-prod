import { Package, Target, Gauge, Clock, CheckCircle2, Info } from 'lucide-react';
import { formatMetric } from '@/lib/operationalAnalysis';

const styles = {
  produced: { icon: Package, tone: 'text-emerald-700 dark:text-emerald-300', tile: 'bg-emerald-500/10', accent: 'from-emerald-500 to-teal-500' },
  target: { icon: Target, tone: 'text-sky-700 dark:text-sky-300', tile: 'bg-sky-500/10', accent: 'from-sky-500 to-indigo-500' },
  attainment: { icon: Gauge, tone: 'text-violet-700 dark:text-violet-300', tile: 'bg-violet-500/10', accent: 'from-violet-500 to-fuchsia-500' },
  downtime: { icon: Clock, tone: 'text-amber-700 dark:text-amber-300', tile: 'bg-amber-500/10', accent: 'from-amber-400 to-orange-500' },
};

export default function ExecutiveDashboard({ analysis }) {
  if (!analysis) return null;
  const linked = Boolean(analysis.goalCoverage);
  const unavailable = linked && analysis.status !== 'ready';
  const cards = [
    { label: 'Produção registrada', field: 'produced', note: linked ? 'Somente a unidade medida; sem conversões presumidas.' : 'Volume de operações por unidade.' },
    { label: linked ? 'Meta vigente do período' : 'Meta do recorte', field: 'target', note: linked ? 'Uma meta por dia, célula e turno. Cadastro vigente.' : 'Soma das metas lançadas.' },
    { label: 'Atingimento da meta', field: 'attainment', note: 'Avanço sobre a meta integral do período. Não é OEE.' },
    { label: 'Paradas registradas', field: 'downtime', note: 'Minutos apontados; não é tempo de máquina disponível.' },
  ];
  return <section aria-label="Indicadores de produção e metas" className="space-y-3" data-testid="executive-kpis">
    <div className="grid grid-cols-1 min-[360px]:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
      {cards.map(({ label, field, note }) => {
        const { icon: Icon, tone, tile, accent } = styles[field];
        return <article key={field} className="relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm transition-shadow hover:shadow-md" data-kpi={field}>
          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} />
          <div className="flex items-start justify-between gap-2 mb-4">
            <h2 className="text-xs sm:text-sm font-semibold leading-snug text-muted-foreground">{label}</h2>
            <span className={`rounded-xl p-2 shrink-0 ${tile} ${tone}`}><Icon aria-hidden="true" className="h-4 w-4 sm:h-5 sm:w-5" /></span>
          </div>
          {field === 'downtime' ? <div><p className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">{formatMetric(analysis.downtime)}<span className="ml-1 text-xs sm:text-sm font-medium text-muted-foreground">min</span></p><p className="mt-2 text-xs text-muted-foreground">{analysis.recordCount.toLocaleString('pt-BR')} apontamento(s) válidos</p></div>
            : analysis.units.length ? <div className="space-y-3">{analysis.units.map((unit) => {
              const waiting = unavailable && field !== 'produced';
              const value = waiting ? null : unit[field];
              const missingMeasurement = field === 'produced' && unit.measurementPending > 0 && !unit.count;
              const caption = waiting ? analysis.status === 'loading' ? 'Carregando' : 'Indisponível' : missingMeasurement ? 'A medir' : value == null ? 'Sem base' : formatMetric(value);
              const met = field === 'attainment' && value != null && value >= 100;
              return <div key={unit.key}>
                <p className={`font-bold tracking-tight tabular-nums break-words ${value == null || missingMeasurement ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl'} ${met ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'}`}>{caption}{field === 'attainment' && value != null ? <span className="text-lg">%</span> : null}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">{unit.unitLabel}{field === 'attainment' && met ? ' · Meta alcançada' : ''}</p>
                {field === 'attainment' && value != null && <>
                  <div role="progressbar" aria-label={`Avanço da meta em ${unit.unitLabel}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, value))} aria-valuetext={`${formatMetric(value)}% da meta`} className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className={`h-full rounded-full bg-gradient-to-r ${met ? 'from-emerald-500 to-teal-500' : 'from-violet-500 to-indigo-500'}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{met ? `${formatMetric(Math.max(0, unit.produced - unit.target))} ${unit.unitLabel} acima da meta` : `Restam ${formatMetric(unit.gap)} ${unit.unitLabel}`}</p>
                </>}
                {field === 'attainment' && value == null && <p className="mt-2 text-xs text-muted-foreground">{unit.measurementPending ? 'Volume sem medição compatível' : !unit.count ? 'Aguardando apontamentos' : 'Confira o vínculo com as metas'}</p>}
              </div>;
            })}</div> : <p className="text-lg font-semibold text-muted-foreground">{unavailable ? analysis.status === 'loading' ? 'Carregando base' : 'Base indisponível' : 'Sem registros'}</p>}
          <p className="mt-4 border-t border-border/50 pt-3 text-[11px] sm:text-xs leading-relaxed text-muted-foreground">{note}</p>
        </article>;
      })}
    </div>
    {linked && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-card px-4 py-3 text-xs text-muted-foreground">
      {unavailable || analysis.goalCoverage.linked < analysis.goalCoverage.groups ? <Info className="h-4 w-4 text-amber-600" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
      <span><strong className="text-foreground">{unavailable ? 'Base aguardando confirmação' : `${analysis.goalCoverage.linked}/${analysis.goalCoverage.groups} grupos com meta compatível`}</strong></span>
      <span>{analysis.goalCoverage.inherited} meta(s) herdadas do cadastro vigente</span>
      <span>Conferência detalhada em “Leitura do período”</span>
    </div>}
  </section>;
}

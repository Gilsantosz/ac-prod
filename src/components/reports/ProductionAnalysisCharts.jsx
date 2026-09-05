import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMetric } from '@/lib/operationalAnalysis';

export const CHART_TOOLTIP = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, color: 'hsl(var(--foreground))' };
export function BarGradients({ id, horizontal = false }) {
  return <defs>{[['produced', '#34d399', '#15803d'], ['target', '#cbd5e1', '#64748b'], ['warning', '#fbbf24', '#d97706']].map(([key, start, end]) =>
    <linearGradient key={key} id={`${id}-${key}`} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}><stop offset="0%" stopColor={start} /><stop offset="100%" stopColor={end} /></linearGradient>)}</defs>;
}

export default function ProductionAnalysisCharts({ report }) {
  const id = useId().replace(/:/g, '');
  const { units, cells } = report.metadata.analysis;
  const unit = units[0];
  if (!unit) return null;
  const monthly = report.metadata.monthlyRows.filter((r) => r.metric_unit === unit.key);
  const byCell = cells.filter((c) => c.metric_unit === unit.key).sort((a, b) => (a.attainment ?? Infinity) - (b.attainment ?? Infinity));
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Desempenho por unidade</h2><p className="text-xs text-muted-foreground mt-1">Compare volumes na mesma unidade de produção.</p></div>

    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <article className="min-w-0 rounded-2xl border border-border/70 bg-card p-5"><h3 className="font-semibold">Produção e meta por mês</h3><p className="text-xs text-muted-foreground mt-1 mb-4">{unit.unitLabel} · atingimento no eixo direito</p>
        <ResponsiveContainer width="100%" height={300}><ComposedChart data={monthly} margin={{ top: 12, right: 0, left: -12, bottom: 0 }}>
          <BarGradients id={`${id}-monthly`} /><CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 5" /><XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="volume" tick={{ fontSize: 11 }} tickFormatter={formatMetric} axisLine={false} tickLine={false} /><YAxis yAxisId="percent" orientation="right" unit="%" domain={[0, 'auto']} width={48} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={CHART_TOOLTIP} formatter={(value, name) => [`${formatMetric(value)}${name === 'Atingimento' ? '%' : ` ${unit.unitLabel}`}`, name]} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="volume" dataKey="target" name="Meta" fill={`url(#${id}-monthly-target)`} maxBarSize={32} radius={[5, 5, 0, 0]} isAnimationActive={false} />
          <Bar yAxisId="volume" dataKey="produced" name="Produzido" fill={`url(#${id}-monthly-produced)`} maxBarSize={32} radius={[5, 5, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="percent" dataKey="attainment" name="Atingimento" stroke="#0284c7" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer>
      </article>
      <article className="min-w-0 rounded-2xl border border-border/70 bg-card p-5"><h3 className="font-semibold">Onde atuar primeiro</h3><p className="text-xs text-muted-foreground mt-1 mb-4">Células por atingimento crescente · {unit.unitLabel}</p>
        <div className="max-h-[340px] overflow-y-auto"><ResponsiveContainer width="100%" height={Math.max(280, byCell.length * 64)}><BarChart data={byCell} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <BarGradients id={`${id}-cells`} horizontal /><CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 5" /><XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="cell" width={96} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v, n) => [`${formatMetric(v)} ${unit.unitLabel}`, n]} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="target" name="Meta" fill={`url(#${id}-cells-target)`} radius={[0, 5, 5, 0]} maxBarSize={16} isAnimationActive={false} /><Bar dataKey="produced" name="Produzido" fill={`url(#${id}-cells-produced)`} radius={[0, 5, 5, 0]} maxBarSize={16} isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>
      </article>
    </div>
    <div className="rounded-2xl border border-border/70 bg-card overflow-hidden"><div className="p-5"><h3 className="font-semibold">Detalhamento para decisão</h3><p className="text-xs text-muted-foreground mt-1">Valores do mesmo recorte exportado para PDF e Excel.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-secondary/60 text-muted-foreground"><tr>{['Célula', 'Unidade', 'Produzido', 'Meta', 'Atingimento', 'Saldo', 'Refugo', 'Paradas'].map((label) => <th key={label} className="px-4 py-3 text-left whitespace-nowrap font-medium">{label}</th>)}</tr></thead><tbody>{cells.map((c) => <tr key={c.key} className="border-t border-border/50 hover:bg-secondary/20"><td className="px-4 py-3 font-medium">{c.cell}</td><td className="px-4 py-3 text-muted-foreground">{c.unitLabel}</td>{[c.produced, c.target].map((value, i) => <td key={i} className="px-4 py-3 tabular-nums">{formatMetric(value)}</td>)}<td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatMetric(c.attainment)}{c.attainment != null && '%'}</td><td className="px-4 py-3 tabular-nums">{formatMetric(c.gap)}</td><td className="px-4 py-3 tabular-nums">{formatMetric(c.scrapRate)}{c.scrapRate != null && '%'}</td><td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatMetric(c.downtime)} min</td></tr>)}</tbody></table></div></div>
  </section>;
}

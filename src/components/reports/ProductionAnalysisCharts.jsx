import BarGradientStops from '@/components/ui/BarGradientStops';
import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMetric } from '@/lib/operationalAnalysis';

export const CHART_TOOLTIP = {
  background: 'hsl(var(--card) / 0.92)',
  backdropFilter: 'blur(8px)',
  border: '1px solid hsl(var(--border) / 0.7)',
  borderRadius: 12,
  color: 'hsl(var(--foreground))',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
};

export default function ProductionAnalysisCharts({ report }) {
  const id = useId().replace(/:/g, '');
  const isAnimated = process.env.NODE_ENV !== 'test';
  const { units, cells } = report.metadata.analysis;
  const unit = units[0];
  if (!unit) return null;
  const monthly = report.metadata.monthlyRows.filter((r) => r.metric_unit === unit.key);
  const byCell = cells.filter((c) => c.metric_unit === unit.key).sort((a, b) => (a.attainment ?? Infinity) - (b.attainment ?? Infinity));

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg text-foreground">Desempenho por unidade</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Compare volumes na mesma unidade de produção.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <article className="min-w-0 rounded-2xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-card/75 backdrop-blur-md p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.25)]">
          <h3 className="font-semibold text-base text-foreground tracking-tight">Produção e meta por mês</h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-4">{unit.unitLabel} · atingimento no eixo direito</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs><BarGradientStops id={`${id}-monthly`} /></defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.5)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="volume" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={formatMetric} axisLine={false} tickLine={false} />
              <YAxis yAxisId="percent" orientation="right" unit="%" domain={[0, 'auto']} width={48} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP}
                formatter={(value, name) => [`${formatMetric(value)}${name === 'Atingimento' ? '%' : ` ${unit.unitLabel}`}`, name]}
              />
              <Legend
                verticalAlign="top"
                align="left"
                height={36}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingBottom: 12 }}
              />
              <Bar yAxisId="volume" dataKey="target" name="Meta" fill={`url(#${id}-monthly-target)`} maxBarSize={22} radius={[6, 6, 0, 0]} isAnimationActive={isAnimated} animationDuration={1000} animationEasing="ease-out" />
              <Bar yAxisId="volume" dataKey="produced" name="Produzido" fill={`url(#${id}-monthly-produced)`} maxBarSize={22} radius={[6, 6, 0, 0]} isAnimationActive={isAnimated} animationDuration={1000} animationEasing="ease-out" />
              <Line yAxisId="percent" dataKey="attainment" name="Atingimento" stroke="#0284c7" strokeWidth={2.5} dot={{ r: 3, fill: '#0284c7', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={isAnimated} animationDuration={1000} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="min-w-0 rounded-2xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-card/75 backdrop-blur-md p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.25)]">
          <h3 className="font-semibold text-base text-foreground tracking-tight">Onde atuar primeiro</h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 mb-4">Células por atingimento crescente · {unit.unitLabel}</p>
          <div className="max-h-[340px] overflow-y-auto">
            <ResponsiveContainer width="100%" height={Math.max(280, byCell.length * 64)}>
              <BarChart data={byCell} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <defs><BarGradientStops id={`${id}-cells`} horizontal /></defs>
                <CartesianGrid horizontal={false} stroke="hsl(var(--border) / 0.5)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="cell" width={96} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v, n) => [`${formatMetric(v)} ${unit.unitLabel}`, n]} />
                <Legend
                  verticalAlign="top"
                  align="left"
                  height={36}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingBottom: 12 }}
                />
                <Bar dataKey="target" name="Meta" fill={`url(#${id}-cells-target)`} radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={isAnimated} animationDuration={1000} animationEasing="ease-out" />
                <Bar dataKey="produced" name="Produzido" fill={`url(#${id}-cells-produced)`} radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={isAnimated} animationDuration={1000} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>

      <div className="rounded-2xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-card/75 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.25)] overflow-hidden">
        <div className="p-5 sm:p-6">
          <h3 className="font-semibold text-base text-foreground tracking-tight">Detalhamento para decisão</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Valores do mesmo recorte exportado para PDF e Excel.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                {['Célula', 'Unidade', 'Produzido', 'Meta', 'Atingimento', 'Saldo', 'Refugo', 'Paradas'].map((label) => (
                  <th key={label} className="px-4 py-3 text-left whitespace-nowrap font-medium text-xs uppercase tracking-wider">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={c.key} className="border-t border-border/40 hover:bg-secondary/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{c.cell}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.unitLabel}</td>
                  {[c.produced, c.target].map((value, i) => <td key={i} className="px-4 py-3 tabular-nums">{formatMetric(value)}</td>)}
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap font-semibold">{formatMetric(c.attainment)}{c.attainment != null && '%'}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMetric(c.gap)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMetric(c.scrapRate)}{c.scrapRate != null && '%'}</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatMetric(c.downtime)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

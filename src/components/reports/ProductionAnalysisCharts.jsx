import { useId } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import BarGradientStops from '@/components/ui/BarGradientStops';
import GlassChartPanel from '@/components/charts/GlassChartPanel';
import ChartTooltip from '@/components/charts/ChartTooltip';
import {
  CHART_AXIS_TICK,
  CHART_GRID_PROPS,
  CHART_TOOLTIP_CURSOR,
  chartAnimation,
  getNiceAxisMax,
} from '@/components/charts/chartTheme';
import { formatMetric } from '@/lib/operationalAnalysis';

export const CHART_TOOLTIP = {
  background: 'hsl(var(--popover) / 0.92)',
  border: '1px solid hsl(var(--border) / 0.72)',
  borderRadius: 14,
  color: 'hsl(var(--foreground))',
};

export default function ProductionAnalysisCharts({ report }) {
  const id = useId().replace(/:/g, '');
  const reduceMotion = useReducedMotion();
  const { units, cells } = report.metadata.analysis;
  const unit = units[0];
  if (!unit) return null;

  const monthly = report.metadata.monthlyRows.filter((row) => row.metric_unit === unit.key);
  const byCell = cells
    .filter((cell) => cell.metric_unit === unit.key)
    .sort((a, b) => (a.attainment ?? Infinity) - (b.attainment ?? Infinity));
  const monthlyAxisMax = getNiceAxisMax(monthly.flatMap((row) => [row.target, row.produced]), 12);
  const cellAxisMax = getNiceAxisMax(byCell.flatMap((row) => [row.target, row.produced]), 12);

  const formatTooltipValue = (value, name) => name === 'Atingimento'
    ? `${formatMetric(value)}%`
    : `${formatMetric(value)} ${unit.unitLabel}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h2 className="font-semibold">Desempenho por unidade</h2>
          <p className="mt-1 text-xs text-muted-foreground">Compare volumes na mesma unidade de produção.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GlassChartPanel
          title="Produção e meta por mês"
          subtitle={`${unit.unitLabel} · atingimento no eixo direito`}
        >
          <div tabIndex={0} aria-label="Gráfico mensal de produção, meta e atingimento. Use as setas do teclado para explorar os valores.">
            <ResponsiveContainer width="100%" height={310}>
              <ComposedChart accessibilityLayer data={monthly} margin={{ top: 12, right: 2, left: -12, bottom: 0 }} barGap={3}>
                <defs>
                  <BarGradientStops id={`${id}-monthly`} />
                  <linearGradient id={`${id}-monthly-line`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#0ea5e9" />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
                <XAxis dataKey="label" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="volume"
                  domain={[0, monthlyAxisMax]}
                  tick={CHART_AXIS_TICK}
                  tickFormatter={formatMetric}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="percent"
                  orientation="right"
                  unit="%"
                  domain={[0, (maximum) => Math.max(100, Math.ceil(Number(maximum || 0) / 20) * 20)]}
                  width={48}
                  tick={{ ...CHART_AXIS_TICK, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={CHART_TOOLTIP_CURSOR}
                  content={<ChartTooltip valueFormatter={formatTooltipValue} />}
                />
                <Legend
                  verticalAlign="top"
                  align="left"
                  height={38}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                  className="chart-legend"
                />
                <Bar
                  yAxisId="volume"
                  dataKey="target"
                  name="Meta"
                  fill={`url(#${id}-monthly-target)`}
                  maxBarSize={22}
                  radius={[7, 7, 0, 0]}
                  activeBar={{ stroke: '#94a3b8', strokeWidth: 1, fillOpacity: 0.95 }}
                  {...chartAnimation(reduceMotion, 40)}
                />
                <Bar
                  yAxisId="volume"
                  dataKey="produced"
                  name="Produzido"
                  fill={`url(#${id}-monthly-produced)`}
                  maxBarSize={22}
                  radius={[7, 7, 0, 0]}
                  activeBar={{ stroke: '#10b981', strokeWidth: 1, fillOpacity: 1 }}
                  {...chartAnimation(reduceMotion, 110)}
                />
                <Line
                  yAxisId="percent"
                  dataKey="attainment"
                  name="Atingimento"
                  stroke={`url(#${id}-monthly-line)`}
                  strokeWidth={3.5}
                  dot={{ r: 3, fill: '#10b981', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: '#0ea5e9', stroke: 'hsl(var(--card))', strokeWidth: 3 }}
                  connectNulls={false}
                  {...chartAnimation(reduceMotion, 180)}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </GlassChartPanel>

        <GlassChartPanel
          title="Onde atuar primeiro"
          subtitle={`Células por atingimento crescente · ${unit.unitLabel}`}
        >
          <div
            className="max-h-[350px] overflow-y-auto pr-1"
            tabIndex={0}
            aria-label="Gráfico de produção e meta por célula. Use as setas do teclado para explorar os valores."
          >
            <ResponsiveContainer width="100%" height={Math.max(290, byCell.length * 66)}>
              <BarChart accessibilityLayer data={byCell} layout="vertical" margin={{ top: 8, right: 12, left: 0, bottom: 8 }} barGap={4}>
                <defs>
                  <BarGradientStops id={`${id}-cells`} horizontal />
                </defs>
                <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, cellAxisMax]}
                  tick={CHART_AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="cell"
                  width={96}
                  tick={CHART_AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={CHART_TOOLTIP_CURSOR}
                  content={<ChartTooltip valueFormatter={formatTooltipValue} />}
                />
                <Legend
                  verticalAlign="top"
                  align="left"
                  height={38}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                  className="chart-legend"
                />
                <Bar
                  dataKey="target"
                  name="Meta"
                  fill={`url(#${id}-cells-target)`}
                  radius={[0, 7, 7, 0]}
                  maxBarSize={22}
                  activeBar={{ stroke: '#94a3b8', strokeWidth: 1, fillOpacity: 0.95 }}
                  {...chartAnimation(reduceMotion, 45)}
                />
                <Bar
                  dataKey="produced"
                  name="Produzido"
                  fill={`url(#${id}-cells-produced)`}
                  radius={[0, 7, 7, 0]}
                  maxBarSize={22}
                  activeBar={{ stroke: '#10b981', strokeWidth: 1, fillOpacity: 1 }}
                  {...chartAnimation(reduceMotion, 120)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassChartPanel>
      </div>

      <div className="chart-glass-panel overflow-hidden">
        <div className="p-5">
          <h3 className="font-semibold">Detalhamento para decisão</h3>
          <p className="mt-1 text-xs text-muted-foreground">Valores do mesmo recorte exportado para PDF e Excel.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-muted-foreground backdrop-blur-sm">
              <tr>
                {['Célula', 'Unidade', 'Produzido', 'Meta', 'Atingimento', 'Saldo', 'Refugo', 'Paradas'].map((label) => (
                  <th key={label} className="whitespace-nowrap px-4 py-3 text-left font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map((cell) => (
                <tr key={cell.key} className="border-t border-border/50 transition-colors hover:bg-secondary/20">
                  <td className="px-4 py-3 font-medium">{cell.cell}</td>
                  <td className="px-4 py-3 text-muted-foreground">{cell.unitLabel}</td>
                  {[cell.produced, cell.target].map((value, index) => (
                    <td key={index} className="px-4 py-3 tabular-nums">{formatMetric(value)}</td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatMetric(cell.attainment)}{cell.attainment != null && '%'}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMetric(cell.gap)}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMetric(cell.scrapRate)}{cell.scrapRate != null && '%'}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatMetric(cell.downtime)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

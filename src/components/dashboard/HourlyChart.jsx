import { useId, useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Bar,
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
  formatChartNumber,
  getNiceAxisMax,
} from '@/components/charts/chartTheme';
import { sortByHour } from '@/lib/productionMetrics';

export default function HourlyChart({ grouped, unitLabel = '' }) {
  const id = useId().replace(/:/g, '');
  const reduceMotion = useReducedMotion();
  const data = useMemo(() => sortByHour(grouped).map((group) => ({
    hora: group.key,
    Produzido: Number(group.produced) || 0,
    Meta: Number(group.target) || 0,
    Atingimento: Number.isFinite(Number(group.efficiency)) ? Number(group.efficiency) : null,
  })), [grouped]);
  const axisMax = getNiceAxisMax(data.flatMap((item) => [item.Meta, item.Produzido]), 12);

  return (
    <GlassChartPanel
      title="Produtividade por Hora"
      subtitle={`${unitLabel || 'Volume produzido'} · atingimento no eixo direito`}
      controls={false}
      contentClassName="pt-2"
    >
      <div className="min-w-0 rounded-2xl focus-within:ring-2 focus-within:ring-emerald-500/20" tabIndex={0} aria-label="Gráfico de produtividade por hora. Use as setas do teclado para percorrer os valores.">
        <ResponsiveContainer width="100%" height={288}>
          <ComposedChart accessibilityLayer data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }} barGap={3}>
            <defs>
              <BarGradientStops id={id} />
              <linearGradient id={`${id}-attainment`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
            <XAxis
              dataKey="hora"
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              minTickGap={18}
            />
            <YAxis
              yAxisId="volume"
              domain={[0, axisMax]}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="percent"
              orientation="right"
              unit="%"
              domain={[0, (maximum) => Math.max(100, Math.ceil(Number(maximum || 0) / 20) * 20)]}
              tick={{ ...CHART_AXIS_TICK, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={42}
            />
            <Tooltip
              cursor={CHART_TOOLTIP_CURSOR}
              content={(
                <ChartTooltip
                  unit={unitLabel}
                  labelFormatter={(label) => `Horário ${label}`}
                  valueFormatter={(value, name) => name === 'Atingimento'
                    ? `${formatChartNumber(value)}%`
                    : `${formatChartNumber(value)}${unitLabel ? ` ${unitLabel}` : ''}`}
                />
              )}
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
              dataKey="Meta"
              name="Meta"
              fill={`url(#${id}-target)`}
              maxBarSize={18}
              radius={[7, 7, 0, 0]}
              activeBar={{ stroke: '#94a3b8', strokeWidth: 1, fillOpacity: 0.95 }}
              {...chartAnimation(reduceMotion, 40)}
            />
            <Bar
              yAxisId="volume"
              dataKey="Produzido"
              name="Produzido"
              fill={`url(#${id}-produced)`}
              maxBarSize={18}
              radius={[7, 7, 0, 0]}
              activeBar={{ stroke: '#10b981', strokeWidth: 1, fillOpacity: 1 }}
              {...chartAnimation(reduceMotion, 110)}
            />
            <Line
              yAxisId="percent"
              type="monotone"
              dataKey="Atingimento"
              name="Atingimento"
              stroke={`url(#${id}-attainment)`}
              strokeWidth={3.5}
              dot={{ r: 3, fill: '#10b981', strokeWidth: 2, stroke: 'hsl(var(--card))' }}
              activeDot={{ r: 5, fill: '#0ea5e9', strokeWidth: 3, stroke: 'hsl(var(--card))' }}
              connectNulls={false}
              {...chartAnimation(reduceMotion, 180)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </GlassChartPanel>
  );
}

import { useId } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import GlassChartPanel from '@/components/charts/GlassChartPanel';
import ChartTooltip from '@/components/charts/ChartTooltip';
import {
  CHART_AXIS_TICK,
  CHART_GRID_PROPS,
  chartAnimation,
  formatChartNumber,
} from '@/components/charts/chartTheme';

export default function WeeklyEfficiencyChart({ data, cellLabel }) {
  const id = useId().replace(/:/g, '');
  const reduceMotion = useReducedMotion();

  return (
    <GlassChartPanel
      title="Evolução da Eficiência (7 dias)"
      subtitle={cellLabel}
      icon={TrendingUp}
      controls={false}
      contentClassName="pt-2"
    >
      <div tabIndex={0} aria-label="Gráfico de linha da eficiência dos últimos sete dias. Use as setas do teclado para percorrer os valores.">
        <ResponsiveContainer width="100%" height={276}>
          <LineChart accessibilityLayer data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={`${id}-efficiency-line`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="48%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
            <XAxis dataKey="label" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 120]} unit="%" width={44} />
            <Tooltip
              content={(
                <ChartTooltip
                  labelFormatter={(label) => `Dia ${label}`}
                  valueFormatter={(value) => `${formatChartNumber(value)}%`}
                />
              )}
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={34}
              iconType="circle"
              iconSize={8}
              formatter={() => 'Eficiência'}
              wrapperStyle={{ fontSize: 12 }}
              className="chart-legend"
            />
            <ReferenceLine y={100} stroke="#10b981" strokeOpacity={0.65} strokeDasharray="5 6" />
            <ReferenceLine y={70} stroke="#f59e0b" strokeOpacity={0.65} strokeDasharray="5 6" />
            <Line
              type="monotone"
              dataKey="efficiency"
              name="Eficiência"
              stroke={`url(#${id}-efficiency-line)`}
              strokeWidth={4}
              dot={{ r: 3.5, fill: '#10b981', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
              activeDot={{ r: 6, fill: '#0ea5e9', stroke: 'hsl(var(--card))', strokeWidth: 3 }}
              connectNulls
              {...chartAnimation(reduceMotion, 100)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassChartPanel>
  );
}

import { useId, useMemo } from 'react';
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
import GlassChartPanel from '@/components/charts/GlassChartPanel';
import ChartTooltip from '@/components/charts/ChartTooltip';
import {
  CHART_AXIS_TICK,
  CHART_GRID_PROPS,
  chartAnimation,
  formatChartNumber,
} from '@/components/charts/chartTheme';
import { sortByHour } from '@/lib/productionMetrics';

export default function TrendChart({ grouped }) {
  const id = useId().replace(/:/g, '');
  const reduceMotion = useReducedMotion();
  const data = useMemo(() => sortByHour(grouped).map((group) => ({
    hora: group.key,
    Eficiência: group.efficiency,
    Refugo: group.scrapRate,
  })), [grouped]);

  return (
    <GlassChartPanel
      title="Evolução de Eficiência e Refugo"
      subtitle="Identifique gargalos de produtividade ao longo das horas do turno."
      controls={false}
    >
      <div tabIndex={0} aria-label="Gráfico de eficiência e refugo por hora. Use as setas do teclado para explorar os valores.">
        <ResponsiveContainer width="100%" height={288}>
          <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={`${id}-efficiency`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
              <linearGradient id={`${id}-scrap`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fb7185" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
            <XAxis dataKey="hora" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} unit="%" width={46} />
            <Tooltip
              content={(
                <ChartTooltip
                  labelFormatter={(hour) => `Horário ${hour}`}
                  valueFormatter={(value) => `${formatChartNumber(value)}%`}
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
            <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.6} strokeDasharray="5 6" />
            <Line
              type="monotone"
              dataKey="Eficiência"
              stroke={`url(#${id}-efficiency)`}
              strokeWidth={3.5}
              dot={{ r: 3, fill: '#10b981', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: '#0ea5e9', stroke: 'hsl(var(--card))', strokeWidth: 3 }}
              {...chartAnimation(reduceMotion, 80)}
            />
            <Line
              type="monotone"
              dataKey="Refugo"
              stroke={`url(#${id}-scrap)`}
              strokeWidth={3.5}
              dot={{ r: 3, fill: '#fb7185', stroke: 'hsl(var(--card))', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: '#ef4444', stroke: 'hsl(var(--card))', strokeWidth: 3 }}
              {...chartAnimation(reduceMotion, 150)}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassChartPanel>
  );
}

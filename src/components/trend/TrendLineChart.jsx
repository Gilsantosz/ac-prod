import { useId } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

const GRADIENTS = [
  ['#34d399', '#0ea5e9'],
  ['#60a5fa', '#8b5cf6'],
  ['#fbbf24', '#f97316'],
  ['#f472b6', '#8b5cf6'],
  ['#22d3ee', '#2563eb'],
  ['#fb7185', '#ef4444'],
  ['#a3e635', '#10b981'],
  ['#c084fc', '#6366f1'],
  ['#2dd4bf', '#06b6d4'],
  ['#facc15', '#ec4899'],
];

// data: [{ day, [cellName]: value, ... }] ; cells: string[]
export default function TrendLineChart({ title, icon: Icon, data, cells, unit = '%' }) {
  const id = useId().replace(/:/g, '');
  const reduceMotion = useReducedMotion();

  return (
    <GlassChartPanel title={title} icon={Icon} subtitle="Evolução diária por célula no período selecionado.">
      <div tabIndex={0} aria-label={`${title}. Use as setas do teclado para percorrer dias e séries.`}>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 18, left: -8, bottom: 0 }}>
            <defs>
              {cells.map((cell, index) => {
                const [start, end] = GRADIENTS[index % GRADIENTS.length];
                return (
                  <linearGradient key={cell} id={`${id}-line-${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={start} />
                    <stop offset="100%" stopColor={end} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
            <XAxis dataKey="day" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} minTickGap={10} />
            <YAxis tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} unit={unit} width={48} />
            <Tooltip
              content={(
                <ChartTooltip
                  labelFormatter={(day) => `Dia ${day}`}
                  valueFormatter={(value) => value == null ? '—' : `${formatChartNumber(value)}${unit}`}
                />
              )}
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={42}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              className="chart-legend"
            />
            {cells.map((cell, index) => (
              <Line
                key={cell}
                type="monotone"
                dataKey={cell}
                name={cell}
                stroke={`url(#${id}-line-${index})`}
                strokeWidth={3.25}
                dot={false}
                activeDot={{ r: 5, fill: GRADIENTS[index % GRADIENTS.length][1], stroke: 'hsl(var(--card))', strokeWidth: 3 }}
                connectNulls
                {...chartAnimation(reduceMotion, index * 70)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassChartPanel>
  );
}

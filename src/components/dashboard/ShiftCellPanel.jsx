import { useId, useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

export default function ShiftCellPanel({ title, subtitle, grouped, unitLabel = '' }) {
  const id = useId().replace(/:/g, '');
  const reduceMotion = useReducedMotion();
  const data = useMemo(() => grouped.map((group) => ({
    nome: group.key,
    Produzido: Number(group.produced) || 0,
    Meta: Number(group.target) || 0,
    Atingimento: Number.isFinite(Number(group.efficiency)) ? Number(group.efficiency) : null,
  })), [grouped]);
  const axisMax = getNiceAxisMax(data.flatMap((item) => [item.Meta, item.Produzido]), 12);
  const chartHeight = Math.max(250, data.length * 62);

  return (
    <GlassChartPanel title={title} subtitle={subtitle} controls={false} contentClassName="pt-2">
      <div className="max-h-[410px] overflow-y-auto pr-1" tabIndex={0} aria-label={`${title}. Use as setas do teclado para percorrer os valores.`}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart accessibilityLayer data={data} layout="vertical" margin={{ top: 10, right: 12, left: 8, bottom: 8 }} barGap={4}>
            <defs>
              <BarGradientStops id={id} horizontal />
            </defs>
            <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, axisMax]}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={92}
              tick={CHART_AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={CHART_TOOLTIP_CURSOR}
              content={(
                <ChartTooltip
                  unit={unitLabel}
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
              dataKey="Meta"
              name="Meta"
              fill={`url(#${id}-target)`}
              maxBarSize={22}
              radius={[0, 8, 8, 0]}
              activeBar={{ stroke: '#94a3b8', strokeWidth: 1, fillOpacity: 0.95 }}
              {...chartAnimation(reduceMotion, 50)}
            />
            <Bar
              dataKey="Produzido"
              name="Produzido"
              fill={`url(#${id}-produced)`}
              maxBarSize={22}
              radius={[0, 8, 8, 0]}
              activeBar={{ stroke: '#10b981', strokeWidth: 1, fillOpacity: 1 }}
              {...chartAnimation(reduceMotion, 120)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassChartPanel>
  );
}

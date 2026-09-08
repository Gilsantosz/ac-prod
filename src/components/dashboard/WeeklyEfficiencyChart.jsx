import { useId } from 'react';
import GlassChartCard from '@/components/ui/GlassChartCard';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

export default function WeeklyEfficiencyChart({ data, cellLabel }) {
  const id = useId().replace(/:/g, '');
  const isAnimated = process.env.NODE_ENV !== 'test';

  return (
    <GlassChartCard
      title="Evolução da Eficiência (7 dias)"
      subtitle={cellLabel}
      icon={TrendingUp}
      headerClassName="pr-36"
    >
      <ResponsiveContainer width="100%" height={290}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={`${id}-area-grad`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
          <XAxis dataKey="label" fontSize={12} tick={{ fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis fontSize={12} domain={[0, 120]} unit="%" tick={{ fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v) => [`${v}%`, 'Eficiência']}
            labelFormatter={(l) => `Dia ${l}`}
            contentStyle={{
              background: 'hsl(var(--card) / 0.92)',
              backdropFilter: 'blur(8px)',
              border: '1px solid hsl(var(--border) / 0.7)',
              borderRadius: 12,
              fontSize: 13,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            }}
            itemStyle={{ color: 'hsl(var(--foreground))' }}
            labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 'bold' }}
          />
          <ReferenceLine y={100} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5} />
          <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5} />
          <Area
            type="monotone"
            dataKey="efficiency"
            stroke="#2563eb"
            strokeWidth={2.5}
            fill={`url(#${id}-area-grad)`}
            dot={{ r: 3.5, fill: '#2563eb', stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6, fill: '#1d4ed8', stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive={isAnimated}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </GlassChartCard>
  );
}
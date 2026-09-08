import { useId } from 'react';
import BarGradientStops from '@/components/ui/BarGradientStops';
import GlassChartCard from '@/components/ui/GlassChartCard';
import { ResponsiveContainer, Bar, XAxis, YAxis, Tooltip, Line, ComposedChart, CartesianGrid, Legend } from 'recharts';
import { sortByHour } from '@/lib/productionMetrics';

export default function HourlyChart({ grouped, unitLabel = '' }) {
  const id = useId().replace(/:/g, '');
  const isAnimated = process.env.NODE_ENV !== 'test';
  const data = sortByHour(grouped).map((g) => ({
    hora: g.key,
    Produzido: g.produced,
    Meta: g.target,
    Eficiência: g.efficiency,
  }));

  return (
    <GlassChartCard
      title="Produtividade por Hora"
      subtitle={`${unitLabel || 'unidades'} · atingimento no eixo direito`}
      headerClassName="pr-36"
    >
      <ResponsiveContainer width="100%" height={290}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <defs><BarGradientStops id={id} /></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
          <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="volume" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="percent" orientation="right" unit="%" domain={[0, 'auto']} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v, name) => [
              `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${name === 'Atingimento' ? '%' : ` ${unitLabel}`}`,
              name,
            ]}
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
          <Legend
            verticalAlign="top"
            align="left"
            height={36}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingBottom: 12 }}
          />
          <Bar
            yAxisId="volume"
            isAnimationActive={isAnimated}
            animationDuration={1000}
            animationEasing="ease-out"
            maxBarSize={22}
            dataKey="Meta"
            fill={`url(#${id}-target)`}
            radius={[6, 6, 0, 0]}
            name="Meta"
          />
          <Bar
            yAxisId="volume"
            isAnimationActive={isAnimated}
            animationDuration={1000}
            animationEasing="ease-out"
            dataKey="Produzido"
            fill={`url(#${id}-produced)`}
            maxBarSize={22}
            radius={[6, 6, 0, 0]}
            name="Produzido"
          />
          <Line
            type="monotone"
            dataKey="Eficiência"
            stroke="#0284c7"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#0284c7', stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 5 }}
            yAxisId="percent"
            name="Atingimento"
            isAnimationActive={isAnimated}
            animationDuration={1000}
            animationEasing="ease-out"
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </GlassChartCard>
  );
}

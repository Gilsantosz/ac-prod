import GradientBarShape from '@/components/ui/GradientBarShape';
import GlassChartCard from '@/components/ui/GlassChartCard';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from 'recharts';
import { buildPareto } from '@/lib/paretoMetrics';
import { formatDuration } from '@/lib/durationFormat';

export default function ParetoChart({ occurrences }) {
  const data = buildPareto(occurrences);
  const isAnimated = process.env.NODE_ENV !== 'test';

  if (!data.length) {
    return (
      <GlassChartCard
        title="Gráfico de Pareto de Paradas"
        subtitle="Nenhuma ocorrência registrada para o período."
      />
    );
  }

  return (
    <GlassChartCard
      title="Gráfico de Pareto de Paradas"
      subtitle="Motivos ordenados por impacto e % acumulado para priorização"
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
            <XAxis dataKey="reason" angle={-25} textAnchor="end" interval={0} height={60} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tickFormatter={(v) => formatDuration(v)} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip
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
              formatter={(value, name) => name === 'cumulative' ? [`${value}%`, 'Acumulado'] : [formatDuration(value), 'Parada']}
            />
            <ReferenceLine yAxisId="right" y={80} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
            <Bar
              shape={<GradientBarShape />}
              yAxisId="left"
              dataKey="value"
              radius={[6, 6, 0, 0]}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.cumulative <= 80 ? '#f59e0b' : '#94a3b8'} />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulative"
              stroke="#0284c7"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: '#0284c7', stroke: '#fff', strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </GlassChartCard>
  );
}
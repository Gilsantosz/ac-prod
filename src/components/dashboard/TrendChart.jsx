import GlassChartCard from '@/components/ui/GlassChartCard';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { sortByHour } from '@/lib/productionMetrics';

export default function TrendChart({ grouped }) {
  const isAnimated = process.env.NODE_ENV !== 'test';
  const data = sortByHour(grouped).map((g) => ({
    hora: g.key,
    Eficiência: g.efficiency,
    Refugo: g.scrapRate,
  }));

  return (
    <GlassChartCard
      title="Evolução de Eficiência e Refugo"
      subtitle="Identifique gargalos de produtividade ao longo das horas do turno"
      headerClassName="pr-36"
    >
      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
          <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} unit="%" axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v, name) => [`${v}%`, name]}
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
          <ReferenceLine y={100} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5} />
          <Line
            type="monotone"
            dataKey="Eficiência"
            stroke="#0284c7"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: '#0284c7', stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6 }}
            isAnimationActive={isAnimated}
            animationDuration={1000}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="Refugo"
            stroke="#ef4444"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: '#ef4444', stroke: '#fff', strokeWidth: 1.5 }}
            activeDot={{ r: 6 }}
            isAnimationActive={isAnimated}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </GlassChartCard>
  );
}
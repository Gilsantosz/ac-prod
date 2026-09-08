import GlassChartCard from '@/components/ui/GlassChartCard';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CELL_COLORS } from '@/lib/reportMetrics';

export default function CellTrendChart({ cells, rows }) {
  const isAnimated = process.env.NODE_ENV !== 'test';

  return (
    <GlassChartCard
      title="Histórico de Performance por Célula"
      subtitle="Produção mensal de cada célula para identificar sazonalidades."
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
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
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={36}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, paddingBottom: 12 }}
            />
            {cells.map((c, i) => (
              <Line
                key={c}
                type="monotone"
                dataKey={c}
                name={c}
                stroke={CELL_COLORS[i % CELL_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 1.5, stroke: '#fff' }}
                activeDot={{ r: 5 }}
                isAnimationActive={isAnimated}
                animationDuration={1000}
                animationEasing="ease-out"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassChartCard>
  );
}
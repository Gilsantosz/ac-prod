import GlassChartCard from '@/components/ui/GlassChartCard';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function MonthlyTrendChart({ series }) {
  const isAnimated = process.env.NODE_ENV !== 'test';

  return (
    <GlassChartCard
      title="Produtividade Mês a Mês"
      subtitle="Produção, meta e eficiência ao longo dos meses."
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit="%" domain={[0, 100]} axisLine={false} tickLine={false} />
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
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="produced"
              name="Produzido"
              stroke="#10b981"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: '#10b981', stroke: '#fff', strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="target"
              name="Meta"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="efficiency"
              name="Eficiência %"
              stroke="#0284c7"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: '#0284c7', stroke: '#fff', strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassChartCard>
  );
}
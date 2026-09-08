import { useId } from 'react';
import BarGradientStops from '@/components/ui/BarGradientStops';
import GlassChartCard from '@/components/ui/GlassChartCard';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function ShiftCellPanel({ title, subtitle, grouped, unitLabel = '' }) {
  const id = useId().replace(/:/g, '');
  const isAnimated = process.env.NODE_ENV !== 'test';
  const data = grouped.map((g) => ({ nome: g.key, Produzido: g.produced, Meta: g.target, ef: g.efficiency }));

  return (
    <GlassChartCard
      title={title}
      subtitle={subtitle}
      headerClassName="pr-36"
    >
      <div className="max-h-[400px] overflow-y-auto">
        <ResponsiveContainer width="100%" height={Math.max(240, data.length * 58)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <defs><BarGradientStops id={id} horizontal /></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" horizontal={false} vertical={true} />
            <XAxis type="number" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="nome" width={90} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(v, name) => [`${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unitLabel}`, name]}
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
              dataKey="Meta"
              fill={`url(#${id}-target)`}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
              maxBarSize={26}
              radius={[0, 6, 6, 0]}
              name="Meta"
            />
            <Bar
              dataKey="Produzido"
              fill={`url(#${id}-produced)`}
              isAnimationActive={isAnimated}
              animationDuration={1000}
              animationEasing="ease-out"
              maxBarSize={26}
              radius={[0, 6, 6, 0]}
              name="Produzido"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassChartCard>
  );
}
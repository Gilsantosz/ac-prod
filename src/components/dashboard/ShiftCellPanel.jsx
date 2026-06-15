import { Card } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Progress } from '@/components/ui/progress';

export default function ShiftCellPanel({ title, subtitle, grouped }) {
  const data = grouped.map((g) => ({ nome: g.key, Produzido: g.produced, Meta: g.target, ef: g.efficiency }));

  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-5">{subtitle}</p>
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis type="category" dataKey="nome" width={80} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 12,
              fontSize: 13,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            }}
            itemStyle={{ color: 'hsl(var(--foreground))' }}
            labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 'bold' }}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
          />
          <Bar dataKey="Meta" fill="hsl(var(--muted-foreground) / 0.25)" radius={[0, 6, 6, 0]} name="Meta" />
          <Bar dataKey="Produzido" fill="hsl(var(--chart-2))" radius={[0, 6, 6, 0]} name="Produzido" />
        </BarChart>
      </ResponsiveContainer>
      <div className="space-y-3 mt-4">
        {grouped.map((g) => (
          <div key={g.key}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">{g.key}</span>
              <span className="text-muted-foreground tabular-nums">{g.efficiency}% efic.</span>
            </div>
            <Progress value={Math.min(g.efficiency, 100)} className="h-2" />
          </div>
        ))}
      </div>
    </Card>
  );
}
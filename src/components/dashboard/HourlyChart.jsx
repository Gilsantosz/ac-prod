import { Card } from '@/components/ui/card';
import { ResponsiveContainer, Bar, XAxis, YAxis, Tooltip, Line, ComposedChart, CartesianGrid, Cell, Legend } from 'recharts';
import { sortByHour } from '@/lib/productionMetrics';

export default function HourlyChart({ grouped }) {
  const data = sortByHour(grouped).map((g) => ({
    hora: g.key,
    Produzido: g.produced,
    Meta: g.target,
    Eficiência: g.efficiency,
  }));

  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold mb-1">Produtividade por Hora</h3>
      <p className="text-sm text-muted-foreground mb-5">Produzido vs. meta e eficiência ao longo do dia</p>
      <ResponsiveContainer width="100%" height={288}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip 
              contentStyle={{ 
                background: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))', 
                borderRadius: 12, 
                fontSize: 13,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)' 
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
            <Bar dataKey="Meta" fill="hsl(var(--muted-foreground) / 0.25)" radius={[6, 6, 0, 0]} name="Meta" />
            <Bar dataKey="Produzido" radius={[6, 6, 0, 0]} name="Produzido">
              {data.map((d, i) => (
                <Cell key={i} fill={d.Produzido >= d.Meta ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-3))'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="Eficiência" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} yAxisId={0} name="Eficiência" />
          </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
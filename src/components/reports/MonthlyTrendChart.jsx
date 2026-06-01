import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function MonthlyTrendChart({ series }) {
  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold">Produtividade Mês a Mês</h3>
      <p className="text-sm text-muted-foreground mb-4">Produção, meta e eficiência ao longo dos meses.</p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="produced" name="Produzido" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line yAxisId="left" type="monotone" dataKey="target" name="Meta" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="efficiency" name="Eficiência %" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
import { Card } from '@/components/ui/card';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { sortByHour } from '@/lib/productionMetrics';

export default function TrendChart({ grouped }) {
  const data = sortByHour(grouped).map((g) => ({
    hora: g.key,
    Eficiência: g.efficiency,
    Refugo: g.scrapRate,
  }));

  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold mb-1">Evolução de Eficiência e Refugo</h3>
      <p className="text-sm text-muted-foreground mb-5">Identifique gargalos de produtividade ao longo das horas do turno</p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} unit="%" />
            <Tooltip
              formatter={(v) => `${v}%`}
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 13 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="Eficiência" stroke="hsl(var(--chart-2))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="Refugo" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
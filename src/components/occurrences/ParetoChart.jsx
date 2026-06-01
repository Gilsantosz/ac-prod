import { Card } from '@/components/ui/card';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from 'recharts';
import { buildPareto } from '@/lib/paretoMetrics';

export default function ParetoChart({ occurrences }) {
  const data = buildPareto(occurrences);

  if (!data.length) {
    return (
      <Card className="p-6 border-border/60">
        <h3 className="font-semibold mb-1">Gráfico de Pareto de Paradas</h3>
        <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada para o período.</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold mb-1">Gráfico de Pareto de Paradas</h3>
      <p className="text-sm text-muted-foreground mb-5">Motivos ordenados por impacto (min) e % acumulado para priorização</p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="reason" angle={-25} textAnchor="end" interval={0} height={60} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 13 }}
              formatter={(value, name) => name === 'cumulative' ? [`${value}%`, 'Acumulado'] : [`${value} min`, 'Parada']} />
            <ReferenceLine yAxisId="right" y={80} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
            <Bar yAxisId="left" dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.cumulative <= 80 ? 'hsl(var(--chart-3))' : 'hsl(var(--muted))'} />
              ))}
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
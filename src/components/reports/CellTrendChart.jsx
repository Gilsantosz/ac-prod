import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CELL_COLORS } from '@/lib/reportMetrics';

export default function CellTrendChart({ cells, rows }) {
  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold">Histórico de Performance por Célula</h3>
      <p className="text-sm text-muted-foreground mb-4">Produção mensal de cada célula para identificar sazonalidades.</p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
            <Legend />
            {cells.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} name={c} stroke={CELL_COLORS[i % CELL_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
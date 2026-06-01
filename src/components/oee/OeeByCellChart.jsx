import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { BarChart3 } from 'lucide-react';

export default function OeeByCellChart({ rows }) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold">Componentes do OEE por Célula</h3>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 72)}>
        <BarChart data={rows} layout="vertical" barGap={2} margin={{ left: 20, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} fontSize={12} />
          <YAxis type="category" dataKey="cell" width={110} fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'hsl(var(--secondary))', opacity: 0.5 }}
            formatter={(v) => [`${v}%`]}
            contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
          />
          <Legend iconType="circle" />
          <Bar dataKey="availability" name="Disponibilidade" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={12} />
          <Bar dataKey="performance" name="Performance" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={12} />
          <Bar dataKey="quality" name="Qualidade" fill="#16a34a" radius={[0, 4, 4, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
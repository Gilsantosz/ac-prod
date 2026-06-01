import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Layers } from 'lucide-react';

const COLORS = ['#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16'];

export default function TopReasonsByCellChart({ data = [] }) {
  if (data.length === 0) return null;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {data.map((cellData) => (
        <Card key={cellData.cell} className="p-5 border-border/60">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold">Top 5 motivos — {cellData.cell}</h3>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(180, cellData.reasons.length * 44)}>
            <BarChart data={cellData.reasons} layout="vertical" margin={{ left: 10, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
              <XAxis type="number" fontSize={12} tickFormatter={(v) => `${v}m`} />
              <YAxis type="category" dataKey="reason" width={120} fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--secondary))', opacity: 0.5 }}
                formatter={(v) => [`${v} min`, 'Parada']}
                contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
              />
              <Bar dataKey="downtime" radius={[0, 4, 4, 0]} barSize={16}>
                {cellData.reasons.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      ))}
    </div>
  );
}
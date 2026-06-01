import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Wrench } from 'lucide-react';

export default function MttrChart({ data = [] }) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <Wrench className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold">MTTR — Tempo médio de reparo por tipo</h3>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Sem ocorrências no período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 44)}>
          <BarChart data={data} layout="vertical" margin={{ left: 10, right: 40 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
            <XAxis type="number" fontSize={12} tickFormatter={(v) => `${v}m`} />
            <YAxis type="category" dataKey="reason" width={130} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--secondary))', opacity: 0.5 }}
              formatter={(v, n, p) => [`${v} min (${p.payload.count} ocorr.)`, 'MTTR']}
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
            />
            <Bar dataKey="mttr" fill="#7c3aed" radius={[0, 4, 4, 0]} barSize={18}>
              <LabelList dataKey="mttr" position="right" formatter={(v) => `${v}m`} fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
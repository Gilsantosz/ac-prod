import { Card } from '@/components/ui/card';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity } from 'lucide-react';

export default function DowntimeFrequencyChart({ data = [] }) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold">Frequência de ocorrências no tempo</h3>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Sem ocorrências no período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis yAxisId="left" fontSize={12} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `${v}m`} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
            <Legend iconType="circle" />
            <Bar yAxisId="left" dataKey="count" name="Nº ocorrências" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={28} />
            <Line yAxisId="right" type="monotone" dataKey="downtime" name="Parada (min)" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
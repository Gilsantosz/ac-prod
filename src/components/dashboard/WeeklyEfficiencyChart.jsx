import { Card } from '@/components/ui/card';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

export default function WeeklyEfficiencyChart({ data, cellLabel }) {
  return (
    <Card className="border-border/60 p-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold">Evolução da Eficiência (7 dias)</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{cellLabel}</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" fontSize={12} />
          <YAxis fontSize={12} domain={[0, 120]} unit="%" />
          <Tooltip
            formatter={(v) => [`${v}%`, 'Eficiência']}
            labelFormatter={(l) => `Dia ${l}`}
          />
          <ReferenceLine y={100} stroke="#16a34a" strokeDasharray="4 4" />
          <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="efficiency"
            stroke="#2563eb"
            strokeWidth={2.5}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
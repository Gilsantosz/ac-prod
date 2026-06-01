import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitCompare } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CELL_COLORS } from '@/lib/reportMetrics';

const METRICS = [
  { key: 'efficiency', label: 'Eficiência (%)', unit: '%' },
  { key: 'scrapRate', label: 'Taxa de Refugo (%)', unit: '%' },
  { key: 'downtime', label: 'Tempo de Parada (min)', unit: 'min' },
];

export default function CellBenchmark({ benchmark }) {
  const { labels, months, byCell, cells } = benchmark;
  const [selected, setSelected] = useState(cells.slice(0, 2));
  const [metric, setMetric] = useState('efficiency');

  const toggle = (cell) => {
    setSelected((prev) => prev.includes(cell) ? prev.filter((c) => c !== cell) : [...prev, cell]);
  };

  const data = useMemo(() => months.map((k, i) => {
    const row = { label: labels[i] };
    selected.forEach((cell) => {
      row[cell] = byCell[cell]?.[k]?.[metric] ?? null;
    });
    return row;
  }), [months, labels, selected, metric, byCell]);

  if (cells.length < 2) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-1">
        <GitCompare className="w-5 h-5 text-violet-600" />
        <h3 className="font-semibold">Benchmarking de Células</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Selecione células e a métrica para comparar curvas sobrepostas mês a mês.</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {cells.map((cell, i) => {
          const active = selected.includes(cell);
          return (
            <button key={cell} onClick={() => toggle(cell)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${active ? 'text-white border-transparent' : 'text-muted-foreground border-border hover:bg-secondary'}`}
              style={active ? { backgroundColor: CELL_COLORS[i % CELL_COLORS.length] } : undefined}>
              {cell}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {METRICS.map((m) => (
          <Badge key={m.key} onClick={() => setMetric(m.key)}
            className={`cursor-pointer ${metric === m.key ? '' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            variant={metric === m.key ? 'default' : 'secondary'}>
            {m.label}
          </Badge>
        ))}
      </div>

      {selected.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">Selecione ao menos uma célula.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))' }} />
            <Legend />
            {selected.map((cell) => {
              const ci = cells.indexOf(cell);
              return (
                <Line key={cell} type="monotone" dataKey={cell} name={cell}
                  stroke={CELL_COLORS[ci % CELL_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
import { useState, useMemo } from 'react';
import GlassChartCard from '@/components/ui/GlassChartCard';
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
    <GlassChartCard
      title="Benchmarking de Células"
      subtitle="Selecione células e a métrica para comparar curvas sobrepostas mês a mês."
      icon={GitCompare}
    >
      <div className="flex flex-wrap gap-2 mb-3">
        {cells.map((cell, i) => {
          const active = selected.includes(cell);
          return (
            <button key={cell} onClick={() => toggle(cell)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${active ? 'text-white border-transparent shadow-sm' : 'text-muted-foreground border-border hover:bg-secondary'}`}
              style={active ? { backgroundColor: CELL_COLORS[i % CELL_COLORS.length] } : undefined}>
              {cell}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {METRICS.map((m) => (
          <Badge key={m.key} onClick={() => setMetric(m.key)}
            className={`cursor-pointer ${metric === m.key ? '' : 'bg-secondary/70 text-secondary-foreground hover:bg-secondary'}`}
            variant={metric === m.key ? 'default' : 'secondary'}>
            {m.label}
          </Badge>
        ))}
      </div>

      {selected.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border/60 rounded-xl">Selecione ao menos uma célula.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card) / 0.92)',
                backdropFilter: 'blur(8px)',
                border: '1px solid hsl(var(--border) / 0.7)',
                borderRadius: 12,
                fontSize: 13,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
              }}
              itemStyle={{ color: 'hsl(var(--foreground))' }}
              labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 'bold' }}
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={36}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, paddingBottom: 12 }}
            />
            {selected.map((cell) => {
              const ci = cells.indexOf(cell);
              return (
                <Line
                  key={cell}
                  type="monotone"
                  dataKey={cell}
                  name={cell}
                  stroke={CELL_COLORS[ci % CELL_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 1.5, stroke: '#fff' }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={process.env.NODE_ENV !== 'test'}
                  animationDuration={1000}
                  animationEasing="ease-out"
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </GlassChartCard>
  );
}
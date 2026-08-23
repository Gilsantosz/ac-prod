import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarRange, Gauge, Loader2, Package, Target, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buildAnnualProductionSummary } from '@/lib/dashboardPeriod';

function SummaryMetric({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/35 p-3.5">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
        {label}
      </div>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

export default function AnnualProductionSummary({ entries = [], year, chartRef, loading = false }) {
  const summary = useMemo(
    () => buildAnnualProductionSummary(entries, year),
    [entries, year],
  );
  const { months, totals } = summary;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card ref={chartRef} className="relative border-border/60 p-5 sm:p-6">
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-card/90 text-sm text-muted-foreground backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
            Carregando resumo anual de {year}…
          </div>
        )}
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10">
              <CalendarRange className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <h3 className="font-semibold">Resumo Anual de Produção — {year}</h3>
              <p className="text-sm text-muted-foreground">Produção, meta e eficiência consolidadas mês a mês</p>
            </div>
          </div>
          <Badge variant="secondary" className="w-fit">12 meses</Badge>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryMetric icon={Package} label="Produzido no ano" value={totals.produced.toLocaleString('pt-BR')} accent="text-sky-600" />
          <SummaryMetric icon={Target} label="Meta anual" value={totals.target.toLocaleString('pt-BR')} accent="text-violet-600" />
          <SummaryMetric icon={Gauge} label="Eficiência anual" value={`${totals.efficiency}%`} accent="text-emerald-600" />
          <SummaryMetric icon={Trash2} label="Refugo anual" value={`${totals.scrapRate}%`} accent="text-amber-600" />
        </div>

        {totals.records === 0 && totals.target === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            Nenhum dado encontrado para {year} com os filtros selecionados.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={310}>
              <ComposedChart data={months} margin={{ top: 8, right: 0, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis yAxisId="quantity" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis yAxisId="percent" orientation="right" unit="%" domain={[0, 'auto']} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  formatter={(value, name) => name === 'Eficiência' ? `${value}%` : Number(value).toLocaleString('pt-BR')}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.name || label}
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="quantity" dataKey="target" name="Meta" fill="hsl(var(--muted-foreground) / 0.25)" radius={[5, 5, 0, 0]} />
                <Bar yAxisId="quantity" dataKey="produced" name="Produzido" fill="hsl(var(--chart-2))" radius={[5, 5, 0, 0]} />
                <Line yAxisId="percent" type="monotone" dataKey="efficiency" name="Eficiência" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {months.map((month) => (
                <div key={month.index} className="rounded-lg bg-secondary/35 p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">{month.label}</p>
                  <p className={`font-semibold tabular-nums ${
                    month.target === 0 ? 'text-muted-foreground' :
                    month.efficiency >= 90 ? 'text-emerald-600' :
                    month.efficiency >= 70 ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {month.target === 0 && month.produced === 0 ? '—' : `${month.efficiency}%`}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </motion.div>
  );
}

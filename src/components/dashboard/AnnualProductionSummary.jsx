import { BarGradients } from '@/components/reports/ProductionAnalysisCharts';
import { useMemo, useId } from 'react';
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
import { CalendarRange, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buildAnnualProductionSummary } from '@/lib/dashboardPeriod';
import { aggregateAnalysis, normalizeAnalysisEntries } from '@/lib/operationalAnalysis';

export default function AnnualProductionSummary({ entries = [], year, chartRef, unitLabel = '', loading = false }) {
  const gradientId = useId().replace(/:/g, '');
  const summary = useMemo(
    () => buildAnnualProductionSummary(entries, year),
    [entries, year],
  );
  const { totals } = summary;
  const months = useMemo(() => {
    const groups = aggregateAnalysis(normalizeAnalysisEntries(entries), (e) => Number(e.date.slice(5, 7)) - 1);
    return summary.months.map((month) => {
      const group = groups.find((g) => g.key === month.index);
      return { ...month, produced: group?.produced ?? null, target: group?.target ?? null, attainment: group?.attainment ?? null };
    });
  }, [entries, summary]);

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
              <p className="text-sm text-muted-foreground">{unitLabel} · produzido e meta por mês · atingimento no eixo direito</p>
            </div>
          </div>
          <Badge variant="secondary" className="w-fit">12 meses</Badge>
        </div>

        {totals.records === 0 && totals.target === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            Nenhum dado encontrado para {year} com os filtros selecionados.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={310}>
              <ComposedChart data={months} margin={{ top: 8, right: 0, left: -16, bottom: 0 }}>
                <BarGradients id={gradientId} />
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis yAxisId="quantity" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis yAxisId="percent" orientation="right" unit="%" domain={[0, 'auto']} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  formatter={(value, name) => name === 'Atingimento' ? `${value}%` : `${Number(value).toLocaleString('pt-BR')} ${unitLabel}`}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.name || label}
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="quantity" dataKey="target" name="Meta" fill={`url(#${gradientId}-target)`} isAnimationActive={false} radius={[5, 5, 0, 0]} />
                <Bar yAxisId="quantity" dataKey="produced" name="Produzido" fill={`url(#${gradientId}-produced)`} isAnimationActive={false} radius={[5, 5, 0, 0]} />
                <Line yAxisId="percent" type="monotone" dataKey="attainment" name="Atingimento" isAnimationActive={false} connectNulls={false} stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>

          </>
        )}
      </Card>
    </motion.div>
  );
}

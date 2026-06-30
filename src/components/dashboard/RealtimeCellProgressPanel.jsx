import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Zap, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

async function fetchCellCounters(date) {
  const { data, error } = await supabase
    .from('production_realtime_counters')
    .select('cell_name, approved_quantity, rejected_quantity, blocked_quantity, pending_quantity, planned_quantity, metric_unit_label, updated_at')
    .eq('date', date);
  if (error) throw error;
  return data || [];
}

function aggregateByCell(rows) {
  const map = {};
  for (const row of rows) {
    const cell = (row.cell_name || '').trim();
    if (!cell) continue;
    if (!map[cell]) {
      map[cell] = {
        cell,
        approved: 0,
        rejected: 0,
        blocked: 0,
        pending: 0,
        planned: 0,
        unitLabel: row.metric_unit_label || 'un.',
        updatedAt: row.updated_at,
      };
    }
    map[cell].approved  += Number(row.approved_quantity)  || 0;
    map[cell].rejected  += Number(row.rejected_quantity)  || 0;
    map[cell].blocked   += Number(row.blocked_quantity)   || 0;
    map[cell].pending   += Number(row.pending_quantity)   || 0;
    map[cell].planned   += Number(row.planned_quantity)   || 0;
    if (row.updated_at > map[cell].updatedAt) map[cell].updatedAt = row.updated_at;
  }
  return Object.values(map).sort((a, b) => b.approved - a.approved);
}

function CellRow({ cell, approved, rejected, blocked, pending, planned, unitLabel, highlight }) {
  const total = approved + rejected + blocked + pending;
  // Se há meta definida usa ela, senão usa total produzido como "100%"
  const base = planned > 0 ? planned : Math.max(total, approved, 1);
  const pct  = Math.min(100, Math.round((approved / base) * 100));
  const rejPct = total > 0 ? Math.round((rejected / total) * 100) : 0;
  const done = planned > 0 && approved >= planned;

  const barColor =
    pct >= 90 ? '[&>div]:bg-emerald-500' :
    pct >= 70 ? '[&>div]:bg-amber-500'   :
    pct > 0   ? '[&>div]:bg-sky-500'     :
    '[&>div]:bg-muted-foreground/20';

  const pctColor =
    pct >= 90 ? 'text-emerald-600 dark:text-emerald-400' :
    pct >= 70 ? 'text-amber-500'  :
    pct > 0   ? 'text-sky-500'    :
    'text-muted-foreground';

  return (
    <div className={`rounded-xl border p-3 transition-colors ${
      highlight
        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/30'
        : 'border-border/40 bg-secondary/30'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{cell}</span>
          {done && (
            <Badge className="text-[10px] shrink-0 bg-emerald-600 hover:bg-emerald-600 gap-1">
              <CheckCircle2 className="w-3 h-3" /> Meta batida
            </Badge>
          )}
          {highlight && !done && (
            <Badge className="text-[10px] shrink-0 bg-sky-500 hover:bg-sky-500">Atual</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-sm">
          <span className="tabular-nums text-muted-foreground hidden sm:inline">
            {approved.toLocaleString('pt-BR')}
            {planned > 0 ? ` / ${planned.toLocaleString('pt-BR')} ${unitLabel}` : ` ${unitLabel}`}
          </span>
          <span className={`font-bold tabular-nums ${pctColor}`}>{pct}%</span>
        </div>
      </div>

      {/* Barra de progresso */}
      <Progress value={pct} className={barColor} />

      {/* Linha de detalhes */}
      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          {approved.toLocaleString('pt-BR')} aprovadas
        </span>
        {rejected > 0 && (
          <span className="flex items-center gap-1 text-red-500">
            <XCircle className="w-3 h-3" />
            {rejected.toLocaleString('pt-BR')} rejeitadas ({rejPct}%)
          </span>
        )}
        {pending > 0 && (
          <span className="flex items-center gap-1 text-amber-500">
            <Clock className="w-3 h-3" />
            {pending.toLocaleString('pt-BR')} pendentes
          </span>
        )}
        {planned > 0 && (
          <span className="ml-auto">
            {pct}% da meta diária
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * RealtimeCellProgressPanel
 * Mostra barras de progresso por célula lidas de production_realtime_counters.
 * Funciona sem daily_goals — usa o total aprovado como referência quando não há meta.
 */
export default function RealtimeCellProgressPanel({ date, kioskCell = 'all', filterCell = 'all' }) {
  const today = date || format(new Date(), 'yyyy-MM-dd');

  const { data: rows = [] } = useQuery({
    queryKey: ['realtimeCounters', 'cell', today],
    queryFn: () => fetchCellCounters(today),
    staleTime: 0,
    refetchOnMount: true,
    refetchInterval: 15_000, // atualiza a cada 15s
  });

  const cells = useMemo(() => {
    const agg = aggregateByCell(rows);
    if (filterCell && filterCell !== 'all') return agg.filter(c => c.cell === filterCell);
    return agg;
  }, [rows, filterCell]);

  if (!cells.length) return null;

  const totalApproved = cells.reduce((s, c) => s + c.approved, 0);
  const totalRejected = cells.reduce((s, c) => s + c.rejected, 0);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-5 border-border/60">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h3 className="font-semibold leading-tight">Produção em Tempo Real por Célula</h3>
              <p className="text-xs text-muted-foreground">
                Peças aprovadas hoje · atualiza automaticamente
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 tabular-nums">
              {totalApproved.toLocaleString('pt-BR')} aprovadas
            </Badge>
            {totalRejected > 0 && (
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 tabular-nums">
                {totalRejected.toLocaleString('pt-BR')} rejeitadas
              </Badge>
            )}
          </div>
        </div>

        {/* Rows */}
        <div className="space-y-2.5">
          {cells.map((c) => (
            <CellRow
              key={c.cell}
              {...c}
              highlight={kioskCell !== 'all' && c.cell === kioskCell}
            />
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Layers3, PackageCheck, UsersRound } from 'lucide-react';
import GlassChartPanel from '@/components/charts/GlassChartPanel';
import { supabase } from '@/lib/supabaseClient';

export async function fetchPcpBatchProgress(lotIds = []) {
  if (!lotIds.length) return [];
  const batches = new Map();
  for (let offset = 0; offset < lotIds.length; offset += 100) {
    const { data, error } = await supabase.from('promob_import_batches')
      .select(`id, general_lot_code, file_name, status, total_parts,
        completed_parts, pending_parts, progress_percent, total_operations, completed_operations,
        client_lots_count, customers_count, imported_at, created_at, production_lots!inner(id)`)
      .in('production_lots.id', lotIds.slice(offset, offset + 100))
      .in('status', ['parsed', 'processed'])
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    (data || []).forEach((batch) => batches.set(batch.id, batch));
  }
  return [...batches.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function formatPercent(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function GeneralLotProgressPanel({ lotIds = [] }) {
  const reduceMotion = useReducedMotion();
  const { data: batches = [], isLoading, isError } = useQuery({
    queryKey: ['pcp-batches', 'dashboard', lotIds],
    queryFn: () => fetchPcpBatchProgress(lotIds),
    enabled: lotIds.length > 0,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
  const visible = batches.slice(0, 8);
  const totalPieces = visible.reduce((sum, batch) => sum + Number(batch.total_parts || 0), 0);
  const completedPieces = visible.reduce((sum, batch) => sum + Number(batch.completed_parts || 0), 0);
  const clientLots = visible.reduce((sum, batch) => sum + Number(batch.client_lots_count || 0), 0);
  const aggregatePercent = clampPercent(totalPieces > 0
    ? (completedPieces / totalPieces) * 100
    : visible.length
      ? visible.reduce((sum, batch) => sum + clampPercent(batch.progress_percent), 0) / visible.length
      : 0);

  return (
    <GlassChartPanel
      title="Andamento dos lotes gerais PCP"
      subtitle="Progresso consolidado e detalhamento dos lotes presentes no recorte selecionado."
      icon={Layers3}
      controls={false}
    >
      <div className="mb-4 rounded-2xl border border-blue-500/15 bg-blue-500/[0.055] p-4 shadow-inner shadow-blue-950/[0.03]">
        <div className="mb-2 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Lote geral</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {completedPieces.toLocaleString('pt-BR')} de {totalPieces.toLocaleString('pt-BR')} peças finalizadas
            </p>
          </div>
          <strong className="text-2xl font-black tabular-nums tracking-tight text-blue-600 dark:text-blue-400">
            {formatPercent(aggregatePercent)}%
          </strong>
        </div>
        <div
          className="h-3 overflow-hidden rounded-full border border-blue-500/10 bg-blue-950/5 dark:bg-blue-50/10"
          role="progressbar"
          aria-label="Progresso consolidado do lote geral"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(aggregatePercent.toFixed(2))}
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 shadow-[0_0_18px_rgba(14,165,233,0.35)]"
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${aggregatePercent}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Summary icon={Layers3} label="Lotes clientes" value={clientLots} />
        <Summary icon={PackageCheck} label="Peças finais" value={`${completedPieces}/${totalPieces}`} />
        <Summary icon={UsersRound} label="Lotes gerais" value={visible.length} />
      </div>

      {isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os lotes do recorte.</p> : isLoading ? (
        <p className="py-5 text-center text-xs text-muted-foreground">Carregando lotes PCP…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/50 py-5 text-center text-xs text-muted-foreground">
          Nenhum lote PCP vinculado aos registros selecionados.
        </p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {visible.map((batch, index) => {
            const percent = clampPercent(batch.progress_percent);
            return (
              <motion.div
                key={batch.id}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduceMotion ? 0 : index * 0.045, duration: reduceMotion ? 0 : 0.32 }}
                className="space-y-1.5 rounded-xl border border-border/50 bg-background/35 px-3 py-2.5 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground">Lote geral </span>
                    <span className="font-mono font-bold text-foreground">{batch.general_lot_code || batch.file_name || '—'}</span>
                    <span className="text-muted-foreground"> · {Number(batch.client_lots_count || 0)} lotes de clientes</span>
                  </div>
                  <strong className="shrink-0 tabular-nums text-blue-600 dark:text-blue-400">{formatPercent(percent)}%</strong>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(percent.toFixed(2))}>
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400"
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ delay: reduceMotion ? 0 : 0.08 + index * 0.04, duration: reduceMotion ? 0 : 0.72, ease: 'easeOut' }}
                  />
                </div>
                <div className="flex justify-between gap-3 text-[10px] text-muted-foreground">
                  <span>{Number(batch.completed_operations || 0)}/{Number(batch.total_operations || 0)} operações concluídas</span>
                  <span>{Number(batch.completed_parts || 0)}/{Number(batch.total_parts || 0)} peças finalizadas</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </GlassChartPanel>
  );
}

function Summary({ icon: Icon, label, value }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-background/35 px-3 py-2 backdrop-blur-sm">
      <Icon className="h-4 w-4 shrink-0 text-blue-500" />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-foreground">{value}</p>
        <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

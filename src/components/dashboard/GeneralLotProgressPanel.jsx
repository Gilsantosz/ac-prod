import { useQuery } from '@tanstack/react-query';
import { Layers3, PackageCheck, UsersRound } from 'lucide-react';
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

export default function GeneralLotProgressPanel({ lotIds = [] }) {
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
  const overallPercent = totalPieces > 0 ? ((completedPieces / totalPieces) * 100).toFixed(2) : '0.00';

  return (
    <div className="rounded-2xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-card/75 backdrop-blur-md p-5 sm:p-6 space-y-5 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.25)] transition-all">
      {/* Cabeçalho com recuo à direita para não colidir com os controles flutuantes do painel */}
      <div className="pr-48 sm:pr-56">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers3 className="w-5 h-5 text-blue-500 shrink-0" />
          <h3 className="font-semibold text-base text-foreground tracking-tight">Andamento dos lotes gerais PCP</h3>
          <span className="text-xs font-semibold rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2.5 py-0.5 border border-blue-500/20">
            {visible.length} lote{visible.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Lotes com produção no recorte selecionado. As barras mostram o progresso total atual de cada lote.
        </p>
      </div>

      {visible.length > 0 && (
        <div className="rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 p-4 space-y-3 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-blue-500/15 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-500/20">
                <Layers3 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400">
                    Lote Geral
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">· Progresso Consolidado</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <strong className="text-foreground font-semibold tabular-nums">{completedPieces.toLocaleString('pt-BR')}</strong> de{' '}
                  <strong className="text-foreground font-semibold tabular-nums">{totalPieces.toLocaleString('pt-BR')}</strong> peças finalizadas
                </p>
              </div>
            </div>

            <div className="flex items-baseline gap-1.5 self-start sm:self-auto shrink-0 bg-white/80 dark:bg-card/80 px-3.5 py-1.5 rounded-xl border border-blue-200/50 dark:border-blue-800/40 shadow-xs">
              <span className="text-2xl sm:text-3xl font-black text-blue-600 dark:text-blue-400 tracking-tight tabular-nums">
                {overallPercent}%
              </span>
              <span className="text-xs text-muted-foreground font-medium">concluído</span>
            </div>
          </div>

          <div className="h-3 w-full rounded-full bg-secondary/60 dark:bg-secondary/40 overflow-hidden p-0.5 border border-border/30">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-sky-500 to-indigo-600 shadow-[0_0_12px_rgba(59,130,246,0.4)] transition-all duration-1000 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, Number(overallPercent)))}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Summary icon={Layers3} label="Lotes clientes" value={clientLots} />
        <Summary icon={PackageCheck} label="Peças finais" value={`${completedPieces}/${totalPieces}`} />
        <Summary icon={UsersRound} label="Lotes gerais" value={visible.length} />
      </div>

      {isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os lotes do recorte.</p> : isLoading ? (
        <p className="text-xs text-muted-foreground py-5 text-center">Carregando lotes PCP…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-5 text-center border border-dashed border-border/50 rounded-xl">
          Nenhum lote PCP vinculado aos registros selecionados.
        </p>
      ) : (
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {visible.map((batch) => {
            const percent = Math.max(0, Math.min(100, Number(batch.progress_percent || 0)));
            return (
              <div key={batch.id} className="rounded-xl border border-border/50 bg-secondary/20 dark:bg-secondary/15 px-3.5 py-3 space-y-2 hover:bg-secondary/30 transition-colors">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground">Lote geral </span>
                    <span className="font-mono font-bold text-foreground">{batch.general_lot_code || batch.file_name || '—'}</span>
                    <span className="text-muted-foreground"> · {Number(batch.client_lots_count || 0)} lotes de clientes</span>
                  </div>
                  <strong className="text-blue-600 dark:text-blue-400 shrink-0 font-semibold">{percent}%</strong>
                </div>
                <div className="h-2 rounded-full bg-secondary/80 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-700 ease-out" style={{ width: `${percent}%` }} />
                </div>
                <div className="flex justify-between gap-3 text-[10px] text-muted-foreground">
                  <span>{Number(batch.completed_operations || 0)}/{Number(batch.total_operations || 0)} operações concluídas</span>
                  <span>{Number(batch.completed_parts || 0)}/{Number(batch.total_parts || 0)} peças finalizadas</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-secondary/30 dark:bg-secondary/20 border border-border/40 px-3.5 py-2.5 flex items-center gap-3 min-w-0">
      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{value}</p>
        <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Layers3, PackageCheck, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

async function fetchPcpBatchProgress() {
  const { data, error } = await supabase
    .from('promob_import_batches')
    .select(`
      id, general_lot_code, file_name, status, total_parts,
      completed_parts, pending_parts, progress_percent,
      total_operations, completed_operations,
      client_lots_count, customers_count, imported_at, created_at
    `)
    .in('status', ['parsed', 'processed'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    if (['42703', '42P01'].includes(error.code)) return [];
    throw error;
  }
  return data || [];
}

export default function GeneralLotProgressPanel() {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['pcp-batches'],
    queryFn: fetchPcpBatchProgress,
    initialData: [],
    refetchInterval: 20000,
  });

  const active = batches.filter((batch) => Number(batch.progress_percent || 0) < 100);
  const visible = (active.length ? active : batches).slice(0, 8);
  const totalPieces = visible.reduce((sum, batch) => sum + Number(batch.total_parts || 0), 0);
  const completedPieces = visible.reduce((sum, batch) => sum + Number(batch.completed_parts || 0), 0);
  const clientLots = visible.reduce((sum, batch) => sum + Number(batch.client_lots_count || 0), 0);

  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Andamento dos lotes gerais PCP</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Consolidação em tempo real das peças coletadas em todas as células e máquinas.
          </p>
        </div>
        <span className="text-xs font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2.5 py-1">
          {visible.length} lote{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Summary icon={Layers3} label="Lotes clientes" value={clientLots} />
        <Summary icon={PackageCheck} label="Peças finais" value={`${completedPieces}/${totalPieces}`} />
        <Summary icon={UsersRound} label="Lotes gerais" value={visible.length} />
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground py-5 text-center">Carregando lotes PCP…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground py-5 text-center border border-dashed border-border/50 rounded-xl">
          Nenhum lote geral PCP importado.
        </p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {visible.map((batch) => {
            const percent = Math.max(0, Math.min(100, Number(batch.progress_percent || 0)));
            return (
              <div key={batch.id} className="rounded-xl border border-border/50 bg-secondary/15 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground">Lote geral </span>
                    <span className="font-mono font-bold text-foreground">{batch.general_lot_code || batch.file_name || '—'}</span>
                    <span className="text-muted-foreground"> · {Number(batch.client_lots_count || 0)} lotes de clientes</span>
                  </div>
                  <strong className="text-blue-600 dark:text-blue-400 shrink-0">{percent}%</strong>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${percent}%` }} />
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
    <div className="rounded-xl bg-secondary/30 border border-border/40 px-3 py-2 flex items-center gap-2 min-w-0">
      <Icon className="w-4 h-4 text-blue-500 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{value}</p>
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  );
}

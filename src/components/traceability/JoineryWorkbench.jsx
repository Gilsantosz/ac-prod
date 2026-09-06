import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { fetchReadyJoineryLots } from '@/lib/manualJoineryService';
import { fetchJoineryLotPieces, joineryPieceState, summarizeJoinery } from '@/lib/joineryMonitoring';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { translateStage } from '@/hooks/useTraceability';

export default function JoineryWorkbench() {
  const qc = useQueryClient();
  // Keep the selected lot after its final piece leaves the queue so completion is visible.
  const [selectedLot, setSelectedLot] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const lots = useQuery({ queryKey: ['joinery-lots'], queryFn: fetchReadyJoineryLots, refetchInterval: 15000 });
  const details = useQuery({
    queryKey: ['joinery-monitor', selectedLot?.id],
    queryFn: () => fetchJoineryLotPieces({ lotId: selectedLot?.lot_id, pieceIds: selectedLot?.lot_items.map((p) => p.id) }),
    enabled: !!selectedLot,
    staleTime: 1000,
    refetchInterval: 15000,
  });

  useEffect(() => {
    let timer;
    const refresh = () => {
      // Coalesce bursts without postponing refresh indefinitely during continuous scans.
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ queryKey: ['joinery-lots'] });
        void qc.invalidateQueries({ queryKey: ['joinery-monitor'] });
      }, 300);
    };
    const channel = supabase.channel(`joinery-monitor-${globalThis.crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_pieces', filter: 'current_stage=eq.joinery' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'production_stage_readings', filter: 'step_name=eq.joinery' }, refresh);
    // A stage-filtered UPDATE cannot see a piece after it leaves joinery.
    if (selectedLot?.lot_id) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'production_pieces', filter: `lot_id=eq.${selectedLot.lot_id}` }, refresh);
    channel.subscribe((state) => { if (state === 'SUBSCRIBED') refresh(); });
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [qc, selectedLot?.lot_id]);

  const pieces = details.data || [];
  const summary = summarizeJoinery(pieces);
  const filtered = pieces.filter((piece) => (status === 'all' || joineryPieceState(piece).key === status)
    && [piece.piece_name, piece.traceability_code, piece.piece_uid].some((value) => String(value || '').toLowerCase().includes(search.toLowerCase())));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1));
  const visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50);
  const refresh = () => { void lots.refetch(); if (selectedLot) void details.refetch(); };

  return <div className="space-y-5">
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-semibold">Acompanhamento da Marcenaria</h2><p className="text-sm text-muted-foreground">Esta página é somente para consulta. A produção e a liberação são registradas em Coleta / Bipagem, na célula Marcenaria.</p><p className="text-xs text-muted-foreground mt-1">Peças sem etiqueta: utilize o identificador interno no modo manual da Coleta / Bipagem.</p></div>
      <div className="flex gap-2"><Button asChild><Link to="/coleta">Ir para Coleta / Bipagem</Link></Button><Button variant="outline" onClick={refresh} disabled={lots.isFetching || details.isFetching}><RefreshCw className="h-4 w-4 mr-2" />Atualizar</Button></div>
    </div>
    <div className="grid lg:grid-cols-3 gap-5 items-start">
      <aside className="space-y-3"><h3 className="font-semibold">Lotes com peças na Marcenaria</h3>
        {lots.isLoading ? <p>Carregando lotes…</p> : lots.isError ? <p role="alert" className="text-destructive">Não foi possível atualizar os lotes. Tente Atualizar.</p> : !lots.data?.length ? <p className="text-sm text-muted-foreground">Nenhuma peça na Marcenaria no momento.</p> : null}
        <div className="space-y-2 max-h-[65vh] overflow-y-auto">{(lots.data || []).map((lot) => <button key={lot.id} onClick={() => { setSelectedLot(lot); setPage(0); setStatus('all'); setSearch(''); }} className={cn('w-full rounded-xl border p-4 text-left bg-card', selectedLot?.id === lot.id && 'border-emerald-500 bg-emerald-500/5')}>
          <p className="font-semibold">{lot.lot_code}</p><p className="text-xs text-muted-foreground">{lot.production_orders?.customer_name} · Lote geral {lot.general_lot_code || '—'}</p><Badge variant="outline" className="mt-2">{lot.lot_items.length} peça(s) na célula</Badge>
        </button>)}</div>
      </aside>
      <section className="lg:col-span-2 min-w-0 space-y-4">
        {!selectedLot ? <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">Selecione um lote para acompanhar as peças e as liberações.</p> : <>
          <div className="rounded-2xl border bg-card p-5 space-y-3"><h3 className="font-semibold">Lote {selectedLot.lot_code}</h3><p className="text-sm text-muted-foreground">Andamento da etapa Marcenaria no lote selecionado, incluindo peças que ainda estão em etapas anteriores.</p>
            {details.isLoading ? <p>Carregando peças…</p> : details.isError ? <p role="alert" className="text-destructive">Falha ao atualizar as peças. Os dados anteriores podem estar desatualizados.</p> : <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[['Aguardando coleta', summary.pending], ['Com ocorrência', summary.issue], ['Etapa anterior', summary.upstream], ['Marcenaria concluída', summary.released]].map(([label, value]) => <div key={label} className="rounded-xl bg-secondary/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
              <Progress value={summary.percent} className="[&>div]:bg-gradient-to-r [&>div]:from-emerald-400 [&>div]:to-emerald-700" /><p className="text-sm">{summary.released} de {summary.total} peças concluídas na Marcenaria · {summary.percent}%</p>
              {summary.excluded > 0 && <p className="text-xs text-muted-foreground">{summary.excluded} cancelada(s) ou substituída(s), fora do cálculo.</p>}
            </>}
          </div>
          <div className="flex flex-wrap gap-2"><input aria-label="Buscar peça" placeholder="Nome ou código da peça" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="rounded-lg border bg-background p-2 text-sm flex-1 min-w-0" /><select aria-label="Status da Marcenaria" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="rounded-lg border bg-background p-2 text-sm"><option value="all">Todos os status</option><option value="pending">Aguardando coleta</option><option value="issue">Com ocorrência</option><option value="upstream">Etapa anterior</option><option value="released">Marcenaria concluída</option><option value="excluded">Canceladas / substituídas</option></select></div>
          <div className="space-y-2">{visible.map((piece) => <article key={piece.id} className="rounded-xl border bg-card p-4 flex flex-wrap justify-between items-start gap-3"><div className="min-w-0"><p className="font-medium">{piece.piece_name || piece.piece_uid}</p><p className="text-xs font-mono break-all text-muted-foreground">{piece.traceability_code || piece.piece_uid}</p><p className="text-xs text-muted-foreground">{[piece.material, piece.color, piece.width && piece.height && `${piece.width} × ${piece.height} mm`].filter(Boolean).join(' · ')}</p><p className="text-xs text-muted-foreground mt-1">Etapa atual: {translateStage(piece.current_stage)}</p></div><Badge variant="outline" className={cn('whitespace-normal', joineryPieceState(piece).key === 'released' && 'text-emerald-700 border-emerald-500/40', joineryPieceState(piece).key === 'issue' && 'text-destructive border-destructive/40')}>{joineryPieceState(piece).label}</Badge></article>)}</div>
          {!details.isLoading && !details.isError && !visible.length && <p className="text-sm text-muted-foreground">Nenhuma peça para os filtros selecionados.</p>}
          {filtered.length > 50 && <div className="flex items-center gap-3"><Button variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Anterior</Button><span className="text-sm">Página {currentPage + 1} de {Math.ceil(filtered.length / 50)}</span><Button variant="outline" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Próxima</Button></div>}
        </>}
      </section>
    </div>
  </div>;
}

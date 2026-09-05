/**
 * Workbench de Marcenaria — Leo Flow MES Leo Madeiras
 * Regra crítica: peças que exigem Marcenaria não podem avançar para Separação
 * antes que a Marcenaria esteja concluída.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import {
  fetchManualJoineryPieces,
  completeManualJoineryPiece,
  fetchReadyJoineryLots,
  completeReadyJoineryPiece,
} from '@/lib/manualJoineryService';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Wrench, CheckCircle, RefreshCw, UserRound, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function JoineryWorkbench({ _trace }) {
  const qc = useQueryClient();
  const [selectedLotId, setSelectedLotId] = useState(null);
  const { session: operatorSession, setContext } = useOperatorSession();

  // ─── Peças canônicas liberadas para a Marcenaria ──────────────
  const {
    data: joineryLots = [],
    isLoading,
    isError,
    error: joineryError,
    refetch: refetchJoineryLots,
  } = useQuery({
    queryKey: ['joinery-lots'],
    queryFn: fetchReadyJoineryLots,
    refetchInterval: 15000,
  });

  // Entrada na etapa e conclusão feita por outros postos aparecem sem reload.
  // O polling de 15 s permanece como fallback caso o Realtime esteja indisponível.
  useEffect(() => {
    const suffix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`joinery-workbench-${suffix}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'production_pieces',
        filter: 'current_stage=eq.joinery',
      }, () => qc.invalidateQueries({ queryKey: ['joinery-lots'] }))
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'production_stage_readings',
        filter: 'step_name=eq.joinery',
      }, () => qc.invalidateQueries({ queryKey: ['joinery-lots'] }))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  useEffect(() => {
    if (selectedLotId && !joineryLots.some((lot) => lot.id === selectedLotId)) {
      setSelectedLotId(null);
    }
  }, [joineryLots, selectedLotId]);

  const selectedLot = joineryLots.find(l => l.id === selectedLotId);
  const joineryItems = selectedLot?.lot_items || [];
  const pendingCount = joineryItems.length;
  const readyPieceCount = joineryLots.reduce((total, lot) => total + (lot.lot_items?.length || 0), 0);

  const ensureJoineryContext = async () => {
    if (!operatorSession?.token) throw new Error('Faça o login operacional antes da baixa.');

    const joineryCell = (operatorSession.cells || []).find((cell) => {
      const name = String(cell?.name || cell || '').trim().toLowerCase();
      const type = String(cell?.type || '').trim().toLowerCase();
      return name === 'marcenaria' || type === 'joinery';
    });
    const joineryCellId = joineryCell?.id;
    if (!joineryCellId) {
      throw new Error('O operador não possui uma célula Marcenaria válida no cadastro.');
    }

    if (operatorSession.selected_cell_id === joineryCellId) return operatorSession;
    return setContext(joineryCellId, null, 'Bancada Marcenaria');
  };

  // ─── Concluir peça individual na Marcenaria ───────────────────
  const finishItem = useMutation({
    mutationFn: async ({ piece }) => {
      const activeSession = await ensureJoineryContext();
      return completeReadyJoineryPiece(piece, activeSession);
    },
    onSuccess: async (_result, { piece }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['joinery-lots'] }),
        qc.invalidateQueries({ queryKey: ['production-lots'] }),
        qc.invalidateQueries({ queryKey: ['trace-search'] }),
        qc.invalidateQueries({ queryKey: ['collection-history'] }),
        qc.invalidateQueries({ queryKey: ['collection-kpis'] }),
      ]);
      await auditLog(AUDIT_ACTIONS.STEP_FINISH, 'production_piece', piece.id, {
        step: 'joinery', item: piece.piece_name || piece.traceability_code
      });
      toast.success(`✅ ${piece.piece_name || piece.traceability_code} — Marcenaria concluída!`);
    },
    onError: (e) => toast.error(e?.message || 'Falha ao concluir a peça na Marcenaria.'),
  });

  // ─── Concluir TODA a Marcenaria do lote de uma vez ────────────
  const finishAllJoinery = useMutation({
    mutationFn: async (lot) => {
      const pendingItems = lot?.lot_items || [];
      if (pendingItems.length === 0) throw new Error('Nenhuma peça pendente');
      const activeSession = await ensureJoineryContext();
      let completed = 0;
      try {
        for (const piece of pendingItems) {
          await completeReadyJoineryPiece(piece, activeSession);
          completed += 1;
        }
      } catch (error) {
        throw new Error(`${completed} de ${pendingItems.length} peças concluídas. ${error?.message || 'Falha na baixa.'}`);
      }
      return { completed };
    },
    onSuccess: async ({ completed }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['joinery-lots'] }),
        qc.invalidateQueries({ queryKey: ['production-lots'] }),
        qc.invalidateQueries({ queryKey: ['trace-search'] }),
        qc.invalidateQueries({ queryKey: ['collection-history'] }),
        qc.invalidateQueries({ queryKey: ['collection-kpis'] }),
      ]);
      toast.success(`🎉 ${completed} peça(s) concluída(s). O lote pode avançar para Separação.`);
    },
    onError: (e) => toast.error(e?.message),
  });

  return (
    <div className="space-y-5">
      <ManualJoineryQueue ensureJoineryContext={ensureJoineryContext} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lista de Lotes com Marcenaria ──────────────────────── */}
      <div className="lg:col-span-1 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Lotes liberados para Marcenaria
          </h3>
          <Badge variant="outline" className="text-xs">
            {readyPieceCount} peça(s)
          </Badge>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
            <RefreshCw className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-3 text-rose-600">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-xs font-medium">{joineryError?.message || 'Falha ao carregar a fila da Marcenaria.'}</p>
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => refetchJoineryLots()}>
              <RefreshCw className="w-3 h-3 mr-1.5" /> Tentar novamente
            </Button>
          </div>
        ) : joineryLots.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <Wrench className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhuma peça liberada para Marcenaria no momento</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {joineryLots.map(lot => {
              const lotJoineryItems = lot.lot_items || [];
              const isSelected = lot.id === selectedLotId;
              const order = lot.production_orders;

              return (
                <button
                  key={lot.id}
                  onClick={() => setSelectedLotId(lot.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-xl border transition-all duration-150',
                    isSelected
                      ? 'border-amber-400/60 bg-amber-50/30 dark:bg-amber-950/20 shadow-sm'
                      : 'border-border/50 bg-card hover:border-border/80 hover:bg-secondary/20'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-foreground">{lot.lot_code}</p>
                      <p className="text-xs text-muted-foreground truncate">{order?.customer_name}</p>
                      {lot.general_lot_code && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">Lote geral: {lot.general_lot_code}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Wrench className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-xs font-medium text-amber-600">{lotJoineryItems.length} pç</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Workbench do Lote Selecionado ─────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {!selectedLotId ? (
          <div className="text-center py-20 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
            <Wrench className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Selecione um lote para gerenciar a Marcenaria</p>
            <p className="text-sm mt-1">Aqui você controla as peças que precisam passar pela Marcenaria</p>
          </div>
        ) : (
          <>
            {/* Header do workbench */}
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-foreground">{selectedLot?.lot_code}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedLot?.production_orders?.customer_name} · {selectedLot?.production_orders?.order_code}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-100 dark:bg-amber-900/30 px-3 py-1.5 rounded-full">
                  <Wrench className="w-3.5 h-3.5" />
                  {pendingCount} peça(s) aguardando produção
                </span>
              </div>

              {pendingCount > 0 && (
                <Button
                  size="sm"
                  className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => finishAllJoinery.mutate(selectedLot)}
                  disabled={finishAllJoinery.isPending}
                >
                  {finishAllJoinery.isPending
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle className="w-3.5 h-3.5" />
                  }
                  Concluir peças liberadas do lote
                </Button>
              )}
            </div>

            {/* Lista de peças de marcenaria */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Peças de Marcenaria ({joineryItems.length})
              </h4>
              {joineryItems.map(item => (
                  <div
                    key={item.id}
                    className="border rounded-xl p-3.5 flex items-center gap-3 transition-all bg-card border-border/60 hover:border-amber-300/60"
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/30">
                      <Wrench className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {item.piece_name || item.traceability_code || item.piece_uid}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          item.width > 0 && item.height > 0 && `${item.width}×${item.height}mm`,
                          item.thickness > 0 && `esp. ${item.thickness}mm`,
                          item.material,
                          item.color,
                        ].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {item.traceability_code || item.piece_uid}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                      onClick={() => finishItem.mutate({ piece: item })}
                      disabled={finishItem.isPending || finishAllJoinery.isPending}
                    >
                      {finishItem.isPending && finishItem.variables?.piece?.id === item.id
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <CheckCircle className="w-3 h-3" />}
                      Concluir
                    </Button>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function ManualJoineryQueue({ ensureJoineryContext }) {
  const qc = useQueryClient();
  const { session: operatorSession } = useOperatorSession();
  const { data: pieces = [], isLoading } = useQuery({
    queryKey: ['manual-joinery-pieces'],
    queryFn: fetchManualJoineryPieces,
    initialData: [],
    refetchInterval: 15000,
  });

  const finishPiece = useMutation({
    mutationFn: async (piece) => {
      const activeSession = await ensureJoineryContext();
      return completeManualJoineryPiece(piece, activeSession);
    },
    onSuccess: async (_result, piece) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['manual-joinery-pieces'] }),
        qc.invalidateQueries({ queryKey: ['production-lots'] }),
        qc.invalidateQueries({ queryKey: ['trace-search'] }),
        qc.invalidateQueries({ queryKey: ['collection-history'] }),
        qc.invalidateQueries({ queryKey: ['collection-kpis'] }),
      ]);
      toast.success(`${piece.piece_name || piece.piece_uid} — baixa da Marcenaria registrada.`);
    },
    onError: (error) => toast.error(error?.message || 'Falha na baixa manual da Marcenaria.'),
  });

  return (
    <section className="rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/10 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <Wrench className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">Peças especiais — baixa manual Marcenaria</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sem código de barras físico. Cada baixa atualiza histórico, KPIs, gráficos e o andamento dos dois níveis de lote.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card/70 border border-border/50 rounded-lg px-3 py-2">
          <UserRound className="w-3.5 h-3.5 text-amber-600" />
          <span>{operatorSession?.name || 'Operador não identificado'}</span>
          <Badge variant="outline" className="h-5 text-[10px]">{pieces.length} pendentes</Badge>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando peças especiais…
        </div>
      ) : pieces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhuma peça especial aguardando baixa manual na Marcenaria.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
          {pieces.map((piece) => (
            <div key={piece.id} className="rounded-xl border border-border/60 bg-card p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate" title={piece.piece_name}>
                  {piece.piece_name || piece.piece_uid}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Lote geral <strong className="text-foreground">{piece.batch?.general_lot_code || '—'}</strong>
                  {' · '}Lote cliente <strong className="text-foreground">{piece.lot?.lot_code || '—'}</strong>
                </p>
                <p className="text-[10px] font-mono text-muted-foreground truncate" title={piece.piece_uid}>
                  {piece.piece_uid}
                </p>
              </div>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                disabled={finishPiece.isPending || !operatorSession?.id}
                onClick={() => finishPiece.mutate(piece)}
              >
                {finishPiece.isPending && finishPiece.variables?.id === piece.id
                  ? <RefreshCw className="w-3 h-3 animate-spin" />
                  : <CheckCircle className="w-3 h-3" />}
                Dar baixa
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

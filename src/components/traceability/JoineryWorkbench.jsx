/**
 * Workbench de Marcenaria — Leo Flow MES Leo Madeiras
 * Regra crítica: peças que exigem Marcenaria não podem avançar para Separação
 * antes que a Marcenaria esteja concluída.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Wrench, CheckCircle, Clock, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function JoineryWorkbench({ _trace }) {
  const qc = useQueryClient();
  const [lotFilter] = useState('pending');
  const [selectedLotId, setSelectedLotId] = useState(null);

  // ─── Lotes com itens de Marcenaria ────────────────────────────
  const { data: joineryLots = [], isLoading } = useQuery({
    queryKey: ['joinery-lots', lotFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_lots')
        .select(`
          id, lot_code, current_stage, status, blocked_reason,
          production_orders:production_orders!production_order_id (order_code, customer_name, delivery_date),
          lot_items!inner (
            id, piece_name, piece_code, width, height, thickness,
            material, color, status, requires_joinery, quantity
          )
        `)
        .eq('lot_items.requires_joinery', true)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
    refetchInterval: 20000,
    initialData: [],
  });

  // ─── Eventos de marcenaria para o lote selecionado ───────────
  const { data: joineryEvents = [] } = useQuery({
    queryKey: ['joinery-events', selectedLotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lot_step_events')
        .select('*, profiles(name)')
        .eq('lot_id', selectedLotId)
        .eq('step_code', 'joinery')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedLotId,
    initialData: [],
  });

  const selectedLot = joineryLots.find(l => l.id === selectedLotId);
  const joineryItems = selectedLot?.lot_items?.filter(i => i.requires_joinery) || [];
  const completedItemIds = new Set(
    joineryEvents.filter(e => e.event_type === 'finish').map(e => e.lot_item_id)
  );

  const pendingCount  = joineryItems.filter(i => !completedItemIds.has(i.id)).length;
  const completedCount = joineryItems.filter(i => completedItemIds.has(i.id)).length;
  const allDone = pendingCount === 0 && joineryItems.length > 0;

  // ─── Concluir peça individual na Marcenaria ───────────────────
  const finishItem = useMutation({
    mutationFn: async ({ lotItemId, lotId, itemName }) => {
      const { error } = await supabase.from('lot_step_events').insert({
        lot_id:      lotId,
        lot_item_id: lotItemId,
        step_code:   'joinery',
        event_type:  'finish',
        notes:       `Marcenaria concluída: ${itemName}`,
        quantity:    1,
      });
      if (error) throw error;
      return { lotItemId, itemName };
    },
    onSuccess: async ({ itemName }) => {
      qc.invalidateQueries({ queryKey: ['joinery-events', selectedLotId] });
      qc.invalidateQueries({ queryKey: ['production-lots'] });
      await auditLog(AUDIT_ACTIONS.STEP_FINISH, 'lot_item', selectedLotId, {
        step: 'joinery', item: itemName
      });
      toast.success(`✅ ${itemName} — Marcenaria concluída!`);
    },
    onError: (e) => toast.error(e?.message),
  });

  // ─── Concluir TODA a Marcenaria do lote de uma vez ────────────
  const finishAllJoinery = useMutation({
    mutationFn: async (lot) => {
      const pendingItems = joineryItems.filter(i => !completedItemIds.has(i.id));
      const events = pendingItems.map(item => ({
        lot_id:      lot.id,
        lot_item_id: item.id,
        step_code:   'joinery',
        event_type:  'finish',
        notes:       'Marcenaria concluída em lote',
        quantity:    item.quantity || 1,
      }));
      if (events.length === 0) throw new Error('Nenhuma peça pendente');
      const { error } = await supabase.from('lot_step_events').insert(events);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['joinery-events', selectedLotId] });
      qc.invalidateQueries({ queryKey: ['production-lots'] });
      toast.success('🎉 Todas as peças de Marcenaria concluídas! O lote pode avançar para Separação.');
    },
    onError: (e) => toast.error(e?.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lista de Lotes com Marcenaria ──────────────────────── */}
      <div className="lg:col-span-1 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Lotes com Marcenaria
          </h3>
          <Badge variant="outline" className="text-xs">
            {joineryLots.length}
          </Badge>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
            <RefreshCw className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        ) : joineryLots.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <Wrench className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum lote com Marcenaria no momento</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {joineryLots.map(lot => {
              const lotJoineryItems = lot.lot_items?.filter(i => i.requires_joinery) || [];
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
                    </div>
                    <div className="flex items-center gap-1">
                      <Wrench className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-xs font-medium text-amber-600">{lotJoineryItems.length} pç</span>
                    </div>
                  </div>
                  {order?.delivery_date && (
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      Entrega: {new Date(order.delivery_date).toLocaleDateString('pt-BR')}
                    </p>
                  )}
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
                {allDone && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1.5 rounded-full">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Marcenaria Concluída — Pode ir para Separação
                  </span>
                )}
              </div>

              {/* Progresso */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{completedCount}/{joineryItems.length} peças concluídas</span>
                  <span>{Math.round((completedCount / Math.max(joineryItems.length, 1)) * 100)}%</span>
                </div>
                <div className="h-2 bg-secondary/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{ width: `${(completedCount / Math.max(joineryItems.length, 1)) * 100}%` }}
                  />
                </div>
              </div>

              {!allDone && (
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
                  Concluir Toda a Marcenaria
                </Button>
              )}
            </div>

            {/* Lista de peças de marcenaria */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Peças de Marcenaria ({joineryItems.length})
              </h4>
              {joineryItems.map(item => {
                const isDone = completedItemIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'border rounded-xl p-3.5 flex items-center gap-3 transition-all',
                      isDone
                        ? 'bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200/60 dark:border-emerald-800/40'
                        : 'bg-card border-border/60 hover:border-amber-300/60'
                    )}
                  >
                    <div className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                      isDone ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-amber-100 dark:bg-amber-900/30'
                    )}>
                      {isDone
                        ? <CheckCircle className="w-4 h-4 text-emerald-600" />
                        : <Wrench className="w-4 h-4 text-amber-600" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-sm font-medium',
                        isDone ? 'text-muted-foreground line-through' : 'text-foreground'
                      )}>
                        {item.piece_name || item.piece_code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          item.width > 0 && item.height > 0 && `${item.width}×${item.height}mm`,
                          item.thickness > 0 && `esp. ${item.thickness}mm`,
                          item.material,
                          item.color,
                        ].filter(Boolean).join(' · ')}
                        {item.quantity > 1 && <> · <strong>×{item.quantity}</strong></>}
                      </p>
                    </div>
                    {!isDone && (
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                        onClick={() => finishItem.mutate({
                          lotItemId: item.id,
                          lotId:     selectedLotId,
                          itemName:  item.piece_name || item.piece_code,
                        })}
                        disabled={finishItem.isPending}
                      >
                        <CheckCircle className="w-3 h-3" /> Concluir
                      </Button>
                    )}
                    {isDone && (
                      <span className="text-xs text-emerald-600 font-medium shrink-0">✓ Pronto</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

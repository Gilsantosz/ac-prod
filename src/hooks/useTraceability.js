/**
 * Hook principal de Rastreabilidade — Leo Flow MES Leo Madeiras
 * Centraliza queries, mutations e lógica de negócio do Kanban de lotes.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';

// ─── Estágios do Kanban ──────────────────────────────────────
export const KANBAN_STAGES = [
  { code: 'imported',         label: 'Importado',         color: 'text-slate-600',  bg: 'bg-slate-100 dark:bg-slate-800' },
  { code: 'released',         label: 'Liberado',          color: 'text-sky-600',    bg: 'bg-sky-100 dark:bg-sky-900/40' },
  { code: 'cut',              label: 'Corte',             color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/40' },
  { code: 'edge',             label: 'Bordo',             color: 'text-blue-600',   bg: 'bg-blue-100 dark:bg-blue-900/40' },
  { code: 'cnc',              label: 'Usinagem',          color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/40' },
  { code: 'joinery',          label: 'Marcenaria',        color: 'text-amber-600',  bg: 'bg-amber-100 dark:bg-amber-900/40' },
  { code: 'separation',       label: 'Separação',         color: 'text-teal-600',   bg: 'bg-teal-100 dark:bg-teal-900/40' },
  { code: 'packaging',        label: 'Embalagem',         color: 'text-green-600',  bg: 'bg-green-100 dark:bg-green-900/40' },
  { code: 'waiting_shipping', label: 'Aguardando Envio',  color: 'text-indigo-600', bg: 'bg-indigo-100 dark:bg-indigo-900/40' },
  { code: 'shipping',         label: 'Expedição',         color: 'text-violet-600', bg: 'bg-violet-100 dark:bg-violet-900/40' },
  { code: 'completed',        label: 'Finalizado',        color: 'text-emerald-600',bg: 'bg-emerald-100 dark:bg-emerald-900/40' },
];

export const STAGE_NEXT = {
  imported:         'released',
  released:         'cut',
  cut:              'edge',
  edge:             'cnc',
  cnc:              'joinery',
  joinery:          'separation',
  separation:       'packaging',
  packaging:        'waiting_shipping',
  waiting_shipping: 'shipping',
  shipping:         'completed',
};

// ─── Hook principal ──────────────────────────────────────────
export function useTraceability({ stageFilter = null, searchQuery = '', dateRange: _dateRange = null } = {}) {
  const qc = useQueryClient();

  // ─── Ordens de Produção ─────────────────────────────────────
  const orders = useQuery({
    queryKey: ['production-orders'],
    queryFn: () => base44.entities.ProductionOrder.list('-created_at', 100),
    initialData: [],
  });

  // ─── Lotes (com filtros) ─────────────────────────────────────
  const lots = useQuery({
    queryKey: ['production-lots', stageFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('production_lots')
        .select(`
          *,
          production_orders (id, order_code, customer_name, delivery_date, status),
          lot_items (id, piece_name, status, requires_joinery, requires_cnc, requires_edge, quantity)
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      if (stageFilter && stageFilter !== 'all') {
        query = query.eq('current_stage', stageFilter);
      }
      if (searchQuery) {
        query = query.or(
          `lot_code.ilike.%${searchQuery}%,production_orders.order_code.ilike.%${searchQuery}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    initialData: [],
    refetchInterval: 30000,  // atualiza a cada 30s (produção em tempo real)
  });

  // ─── Lotes agrupados por estágio (Kanban) ───────────────────
  const lotsByStage = KANBAN_STAGES.reduce((acc, stage) => {
    acc[stage.code] = lots.data.filter(lot => lot.current_stage === stage.code);
    return acc;
  }, {});

  // ─── Mutation: Avançar lote de etapa ─────────────────────────
  const advanceLot = useMutation({
    mutationFn: async ({ lot, targetStage, notes }) => {
      // Regra de Negócio 3: Separação só se marcenaria concluída
      if (targetStage === 'separation') {
        const joineryItems = lot.lot_items?.filter(i => i.requires_joinery) || [];
        if (joineryItems.length > 0) {
          // Verifica se todos os itens de marcenaria estão concluídos
          const { data: events } = await supabase
            .from('lot_step_events')
            .select('id, lot_item_id')
            .eq('lot_id', lot.id)
            .eq('step_code', 'joinery')
            .eq('event_type', 'finish');

          const completedJoineryIds = new Set(events?.map(e => e.lot_item_id));
          const pendingJoinery = joineryItems.filter(i => !completedJoineryIds.has(i.id));

          if (pendingJoinery.length > 0) {
            throw new Error(
              `⚠️ ${pendingJoinery.length} peça(s) pendentes em Marcenaria. ` +
              `Finalize a Marcenaria antes de mover para Separação.`
            );
          }
        }
      }

      // Registra evento de movimentação
      await supabase.from('lot_step_events').insert({
        lot_id:     lot.id,
        step_code:  targetStage,
        event_type: 'start',
        notes:      notes || `Lote avançado para ${KANBAN_STAGES.find(s => s.code === targetStage)?.label}`,
        quantity:   lot.lot_items?.length || 0,
      });

      // Atualiza estágio do lote
      const { error } = await supabase
        .from('production_lots')
        .update({ current_stage: targetStage, updated_at: new Date().toISOString() })
        .eq('id', lot.id);

      if (error) throw error;
      return { lot, targetStage };
    },
    onSuccess: async ({ lot, targetStage }) => {
      qc.invalidateQueries({ queryKey: ['production-lots'] });
      await auditLog(AUDIT_ACTIONS.LOT_UPDATE, 'production_lot', lot.id, {
        from: lot.current_stage, to: targetStage
      });
      toast.success(`Lote ${lot.lot_code} avançado para ${KANBAN_STAGES.find(s => s.code === targetStage)?.label}`);
    },
    onError: (e) => toast.error(e?.message || 'Falha ao mover lote'),
  });

  // ─── Mutation: Bloquear lote ─────────────────────────────────
  const blockLot = useMutation({
    mutationFn: async ({ lotId, reason }) => {
      await supabase.from('lot_step_events').insert({
        lot_id: lotId, step_code: 'blocked', event_type: 'block', notes: reason, quantity: 0,
      });
      const { error } = await supabase
        .from('production_lots')
        .update({ status: 'blocked', blocked_reason: reason })
        .eq('id', lotId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-lots'] });
      toast.warning('Lote bloqueado. Notificação enviada aos gestores.');
    },
    onError: (e) => toast.error(e?.message),
  });

  // ─── Mutation: Desbloquear lote ──────────────────────────────
  const unblockLot = useMutation({
    mutationFn: async ({ lotId, notes }) => {
      await supabase.from('lot_step_events').insert({
        lot_id: lotId, step_code: 'unblocked', event_type: 'unblock', notes, quantity: 0,
      });
      const { error } = await supabase
        .from('production_lots')
        .update({ status: 'in_progress', blocked_reason: null })
        .eq('id', lotId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-lots'] });
      toast.success('Lote desbloqueado com sucesso.');
    },
    onError: (e) => toast.error(e?.message),
  });

  // ─── Stats ───────────────────────────────────────────────────
  const stats = {
    total:      lots.data.length,
    blocked:    lots.data.filter(l => l.status === 'blocked').length,
    late:       lots.data.filter(l => {
      if (!l.production_orders?.delivery_date) return false;
      return new Date(l.production_orders.delivery_date) < new Date() &&
             l.current_stage !== 'completed';
    }).length,
    completed:  lots.data.filter(l => l.current_stage === 'completed').length,
    withJoinery: lots.data.filter(l =>
      l.lot_items?.some(i => i.requires_joinery)
    ).length,
  };

  return {
    orders,
    lots,
    lotsByStage,
    stats,
    advanceLot,
    blockLot,
    unblockLot,
    refetch: () => {
      lots.refetch();
      orders.refetch();
    },
  };
}

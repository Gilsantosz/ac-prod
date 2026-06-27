import { useState } from 'react';
import { STAGE_NEXT, KANBAN_STAGES } from '@/hooks/useTraceability';
import { Button } from '@/components/ui/button';
import {
  ChevronRight, AlertCircle, Lock, Unlock,
  Calendar, Wrench, Clock, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotCard({ lot, _stage, onAdvance, onBlock, onUnblock }) {
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  const order = lot.production_orders;
  const items = lot.lot_items || [];
  const isBlocked = lot.status === 'blocked';
  const hasJoinery = items.some(i => i.requires_joinery);
  const hasCnc = items.some(i => i.requires_cnc);
  const isLate = order?.delivery_date && new Date(order.delivery_date) < new Date()
    && lot.current_stage !== 'completed';

  const nextStage = STAGE_NEXT[lot.current_stage];
  const nextStageLabel = KANBAN_STAGES.find(s => s.code === nextStage)?.label;

  const handleBlock = () => {
    if (!blockReason.trim()) return;
    onBlock(blockReason);
    setBlockReason('');
    setShowBlockModal(false);
  };

  return (
    <div className={cn(
      'bg-card border rounded-xl p-3 space-y-2.5 transition-all duration-200',
      'hover:shadow-md hover:border-border/80',
      isBlocked && 'border-red-300 dark:border-red-800/60 bg-red-50/30 dark:bg-red-950/10',
      isLate && !isBlocked && 'border-amber-300 dark:border-amber-800/60',
    )}>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-foreground truncate">{lot.lot_code}</p>
          <p className="text-xs text-muted-foreground truncate">
            {order?.customer_name || '—'} · {order?.order_code}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isBlocked && <Lock className="w-3.5 h-3.5 text-red-500" />}
          {isLate    && <Clock className="w-3.5 h-3.5 text-amber-500" />}
        </div>
      </div>

      {/* ── Tags de operações ─────────────────────────────────── */}
      <div className="flex flex-wrap gap-1">
        {hasJoinery && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-0.5">
            <Wrench className="w-2.5 h-2.5" /> Marc.
          </span>
        )}
        {hasCnc && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 flex items-center gap-0.5">
            <Layers className="w-2.5 h-2.5" /> CNC
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-muted-foreground">
          {items.length} pç
        </span>
        {order?.delivery_date && (
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5',
            isLate
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30'
              : 'bg-secondary/60 text-muted-foreground'
          )}>
            <Calendar className="w-2.5 h-2.5" />
            {new Date(order.delivery_date).toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      {/* ── Aviso de bloqueio ─────────────────────────────────── */}
      {isBlocked && lot.blocked_reason && (
        <div className="flex items-start gap-1.5 p-2 bg-red-50 dark:bg-red-950/30 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400 leading-tight">{lot.blocked_reason}</p>
        </div>
      )}

      {/* ── Ações ─────────────────────────────────────────────── */}
      <div className="flex gap-1.5 pt-1">
        {isBlocked ? (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs gap-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-800/60 dark:hover:bg-emerald-950/20"
            onClick={() => onUnblock('Desbloqueado manualmente')}
          >
            <Unlock className="w-3 h-3" /> Desbloquear
          </Button>
        ) : (
          <>
            {nextStage && (
              <Button
                size="sm"
                className="flex-1 h-7 text-xs gap-1 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
                onClick={onAdvance}
              >
                {nextStageLabel} <ChevronRight className="w-3 h-3" />
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
              onClick={() => setShowBlockModal(true)}
            >
              <Lock className="w-3 h-3" />
            </Button>
          </>
        )}
      </div>

      {/* ── Modal de bloqueio (inline simples) ───────────────── */}
      {showBlockModal && (
        <div className="space-y-2 pt-1 border-t border-border/60">
          <p className="text-xs font-medium text-red-600">Motivo do bloqueio:</p>
          <textarea
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            placeholder="Ex: Peça faltando, aguardando material..."
            className="w-full text-xs rounded-lg border border-border/60 p-2 bg-background resize-none h-16"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShowBlockModal(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-6 text-xs bg-red-600 hover:bg-red-700 text-white" onClick={handleBlock}>
              Bloquear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

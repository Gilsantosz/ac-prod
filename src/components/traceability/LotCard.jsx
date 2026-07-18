import { useState } from 'react';
import { STAGE_NEXT, KANBAN_STAGES, translateStage } from '@/hooks/useTraceability';
import { Button } from '@/components/ui/button';
import {
  ChevronRight, AlertCircle, Lock, Unlock,
  Calendar, Wrench, Clock, Layers, CheckCircle2, MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotCard({ lot, _stage, onAdvance, onBlock, onUnblock }) {
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  const order = lot.production_orders || {};
  const items = lot.production_lot_items || lot.lot_items || [];
  const progress = lot.traceability_progress || {};
  const routeProgress = lot.route_progress || [];
  const isBlocked = lot.status === 'blocked';
  const hasJoinery = routeProgress.some(step => ['joinery', 'marcenaria'].includes(String(step.stage_code || step.step_name || '').toLowerCase()))
    || items.some(i => i.requires_joinery);
  const hasCnc = routeProgress.some(step => ['cnc', 'usinagem'].includes(String(step.stage_code || step.step_name || '').toLowerCase()))
    || items.some(i => i.requires_cnc);
  const dueDate = order?.delivery_date || order?.finalization_date;
  const isLate = dueDate && new Date(dueDate) < new Date()
    && lot.current_stage !== 'completed';

  const nextStage = STAGE_NEXT[lot.current_stage];
  const nextStageLabel = KANBAN_STAGES.find(s => s.code === nextStage)?.label;
  const total = Number(progress.total || items.length || lot.planned_quantity || 0);
  const collected = Number(progress.completed || 0);
  const pending = Number(progress.pending || Math.max(0, total - collected));
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));

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
            {order?.customer_trade_name || order?.customer_name || '—'} · {order?.order_number || order?.order_code || lot.order_number || '—'}
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
          {total} pç
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300 flex items-center gap-0.5">
          <CheckCircle2 className="w-2.5 h-2.5" /> {collected} colet.
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300">
          {pending} faltam
        </span>
        {dueDate && (
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5',
            isLate
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30'
              : 'bg-secondary/60 text-muted-foreground'
          )}>
            <Calendar className="w-2.5 h-2.5" />
            {new Date(dueDate).toLocaleDateString('pt-BR')}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span className="truncate">Atual: {translateStage(lot.current_step)}</span>
          <strong className="text-foreground">{percent}%</strong>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-[#2d9c4a]" style={{ width: `${percent}%` }} />
        </div>
        {lot.current_cell && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 shrink-0" /> {lot.current_cell}
          </p>
        )}
      </div>

      {routeProgress.length > 0 && (
        <div className="space-y-1 border-t border-border/60 pt-2">
          {routeProgress.slice(0, 4).map((step) => (
            <div key={step.id || `${step.step_order}-${step.step_name}`} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-muted-foreground">{translateStage(step.step_name)}</span>
              <span className={cn(
                'font-semibold shrink-0',
                step.pending === 0 ? 'text-emerald-600' : step.collected > 0 ? 'text-amber-600' : 'text-muted-foreground'
              )}>
                {step.collected}/{step.total}
              </span>
            </div>
          ))}
          {routeProgress.length > 4 && (
            <p className="text-[10px] text-muted-foreground">+ {routeProgress.length - 4} etapas na rota</p>
          )}
        </div>
      )}

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

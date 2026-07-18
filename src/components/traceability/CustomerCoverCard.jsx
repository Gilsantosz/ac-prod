import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Package, Truck, Layers, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CustomerCoverCard({ cover, onActionClick, onCancelClick, isAdminOrManager = false }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusMap = {
    planned: { label: 'Planejado', color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400' },
    in_production: { label: 'Em Produção', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    ready_to_pack: { label: 'Pronto p/ Embalar', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    packing: { label: 'Embalando', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
    packed: { label: 'Embalado', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    shipping: { label: 'Em Expedição', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
    shipped: { label: 'Expedido', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    blocked: { label: 'Bloqueado', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    cancelled: { label: 'Cancelado', color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
  };

  const statusInfo = statusMap[cover.status] || { label: cover.status, color: 'bg-slate-100 text-slate-700' };

  // Parse lot codes string to array
  const lotCodes = cover.lot_codes ? cover.lot_codes.split(', ') : [];

  return (
    <div className={cn(
      'bg-card border border-border/40 rounded-2xl p-4.5 space-y-4 shadow-sm hover:shadow-md transition-all duration-250',
      cover.status === 'blocked' && 'border-red-300 dark:border-red-800/60 bg-red-50/20',
      cover.status === 'shipped' && 'border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/10'
    )}>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-muted-foreground">{cover.cover_code}</span>
            <Badge className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border-none', statusInfo.color)}>
              {statusInfo.label}
            </Badge>
          </div>
          <h3 className="font-bold text-base text-foreground mt-1 truncate" title={cover.customer_name_exact}>
            {cover.customer_name_exact}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lote Geral PCP: <strong className="text-foreground">{cover.general_lot_code}</strong>
          </p>
        </div>

        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 hover:bg-secondary/60 rounded-xl text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* ── Progress Indicators ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 border-y border-border/40 py-3 text-xs">
        <div className="space-y-1.5">
          <div className="flex justify-between text-muted-foreground font-medium">
            <span>Embalagem</span>
            <strong className="text-foreground">{Math.round(cover.packing_progress || 0)}%</strong>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full transition-all duration-300" style={{ width: `${cover.packing_progress || 0}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {cover.packed_pieces} de {cover.planned_pieces} pçs embaladas
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-muted-foreground font-medium">
            <span>Produção Geral</span>
            <strong className="text-foreground">{Math.round(cover.production_progress || 0)}%</strong>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-[#2d9c4a] rounded-full transition-all duration-300" style={{ width: `${cover.production_progress || 0}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {cover.started_pieces} pçs em processo
          </p>
        </div>
      </div>

      {/* ── Expanded Lot Details ─────────────────────────────── */}
      {isExpanded && (
        <div className="space-y-2.5 animate-fadeIn">
          <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> Lotes Associados ({cover.total_lots})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {lotCodes.map((code) => (
              <div key={code} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/40 border border-border/30">
                <span className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                <span className="font-semibold text-foreground truncate">{code}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground pt-1.5">
            <span className="px-2 py-0.5 rounded-md bg-secondary/50 flex items-center gap-1">
              <Package className="w-3 h-3" /> {cover.closed_volumes} Vol. Fechados
            </span>
            {cover.open_volumes > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 dark:bg-orange-950/20 dark:text-orange-400 font-medium">
                {cover.open_volumes} Vol. Abertos
              </span>
            )}
            <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {cover.shipped_pieces} pçs expedidas
            </span>
          </div>
        </div>
      )}

      {/* ── Actions Footer ───────────────────────────────────── */}
      <div className="flex gap-2 pt-1 justify-end">
        {isAdminOrManager && cover.status !== 'shipped' && cover.status !== 'cancelled' && (
          <Button 
            size="sm" 
            variant="outline" 
            className="text-xs h-8 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onCancelClick(cover)}
          >
            Cancelar Capa
          </Button>
        )}
        {cover.status === 'packed' && onActionClick && (
          <Button 
            size="sm" 
            className="text-xs h-8 gap-1.5 bg-[#2d9c4a] hover:bg-[#25813d] text-white flex-1 sm:flex-initial"
            onClick={() => onActionClick(cover)}
          >
            <Truck className="w-3.5 h-3.5" /> Expedir Capa
          </Button>
        )}
        {cover.status === 'ready_to_pack' && onActionClick && (
          <Button 
            size="sm" 
            className="text-xs h-8 gap-1.5 bg-orange-500 hover:bg-orange-600 text-white flex-1 sm:flex-initial"
            onClick={() => onActionClick(cover)}
          >
            <Package className="w-3.5 h-3.5" /> Embalar Capa
          </Button>
        )}
      </div>
    </div>
  );
}

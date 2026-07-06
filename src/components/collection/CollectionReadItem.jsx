import { Clock, AlertTriangle, Layers, User, MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function CollectionReadItem({
  read,
  isSelected,
  onSelect,
  onReject,
  onOpenTraceability,
  canReject = false
}) {
  const isRejected = read.event_status === 'rejected';
  const isBlocked = read.event_status === 'blocked' || read.event_status === 'duplicated';
  const isRework = read.event_status === 'rework';
  const isApproved = read.event_status === 'approved';

  const formatHour = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toTimeString().slice(0, 5);
    } catch (_) {
      return read.hour || '';
    }
  };

  const getStatusBadge = () => {
    if (isRejected) return <Badge className="bg-rose-500 text-white border-0 text-[10px]">REPROVADA</Badge>;
    if (isBlocked) return <Badge className="bg-amber-500 text-white border-0 text-[10px]">BLOQUEADA</Badge>;
    if (isRework) return <Badge className="bg-purple-500 text-white border-0 text-[10px]">RETRABALHO</Badge>;
    if (isApproved) return <Badge className="bg-emerald-500 text-white border-0 text-[10px]">APROVADA</Badge>;
    return <Badge variant="outline" className="text-[10px]">{read.event_status}</Badge>;
  };

  return (
    <div
      onClick={() => onSelect(read)}
      className={cn(
        'w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer space-y-2.5 flex flex-col justify-between hover:translate-y-[-1px] select-none',
        isSelected
          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm ring-1 ring-emerald-500/15'
          : 'border-border/50 bg-card hover:border-border/80'
      )}
    >
      {/* Topo do card: Horário, Código e Status */}
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-bold text-muted-foreground">{formatHour(read.created_at)}</span>
          <span className="font-extrabold text-xs text-foreground font-mono truncate max-w-[120px]" title={read.traceability_code}>
            {read.traceability_code}
          </span>
        </div>
        {getStatusBadge()}
      </div>

      {/* Lote / Pedido / Cliente */}
      <div className="space-y-0.5">
        <p className="text-[11px] font-bold text-foreground">
          {read.lot_code} <span className="text-muted-foreground font-medium">· Pedido {read.order_number}</span>
        </p>
        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">
          {read.client_name}
        </p>
      </div>

      {/* Etapa atual e Operador */}
      <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1.5 border-t border-border/40 gap-2">
        <span className="truncate">
          Etapa: <strong className="text-foreground">{read.current_stage_name}</strong>
        </span>
        <span className="flex items-center gap-1 shrink-0 font-medium">
          <User className="w-3 h-3 text-muted-foreground/80" /> {read.operator_name}
        </span>
      </div>

      {/* Ações rápidas no card */}
      <div className="flex gap-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
        {canReject && !isRejected && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(read)}
            className="text-[10px] h-7 px-2.5 rounded-lg border-rose-500/30 text-rose-600 hover:bg-rose-500/10 font-bold"
          >
            Reprovar
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpenTraceability(read)}
          className="text-[10px] h-7 px-2.5 rounded-lg border-border/60 hover:bg-secondary/40 text-foreground ml-auto"
        >
          <Layers className="w-3 h-3 mr-1" /> Histórico
        </Button>
      </div>
    </div>
  );
}

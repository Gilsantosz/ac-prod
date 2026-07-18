import { AlertTriangle, CalendarDays, Clock, Layers, MapPin, Monitor, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function CollectionReadItem({
  read,
  isSelected,
  onSelect,
  onReject,
  onCreateOccurrence,
  onOpenTraceability,
  canReject = false
}) {
  const isRejected = read.event_status === 'rejected';
  const isBlocked = read.event_status === 'blocked' || read.event_status === 'duplicated';
  const isRework = read.event_status === 'rework';
  const isApproved = read.event_status === 'approved';
  const isNotFound = ['not_found', 'invalid'].includes(read.event_status);
  const isError = ['error', 'processing'].includes(read.event_status);
  const traceabilityCode = read.traceability_code || read.raw_value || 'Sem identificação';

  const formatHour = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toTimeString().slice(0, 5);
    } catch {
      return read.hour || '';
    }
  };

  const formatDate = (isoString) => {
    try {
      return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(isoString));
    } catch {
      return read.date || '';
    }
  };

  const getStatusBadge = () => {
    if (isRejected) return <Badge className="bg-rose-500 text-white border-0 text-[10px]">REPROVADA</Badge>;
    if (isBlocked) return <Badge className="bg-amber-500 text-white border-0 text-[10px]">BLOQUEADA</Badge>;
    if (isRework) return <Badge className="bg-purple-500 text-white border-0 text-[10px]">RETRABALHO</Badge>;
    if (isApproved) return <Badge className="bg-emerald-500 text-white border-0 text-[10px]">APROVADA</Badge>;
    if (isNotFound) return <Badge className="bg-zinc-600 text-white border-0 text-[10px]">NÃO LOCALIZADA</Badge>;
    if (isError) return <Badge className="bg-red-700 text-white border-0 text-[10px]">ERRO DE SINCRONIA</Badge>;
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
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-bold text-muted-foreground">{formatDate(read.created_at)}</span>
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-bold text-muted-foreground">{formatHour(read.created_at)}</span>
          <span className="font-extrabold text-xs text-foreground font-mono truncate max-w-[120px]" title={traceabilityCode}>
            {traceabilityCode}
          </span>
        </div>
        {getStatusBadge()}
      </div>

      {/* Lote / Pedido / Cliente */}
      <div className="space-y-0.5">
        {read.pcp_batch_name && (
          <p className="text-[10px] text-muted-foreground truncate">
            Lote geral PCP: <strong className="text-foreground">{read.pcp_batch_name}</strong>
          </p>
        )}
        <p className="text-[11px] font-bold text-foreground">
          {read.lot_code || 'Lote não identificado'} <span className="text-muted-foreground font-medium">· Pedido {read.order_number || '—'}</span>
        </p>
        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">
          {read.client_name || read.customer_name || 'Cliente não informado'}
        </p>
      </div>

      {/* Etapa atual e Operador */}
      <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1.5 border-t border-border/40 gap-2">
        <span className="truncate">
          Etapa: <strong className="text-foreground">{read.current_stage_name || read.operation_name || 'Não definida'}</strong>
        </span>
        <span className="flex items-center gap-1 shrink-0 font-medium">
          <User className="w-3 h-3 text-muted-foreground/80" /> {read.operator_name || 'Não identificado'}
          {read.registration ? ` · ${read.registration}` : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 min-w-0">
          <MapPin className="w-3 h-3 shrink-0" />
          <strong className="text-foreground truncate">{read.cell_name || 'Célula não informada'}</strong>
          {read.shift ? ` · ${read.shift}` : ''}
        </span>
        <span className="flex items-center gap-1 min-w-0 sm:justify-end">
          <Monitor className="w-3 h-3 shrink-0" />
          <strong className="text-foreground truncate">{read.machine_name || read.station_name || 'Posto geral'}</strong>
        </span>
      </div>

      {/* Ações rápidas no card */}
      <div className="flex flex-wrap gap-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
        {onCreateOccurrence && read.event_status !== 'processing' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCreateOccurrence(read)}
            className="text-[10px] h-7 px-2.5 rounded-lg border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 font-bold"
          >
            <AlertTriangle className="w-3 h-3 mr-1" /> Ocorrência
          </Button>
        )}
        {canReject && isApproved && read.piece_id && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(read)}
            className="text-[10px] h-7 px-2.5 rounded-lg border-rose-500/30 text-rose-600 hover:bg-rose-500/10 font-bold"
          >
            Reprovar
          </Button>
        )}
        {read.piece_id && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenTraceability(read)}
            className="text-[10px] h-7 px-2.5 rounded-lg border-border/60 hover:bg-secondary/40 text-foreground ml-auto"
          >
            <Layers className="w-3 h-3 mr-1" /> Histórico
          </Button>
        )}
      </div>
    </div>
  );
}

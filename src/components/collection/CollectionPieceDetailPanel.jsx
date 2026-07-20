import { Layers, User, Clock, RefreshCw, AlertOctagon, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import PieceProductionFlow from './PieceProductionFlow';

const STAGE_LABELS = {
  cut: 'Corte',
  edge: 'Borda',
  drill: 'Furação',
  cnc: 'Usinagem',
  canal: 'Canal',
  maranello: 'Maranello',
  portajoias: 'Porta Joias',
  sorrento: 'Sorrento',
  usi_especial: 'Usinagem Especial',
  rasgo_freggio: 'Rasgo Freggio',
  joinery: 'Marcenaria',
  separation: 'Separação',
  packaging: 'Embalagem'
};

export default function CollectionPieceDetailPanel({
  piece,
  events = [],
  loading = false,
  onReject,
  onOpenTraceability,
  onRefresh,
  onReplacement,
  canReject = false
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground bg-card border border-border/60 rounded-2xl">
        <RefreshCw className="w-6 h-6 animate-spin mb-2" />
        <p className="text-xs">Carregando detalhes da peça...</p>
      </div>
    );
  }

  if (!piece) {
    return (
      <div className="text-center py-20 border border-dashed border-border/40 bg-card/25 rounded-2xl text-muted-foreground flex flex-col items-center justify-center space-y-2">
        <HelpCircle className="w-10 h-10 text-muted-foreground/30" />
        <div>
          <p className="font-bold text-foreground text-sm">Nenhuma peça selecionada</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto">
            Selecione uma peça no histórico à esquerda para ver o fluxo produtivo, timeline de etapas e ações de retrabalho ou ocorrência.
          </p>
        </div>
      </div>
    );
  }

  const isRejected = piece.status === 'rejected';
  const isBlocked = piece.status === 'blocked';
  const isRework = piece.status === 'rework';
  const isApproved = piece.status === 'approved' || piece.status === 'active' || piece.status === 'in_progress' || piece.status === 'completed';

  const getStatusBadge = () => {
    if (piece.is_replacement) {
      if (isRejected) return <Badge className="bg-rose-500 text-white border-0 text-xs">REPROVADA REPOSIÇÃO</Badge>;
      return <Badge className="bg-emerald-500 text-white border-0 text-xs">APROVADA REPOSIÇÃO</Badge>;
    }
    if (isRejected) return <Badge className="bg-rose-500 text-white border-0 text-xs">REPROVADA</Badge>;
    if (isBlocked) return <Badge className="bg-amber-500 text-white border-0 text-xs">BLOQUEADA</Badge>;
    if (isRework) return <Badge className="bg-purple-500 text-white border-0 text-xs">RETRABALHO</Badge>;
    if (isApproved) return <Badge className="bg-emerald-500 text-white border-0 text-xs">APROVADA</Badge>;
    return <Badge variant="outline" className="text-xs">{piece.status}</Badge>;
  };

  const getStatusColorClass = () => {
    if (isRejected) return 'border-rose-500/20 bg-rose-500/5 text-rose-700 dark:text-rose-400';
    if (isBlocked) return 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400';
    if (isRework) return 'border-purple-500/20 bg-purple-500/5 text-purple-700 dark:text-purple-400';
    if (piece.is_replacement) return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400';
    return 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400';
  };

  const currentStageRaw = piece.current_stage_name || piece.current_stage || '';
  const displayCurrentStage = STAGE_LABELS[String(currentStageRaw).toLowerCase()] || currentStageRaw || 'Não iniciada';

  return (
    <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-5 flex flex-col justify-between">
      
      {/* 1. Header do Painel */}
      <div className="flex justify-between items-start gap-4 pb-4 border-b border-border/40">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-extrabold text-foreground text-base font-mono">{piece.piece_uid || piece.traceability_code}</h4>
            {getStatusBadge()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Peça: <span className="font-bold text-foreground">{piece.piece_name || 'Sem nome'}</span>
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          className="h-8 w-8 p-0 rounded-lg border-border/60"
          title="Recarregar Peça"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* 2. Informações Básicas de Rastreabilidade */}
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Lote</span>
          <p className="font-bold text-foreground">{piece.lot_code || 'LOTE-N/A'}</p>
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Pedido / Cliente</span>
          <p className="font-bold text-foreground">
            #{piece.order_number || 'N/A'} <span className="text-muted-foreground font-normal">· {piece.client_name || 'Móvel Planejado'}</span>
          </p>
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Etapa Atual</span>
          <p className="font-bold text-foreground">{displayCurrentStage}</p>
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Última Leitura Por</span>
          <p className="font-bold text-foreground flex items-center gap-1">
            <User className="w-3.5 h-3.5 text-muted-foreground" /> {piece.operator_name || 'Operador'}
          </p>
        </div>
        {piece.rework_status && piece.rework_status !== 'none' && (
          <div className="space-y-0.5 col-span-1">
            <span className="text-[10px] text-purple-600 uppercase font-bold tracking-wider">Retrabalho</span>
            <p className="font-bold text-purple-700 capitalize">{piece.rework_status}</p>
          </div>
        )}
        {piece.replacement_status && piece.replacement_status !== 'none' && (
          <div className="space-y-0.5 col-span-1">
            <span className="text-[10px] text-amber-600 uppercase font-bold tracking-wider">Reposição</span>
            <p className="font-bold text-amber-700 capitalize">{piece.replacement_status}</p>
          </div>
        )}
      </div>

      {/* 3. Fluxo Produtivo Visual */}
      <div className="space-y-2 pt-2">
        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Fluxo da Rota</span>
        <PieceProductionFlow
          route={piece.route || []}
          currentStage={piece.current_stage || piece.current_stage_name}
          completedSteps={piece.completedSteps || events.filter(e => e.status === 'approved').map(e => e.step_name)}
          status={piece.status}
        />
      </div>

      {/* 4. Timeline Resumida */}
      <div className="space-y-3 pt-2">
        <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Últimas Movimentações ({events.length})</span>
        
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nenhum evento registrado para esta peça.</p>
        ) : (
          <div className="space-y-2 max-h-[20vh] overflow-y-auto pr-1">
            {events.slice(0, 5).map((event, idx) => {
              const isEventRejected = event.status === 'rejected';
              const isEventBlocked = event.status === 'blocked' || event.status === 'duplicated';
              const isEventApproved = event.status === 'approved';

              return (
                <div
                  key={event.id || idx}
                  className="flex items-start gap-2.5 p-2 rounded-xl bg-secondary/35 text-[11px] leading-relaxed border border-border/40"
                >
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold text-foreground">
                      {event.step_name || 'Etapa'} — 
                      <span className={cn(
                        'ml-1 font-bold',
                        isEventRejected ? 'text-rose-600' :
                        isEventBlocked ? 'text-amber-600' : 'text-emerald-600'
                      )}>
                        {isEventRejected ? 'Reprovada' : isEventBlocked ? 'Bloqueada/Alerta' : 'Aprovada'}
                      </span>
                    </p>
                    {event.notes && (
                      <p className="text-[10px] text-muted-foreground bg-secondary/50 p-1 rounded mt-1 border border-border/30">
                        {event.notes}
                      </p>
                    )}
                    <span className="text-[9px] text-muted-foreground block mt-0.5">
                      {new Date(event.created_at).toLocaleString('pt-BR')} · {event.operator_name || event.operator || 'Operador'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Ações de Detalhe da Peça */}
      <div className="flex flex-col gap-2 pt-4 border-t border-border/40">
        <div className="flex gap-2.5">
          {canReject && !isRejected && piece.status !== 'replaced' && (
            <Button
              onClick={() => onReject(piece)}
              variant="destructive"
              className="flex-1 font-bold text-xs gap-1.5 h-9 rounded-xl text-white shrink-0"
            >
              <AlertOctagon className="w-4 h-4" /> Reprovar Peça
            </Button>
          )}

          {isRejected && piece.status !== 'replaced' && (
            <Button
              onClick={() => onReplacement && onReplacement(piece)}
              variant="outline"
              className="flex-1 font-bold text-xs gap-1.5 h-9 rounded-xl border-amber-500/30 text-amber-600 bg-amber-500/5 hover:bg-amber-500/10 shrink-0"
            >
              <RefreshCw className="w-4 h-4" /> Reposição
            </Button>
          )}
          
          <Button
            onClick={() => onOpenTraceability(piece)}
            variant="outline"
            className="flex-1 font-bold text-xs gap-1.5 h-9 rounded-xl border-border/60 hover:bg-secondary/40 text-foreground"
          >
            <Layers className="w-4 h-4" /> Rastreabilidade
          </Button>
        </div>
      </div>

    </div>
  );
}

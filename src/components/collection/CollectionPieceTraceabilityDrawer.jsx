import { useEffect, useState } from 'react';
import { X, Clock, User, Box, Layers, RefreshCw, CheckCircle, AlertTriangle, AlertOctagon, Copy, ClipboardCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getPieceTraceability } from '@/lib/collectionService';
import PieceProductionFlow from './PieceProductionFlow';

export default function CollectionPieceTraceabilityDrawer({
  open,
  onOpenChange,
  pieceCode,
  canReject = false,
  onReject
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const fetchTraceability = async () => {
    if (!pieceCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getPieceTraceability(pieceCode);
      setData(res);
    } catch (e) {
      console.error(e);
      setError('Não foi possível carregar a rastreabilidade desta peça.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && pieceCode) {
      fetchTraceability();
    }
  }, [open, pieceCode]);

  const handleCopyCode = () => {
    if (!pieceCode) return;
    navigator.clipboard.writeText(pieceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isRejected = data?.piece?.status === 'rejected';
  const isBlocked = data?.piece?.status === 'blocked';
  const isRework = data?.piece?.status === 'rework';

  const getStatusBadge = (status) => {
    if (status === 'rejected') return <Badge className="bg-rose-500 text-white border-0 text-[10px]">REPROVADA</Badge>;
    if (status === 'blocked') return <Badge className="bg-amber-500 text-white border-0 text-[10px]">BLOQUEADA</Badge>;
    if (status === 'rework') return <Badge className="bg-purple-500 text-white border-0 text-[10px]">RETRABALHO</Badge>;
    if (status === 'approved' || status === 'active') return <Badge className="bg-emerald-500 text-white border-0 text-[10px]">APROVADA</Badge>;
    return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-6 bg-card border border-border/60 rounded-2xl shadow-2xl overflow-y-auto max-h-[90vh]">
        
        {/* Cabeçalho */}
        <DialogHeader className="border-b border-border/40 pb-4 flex flex-row items-start justify-between">
          <div className="space-y-1">
            <DialogTitle className="text-base font-extrabold flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-500" />
              Histórico de Rastreabilidade MES
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Acompanhe a linha do tempo, movimentações físicas, operadores e postos da peça.
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Loading / Erros */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-emerald-500" />
            <p className="text-xs">Carregando histórico completo...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-rose-500 space-y-2">
            <AlertTriangle className="w-10 h-10" />
            <p className="text-sm font-bold">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchTraceability}>Tentar novamente</Button>
          </div>
        )}

        {/* Conteúdo Principal */}
        {!loading && !error && data && (
          <div className="space-y-6 my-4 text-xs">
            
            {/* Info Box */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-secondary/35 border border-border/40">
              <div className="space-y-2">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Código Rastreável</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-extrabold text-foreground font-mono text-xs">{data.piece.piece_uid || data.piece.id}</span>
                    <button
                      onClick={handleCopyCode}
                      className="p-1 hover:bg-secondary rounded text-muted-foreground transition-colors"
                      title="Copiar Código"
                    >
                      {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Lote</span>
                  <p className="font-bold text-foreground mt-0.5">{data.piece.production_lots?.lot_code || 'LOTE-N/A'}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Pedido / Cliente</span>
                  <p className="font-bold text-foreground mt-0.5">
                    #{data.piece.production_lots?.production_orders?.order_code || 'N/A'} · 
                    <span className="text-muted-foreground font-normal ml-1">
                      {data.piece.production_lots?.production_orders?.customer_name || 'Móvel Planejado'}
                    </span>
                  </p>
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Status</span>
                    <div className="mt-1">{getStatusBadge(data.piece.status)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Medidas e Materiais */}
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Detalhes Físicos</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-secondary/10 p-3 rounded-xl border border-border/20 text-center">
                <div>
                  <p className="text-muted-foreground text-[10px]">Material</p>
                  <p className="font-bold text-foreground mt-0.5">{data.piece.material || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[10px]">Cor</p>
                  <p className="font-bold text-foreground mt-0.5">{data.piece.color || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[10px]">Dimensões (LxC)</p>
                  <p className="font-bold text-foreground mt-0.5">
                    {data.piece.width || 0} x {data.piece.length || 0} mm
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-[10px]">Espessura</p>
                  <p className="font-bold text-foreground mt-0.5">{data.piece.thickness || 0} mm</p>
                </div>
              </div>
            </div>

            {/* Rota */}
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Fluxo da Rota</span>
              <PieceProductionFlow
                route={data.route || []}
                currentStage={data.piece.current_stage}
                completedSteps={data.readings.filter(r => r.status === 'approved').map(r => r.step_name)}
                status={data.piece.status}
              />
            </div>

            {/* Timeline de Eventos */}
            <div className="space-y-3">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Linha do Tempo de Coleta</span>
              
              {data.readings.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-border/40 rounded-xl text-muted-foreground">
                  Nenhum registro de leitura ou movimentação encontrado para esta peça.
                </div>
              ) : (
                <div className="relative border-l border-border/80 pl-4 ml-2 space-y-4">
                  {data.readings.map((reading, idx) => {
                    const isReadRejected = reading.status === 'rejected';
                    const isReadBlocked = reading.status === 'blocked' || reading.status === 'duplicated';

                    return (
                      <div key={reading.id || idx} className="relative">
                        {/* Indicador de Timeline */}
                        <span className={cn(
                          "absolute -left-[21px] top-1 w-3 h-3 rounded-full border bg-card flex items-center justify-center",
                          isReadRejected ? "border-rose-500 text-rose-500" :
                          isReadBlocked ? "border-amber-500 text-amber-500" : "border-emerald-500 text-emerald-500"
                        )}>
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            isReadRejected ? "bg-rose-500" :
                            isReadBlocked ? "bg-amber-500" : "bg-emerald-500"
                          )} />
                        </span>

                        <div className="bg-secondary/25 border border-border/30 rounded-xl p-3 space-y-1">
                          <div className="flex justify-between items-center">
                            <p className="font-extrabold text-foreground">
                              Célula: {reading.cell_name} <span className="text-muted-foreground font-normal">· {reading.step_name}</span>
                            </p>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {reading.hour}
                            </span>
                          </div>
                          
                          <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                            <span>Status: 
                              <strong className={cn(
                                "ml-1",
                                isReadRejected ? "text-rose-600" :
                                isReadBlocked ? "text-amber-600" : "text-emerald-600"
                              )}>
                                {reading.status?.toUpperCase()}
                              </strong>
                            </span>
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3 text-muted-foreground" /> {reading.operator_name || reading.operator || 'Operador'}
                            </span>
                          </div>

                          {reading.notes && (
                            <p className="text-[10px] text-muted-foreground bg-secondary/50 p-2 rounded-lg mt-1 border border-border/30 italic">
                              {reading.notes}
                            </p>
                          )}

                          <span className="text-[9px] text-muted-foreground block text-right mt-1">
                            {new Date(reading.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        <DialogFooter className="gap-2 border-t border-border/40 pt-4">
          {canReject && !isRejected && data?.piece && (
            <Button
              onClick={() => {
                onReject(data.piece);
                onOpenChange(false);
              }}
              variant="destructive"
              className="h-10 rounded-xl text-white font-bold gap-1.5"
            >
              <AlertOctagon className="w-4 h-4" /> Reprovar Peça
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-xl border-border/60 font-bold ml-auto"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

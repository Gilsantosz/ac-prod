import { Clock, Check, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function formatHour(hour) {
  if (!hour) return '—';
  return String(hour).includes(':') ? hour : `${hour}:00`;
}

export default function HourSummaryCard({
  _date = '',
  _shift = '',
  _cell = '',
  hour = '',
  lotCode = 'SEM_LOTE',
  orderNumber = 'MANUAL',
  processStep = 'APONTAMENTO_MANUAL',
  produced = 0,
  target = 0,
  efficiency = 100,
  scrap = 0,
  downtime = 0,
  entriesCount = 0,
  onCorrect = null,
  onAddOccurrence = null,
  onCloseHour = null,
  isClosed = false
}) {

  // Indicador visual de eficiência
  const getEfficiencyColor = (eff, hasTarget) => {
    if (!hasTarget) return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800/40 dark:bg-slate-950/20 dark:text-slate-300';
    if (eff >= 90) return 'border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/10 dark:text-emerald-400';
    if (eff >= 70) return 'border-amber-200 bg-amber-50/50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/10 dark:text-amber-400';
    return 'border-red-200 bg-red-50/50 text-red-700 dark:border-red-900/30 dark:bg-red-950/10 dark:text-red-400';
  };
  const displayHour = formatHour(hour);

  return (
    <Card className="border border-border/80 shadow-sm bg-card overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/50 bg-secondary/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#2d9c4a]" />
            <div>
              <CardTitle className="text-sm font-bold text-foreground">Resumo da Hora {displayHour}</CardTitle>
              <CardDescription className="text-xs">Contexto ativo de apontamento</CardDescription>
            </div>
          </div>
          {isClosed ? (
            <Badge className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/10 gap-1 text-[10px]">
              <Check className="w-3 h-3" /> Fechada
            </Badge>
          ) : (
            <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-800 text-[10px]">
              Aberta
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-4 space-y-4">
        
        {/* Metadados */}
        <div className="grid grid-cols-2 gap-2.5 text-xs pb-3 border-b border-border/60">
          <div>
            <span className="text-muted-foreground block font-medium">Lote:</span>
            <span className="font-mono text-foreground font-semibold break-all block">{lotCode}</span>
          </div>
          <div>
            <span className="text-muted-foreground block font-medium">OP / Pedido:</span>
            <span className="font-mono text-foreground font-semibold break-all block">{orderNumber}</span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground block font-medium">Etapa / Processo:</span>
            <span className="text-foreground font-semibold break-words block">{processStep}</span>
          </div>
        </div>

        {/* Estatísticas da Hora */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border/60 p-2">
            <span className="text-[10px] text-muted-foreground uppercase font-bold block">Produzido</span>
            <span className="text-lg font-bold text-foreground block">{produced}</span>
            <span className="text-[9px] text-muted-foreground block">Meta: {target}</span>
          </div>
          <div className={cn("rounded-lg border p-2 flex flex-col justify-center items-center", getEfficiencyColor(efficiency, target > 0))}>
            <span className="text-[10px] uppercase font-bold block">Eficiência</span>
            <span className="text-lg font-black block">{efficiency}%</span>
          </div>
          <div className="rounded-lg border border-border/60 p-2">
            <span className="text-[10px] text-muted-foreground uppercase font-bold block">Refugo</span>
            <span className={cn("text-lg font-bold block", scrap > 0 ? "text-red-500" : "text-foreground")}>{scrap}</span>
            <span className="text-[9px] text-muted-foreground block">Parada: {downtime}m</span>
          </div>
        </div>

        {/* Quantidade de Apontamentos */}
        <p className="text-xs text-muted-foreground text-center bg-secondary/30 py-1.5 rounded-md">
          Há <strong className="text-foreground font-semibold">{entriesCount} apontamento{entriesCount !== 1 ? 's' : ''}</strong> nesta hora.
        </p>

        {/* Ações */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={onAddOccurrence}
            disabled={!onAddOccurrence || isClosed}
            className="text-xs gap-1.5 h-9"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Ocorrência
          </Button>

          <Button 
            variant="outline" 
            size="sm"
            onClick={onCorrect}
            disabled={!onCorrect || entriesCount === 0}
            className="text-xs gap-1.5 h-9"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-sky-500" />
            Corrigir / Estornar
          </Button>
          
          <Button 
            className="col-span-2 text-xs gap-1.5 h-9 bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-200 dark:hover:bg-slate-300 dark:text-black font-semibold"
            onClick={onCloseHour}
            disabled={!onCloseHour || isClosed || entriesCount === 0}
          >
            <Check className="w-4 h-4" />
            {isClosed ? 'Hora Fechada' : 'Fechar Hora'}
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}

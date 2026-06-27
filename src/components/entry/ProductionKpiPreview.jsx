import { useMemo } from 'react';
import { 
  TrendingUp, AlertOctagon, Clock, Percent, 
  CheckCircle2, AlertTriangle, HelpCircle 
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function ProductionKpiPreview({ 
  entries = [], 
  cellName = '', 
  shift = '', 
  date = '', 
  currentHour = '', 
  targetPerHour = 0 
}) {
  
  // Filtrar lançamentos válidos deste turno/célula/data
  const shiftEntries = useMemo(() => {
    if (!cellName || !shift || !date) return [];
    return entries.filter(e => 
      e.date === date && 
      e.cell === cellName && 
      e.shift === shift && 
      (e.approval_status === 'valid' || !e.approval_status)
    );
  }, [entries, cellName, shift, date]);

  // Cálculos acumulados
  const stats = useMemo(() => {
    let produced = 0;
    let target = 0;
    let scrap = 0;
    let downtime = 0;
    let currentHourProduced = 0;
    let currentHourTarget = 0;

    shiftEntries.forEach(e => {
      produced += Number(e.produced) || 0;
      target += Number(e.target) || 0;
      scrap += Number(e.scrap) || 0;
      downtime += Number(e.downtime) || 0;

      if (e.hour === currentHour) {
        currentHourProduced += Number(e.produced) || 0;
        currentHourTarget += Number(e.target) || 0;
      }
    });

    // Se a meta acumulada for zero mas temos apontamentos, tentamos usar o targetPerHour
    const activeHours = new Set(shiftEntries.map(e => e.hour)).size;
    const finalTarget = target > 0 ? target : (targetPerHour * Math.max(1, activeHours));

    const efficiency = finalTarget > 0 ? Math.round((produced / finalTarget) * 100) : 100;
    const currentHourTargetFinal = currentHourTarget > 0 ? currentHourTarget : targetPerHour;
    const hourEfficiency = currentHourTargetFinal > 0 ? Math.round((currentHourProduced / currentHourTargetFinal) * 100) : 100;

    return {
      produced,
      target: finalTarget,
      scrap,
      downtime,
      efficiency,
      currentHourProduced,
      currentHourTarget: currentHourTargetFinal,
      hourEfficiency,
      pending: Math.max(0, finalTarget - produced)
    };
  }, [shiftEntries, currentHour, targetPerHour]);

  // Indicador de status geral de eficiência
  const getStatusConfig = (eff, hasTarget) => {
    if (!hasTarget) return { label: 'Sem Meta', color: 'text-slate-400 bg-slate-50 dark:bg-slate-950/20 border-slate-200 dark:border-slate-800/40', icon: HelpCircle };
    if (eff >= 90) return { label: 'Dentro da Meta', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40', icon: CheckCircle2 };
    if (eff >= 70) return { label: 'Atenção', color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40', icon: AlertTriangle };
    return { label: 'Crítico', color: 'text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40', icon: AlertOctagon };
  };

  const status = getStatusConfig(stats.efficiency, stats.target > 0);
  const StatusIcon = status.icon;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      
      {/* Eficiência Geral do Turno */}
      <Card className={cn("border shadow-sm transition-all", status.color)}>
        <CardContent className="p-4 flex flex-col justify-between h-full min-h-[96px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider opacity-80">Eficiência Turno</span>
            <Percent className="w-4 h-4 opacity-70" />
          </div>
          <div className="mt-2.5">
            <h4 className="text-3xl font-extrabold leading-none">{stats.efficiency}%</h4>
            <div className="flex items-center gap-1 mt-1 opacity-90">
              <StatusIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[10px] font-semibold">{status.label}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Produzido vs Meta */}
      <Card className="border border-border/60 bg-card shadow-sm">
        <CardContent className="p-4 flex flex-col justify-between h-full min-h-[96px]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[10px] uppercase font-bold tracking-wider">Produção Acumulada</span>
            <TrendingUp className="w-4 h-4 text-[#2d9c4a]" />
          </div>
          <div className="mt-2.5">
            <h4 className="text-2xl font-bold text-foreground leading-none">
              {stats.produced} <span className="text-xs text-muted-foreground font-normal">/ {stats.target}</span>
            </h4>
            <p className="text-[10px] text-muted-foreground mt-1">
              {stats.pending > 0 ? `Faltam ${stats.pending} peças para a meta` : 'Meta batida! 🎉'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Refugo Acumulado */}
      <Card className={cn(
        "border border-border/60 bg-card shadow-sm transition-all",
        stats.scrap > 0 && "border-red-300 dark:border-red-900 bg-red-50/10 dark:bg-red-950/5"
      )}>
        <CardContent className="p-4 flex flex-col justify-between h-full min-h-[96px]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[10px] uppercase font-bold tracking-wider">Refugo / Descarte</span>
            <AlertOctagon className={cn("w-4 h-4", stats.scrap > 0 ? "text-red-500" : "text-muted-foreground")} />
          </div>
          <div className="mt-2.5">
            <h4 className={cn("text-2xl font-bold leading-none", stats.scrap > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
              {stats.scrap} <span className="text-xs text-muted-foreground font-normal">peça{stats.scrap !== 1 ? 's' : ''}</span>
            </h4>
            <p className="text-[10px] text-muted-foreground mt-1">
              {stats.scrap > 0 ? 'Exige lançamento de ocorrência' : 'Nenhum refugo no turno'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tempo de Parada */}
      <Card className={cn(
        "border border-border/60 bg-card shadow-sm transition-all",
        stats.downtime > 0 && "border-amber-300 dark:border-amber-900 bg-amber-50/10 dark:bg-amber-950/5"
      )}>
        <CardContent className="p-4 flex flex-col justify-between h-full min-h-[96px]">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[10px] uppercase font-bold tracking-wider">Tempo de Parada</span>
            <Clock className={cn("w-4 h-4", stats.downtime > 0 ? "text-amber-500" : "text-muted-foreground")} />
          </div>
          <div className="mt-2.5">
            <h4 className={cn("text-2xl font-bold leading-none", stats.downtime > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
              {stats.downtime} <span className="text-xs text-muted-foreground font-normal">minutos</span>
            </h4>
            <p className="text-[10px] text-muted-foreground mt-1">
              {stats.downtime > 0 ? 'Exige motivo de parada' : 'Operação 100% ativa'}
            </p>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

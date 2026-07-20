import { Check, AlertTriangle, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PieceProductionFlow({
  route = [],
  currentStage = '',
  completedSteps = [],
  status = 'approved',
  className
}) {
  if (!route || route.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Sem rota configurada para esta peça.
      </div>
    );
  }

  // Verifica se o lote/peça está bloqueado ou reprovado
  const isRejected = status === 'rejected';
  const isBlocked = status === 'blocked';
  const isRework = status === 'rework';

  return (
    <div className={cn("flex flex-wrap items-center gap-y-3 gap-x-2 text-xs font-semibold select-none", className)}>
      {route.map((step, idx) => {
        const stepName = step.step_name || step.name;
        const isCompleted = completedSteps.includes(stepName) || (idx < route.findIndex(s => (s.step_name || s.name) === currentStage));
        const isCurrent = stepName === currentStage;
        
        let badgeColor = 'bg-secondary text-muted-foreground border-border/50';
        let Icon = null;

        if (isCompleted) {
          badgeColor = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
          Icon = <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />;
        } else if (isCurrent) {
          if (isRejected) {
            badgeColor = 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/35 ring-1 ring-rose-500/30';
            Icon = <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-500 animate-pulse" />;
          } else if (isBlocked) {
            badgeColor = 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/35 ring-1 ring-amber-500/30';
            Icon = <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 animate-pulse" />;
          } else if (isRework) {
            badgeColor = 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/35 ring-1 ring-purple-500/30';
            Icon = <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-purple-500 animate-pulse" />;
          } else {
            badgeColor = 'bg-[#76FB91]/20 text-foreground border-[#76FB91]/35 shadow-sm ring-1 ring-[#76FB91]/20';
            Icon = <Play className="w-3 h-3 shrink-0 text-[#2d9c4a] fill-[#2d9c4a]/20" />;
          }
        }

        return (
          <div key={stepName} className="flex items-center gap-1.5">
            <div className={cn(
              "px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 transition-all duration-200",
              badgeColor
            )}>
              {Icon}
              <span className="truncate max-w-[100px] sm:max-w-none">{stepName}</span>
            </div>
            {idx < route.length - 1 && (
              <span className="text-muted-foreground/35 select-none font-bold">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

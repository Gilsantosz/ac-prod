import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function GoalProjection({ projection }) {
  if (!projection) return null;
  const { totalProduced, totalTarget, remaining, pacePerHour, hoursNeeded, projectedTotal, atRisk, completedPct } = projection;

  return (
    <Card className={cn('p-6 border-2', atRisk ? 'border-amber-500/50 bg-amber-500/5' : 'border-green-500/40 bg-green-500/5')}>
      <div className="flex items-center gap-2 mb-1">
        {atRisk ? <AlertTriangle className="w-5 h-5 text-amber-600" /> : <CheckCircle2 className="w-5 h-5 text-green-600" />}
        <h3 className="font-semibold">Projeção da Meta Diária</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Baseada no ritmo das últimas horas ({pacePerHour.toLocaleString('pt-BR')} un/h).
      </p>

      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-medium">{totalProduced.toLocaleString('pt-BR')} / {totalTarget.toLocaleString('pt-BR')}</span>
          <span className="tabular-nums font-semibold">{completedPct}%</span>
        </div>
        <Progress value={Math.min(completedPct, 100)} className={cn('h-2', atRisk ? '[&>div]:bg-amber-500' : '[&>div]:bg-green-600')} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-background/60 p-2">
          <p className="text-xs text-muted-foreground">Faltam</p>
          <p className="font-semibold tabular-nums">{remaining.toLocaleString('pt-BR')}</p>
        </div>
        <div className="rounded-lg bg-background/60 p-2">
          <p className="text-xs text-muted-foreground">Horas p/ meta</p>
          <p className="font-semibold tabular-nums">{hoursNeeded ?? '—'}</p>
        </div>
        <div className="rounded-lg bg-background/60 p-2">
          <p className="text-xs text-muted-foreground">Projeção fim do dia</p>
          <p className="font-semibold tabular-nums">{projectedTotal.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      <div className={cn('mt-4 flex items-center gap-2 text-sm font-medium rounded-lg p-3',
        atRisk ? 'bg-amber-500/10 text-amber-700' : 'bg-green-500/10 text-green-700')}>
        <TrendingUp className="w-4 h-4" />
        {atRisk
          ? 'Atenção: no ritmo atual a meta corre risco de não ser atingida.'
          : 'No ritmo atual, a meta diária deve ser atingida.'}
      </div>
    </Card>
  );
}
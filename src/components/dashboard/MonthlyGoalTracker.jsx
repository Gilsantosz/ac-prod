import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarRange, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function MonthlyGoalTracker({ tracking, cellTrackings }) {
  if (!tracking) return null;

  const { produced, target, completedPct, projectedTotal, projectedPct, neededPerDay, daysLeft, dailyPace, willMeet, monthLabel } = tracking;
  const barPct = Math.min(completedPct, 100);
  const markerPct = Math.min(projectedPct, 100);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="font-semibold capitalize">Acompanhamento de Metas — {monthLabel}</h3>
              <p className="text-sm text-muted-foreground">Produção acumulada do mês vs. meta definida</p>
            </div>
          </div>
          <Badge variant={willMeet ? 'default' : 'destructive'} className="gap-1.5">
            {willMeet ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {willMeet ? 'Meta no ritmo' : 'Abaixo do ritmo'}
          </Badge>
        </div>

        <div className="flex items-end justify-between mb-2">
          <p className="text-2xl font-bold tabular-nums">{produced.toLocaleString('pt-BR')} <span className="text-base font-normal text-muted-foreground">/ {target.toLocaleString('pt-BR')}</span></p>
          <p className="text-lg font-semibold tabular-nums">{completedPct}%</p>
        </div>

        <div className="relative h-4 rounded-full bg-secondary overflow-hidden mb-1">
          <motion.div
            className={`h-full rounded-full ${willMeet ? 'bg-emerald-500' : 'bg-amber-500'}`}
            initial={{ width: 0 }} animate={{ width: `${barPct}%` }} transition={{ duration: 0.6 }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-sky-700" style={{ left: `${markerPct}%` }} title="Previsão fim do mês" />
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          <span className="inline-block w-2 h-2 rounded-full bg-sky-700 mr-1 align-middle" />
          Previsão de atingimento: {projectedPct}% ({projectedTotal.toLocaleString('pt-BR')} peças)
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-secondary text-center">
            <div className="flex items-center justify-center gap-1 text-sky-600"><TrendingUp className="w-4 h-4" /><p className="text-lg font-bold tabular-nums">{dailyPace.toLocaleString('pt-BR')}</p></div>
            <p className="text-xs text-muted-foreground">Ritmo/dia atual</p>
          </div>
          <div className="p-3 rounded-xl bg-secondary text-center">
            <p className="text-lg font-bold tabular-nums">{neededPerDay.toLocaleString('pt-BR')}</p>
            <p className="text-xs text-muted-foreground">Necessário/dia</p>
          </div>
          <div className="p-3 rounded-xl bg-secondary text-center">
            <p className="text-lg font-bold tabular-nums">{daysLeft}</p>
            <p className="text-xs text-muted-foreground">Dias restantes</p>
          </div>
        </div>

        {cellTrackings && cellTrackings.length > 0 && (
          <div className="mt-6 pt-6 border-t border-border/50">
            <h4 className="text-sm font-semibold mb-4 text-muted-foreground">Evolução por Célula</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {cellTrackings.map((ct) => {
                const cBarPct = Math.min(ct.completedPct, 100);
                const cMarkerPct = Math.min(ct.projectedPct, 100);
                return (
                  <div key={ct.cell} className="p-3.5 rounded-xl bg-secondary/40 flex flex-col gap-2.5">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-sm truncate">{ct.cell}</span>
                      <span className="text-sm font-bold">{ct.completedPct}%</span>
                    </div>
                    <div className="relative h-2.5 rounded-full bg-secondary overflow-hidden">
                      <div className={`absolute top-0 bottom-0 left-0 rounded-full ${ct.willMeet ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${cBarPct}%` }} />
                      <div className="absolute top-0 bottom-0 w-0.5 bg-sky-700" style={{ left: `${cMarkerPct}%` }} title="Previsão" />
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground mt-0.5">
                      <span>{ct.produced.toLocaleString('pt-BR')} / {ct.target.toLocaleString('pt-BR')}</span>
                      <span>{ct.dailyPace.toLocaleString('pt-BR')}/d</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
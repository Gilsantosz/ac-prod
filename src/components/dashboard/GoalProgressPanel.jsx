import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Target, CheckCircle2 } from 'lucide-react';

export default function GoalProgressPanel({ items = [] }) {
  if (!items.length) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-6 border-border/60 flex flex-col h-full max-h-[400px]">
        <div className="flex items-center gap-2 mb-1 shrink-0">
          <Target className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Progresso das Metas do Turno</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4 shrink-0">Quanto cada célula já produziu em relação à meta definida.</p>

        <div className="space-y-5 overflow-y-auto pr-2 pb-2 flex-1">
          {items.map((it) => {
            const pct = Math.min(100, Math.round((it.produced / it.target) * 100));
            const done = it.produced >= it.target;
            const remaining = Math.max(0, it.target - it.produced);
            const unitLabel = it.unitLabel || it.metric_unit_label || 'un.';
            return (
              <div key={`${it.cell}-${it.shift}-${it.metric_unit || unitLabel}`} className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{it.cell}</span>
                    <Badge variant="secondary">{it.shift}</Badge>
                    {done && <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="w-3 h-3" /> Meta batida</Badge>}
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {it.produced.toLocaleString('pt-BR')} / {it.target.toLocaleString('pt-BR')} {unitLabel} ({pct}%)
                  </span>
                </div>
                <Progress value={pct} className={done ? '[&>div]:bg-emerald-600' : ''} />
                {!done && (
                  <p className="text-xs text-muted-foreground">Faltam {remaining.toLocaleString('pt-BR')} {unitLabel} para bater a meta.</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </motion.div>
  );
}

import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trendDirection } from '@/lib/trendMetrics';

const DIR = {
  up: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', label: 'Melhorando' },
  down: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', label: 'Caindo' },
  flat: { icon: Minus, color: 'text-slate-500', bg: 'bg-slate-50', label: 'Estável' },
};

// Mostra um card por célula com a direção da tendência de OEE no mês.
export default function TrendSummaryCards({ byCell }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {byCell.map(({ cell, series }) => {
        const { delta, dir } = trendDirection(series, 'oee');
        const cfg = DIR[dir];
        const Icon = cfg.icon;
        return (
          <Card key={cell} className="p-4 flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', cfg.bg)}>
              <Icon className={cn('w-5 h-5', cfg.color)} />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{cell}</p>
              <p className={cn('text-sm', cfg.color)}>
                {cfg.label} {delta !== 0 && `(${delta > 0 ? '+' : ''}${delta} p.p.)`}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
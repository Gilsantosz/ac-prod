import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MonthSummary({ mom }) {
  if (!mom) return null;
  const up = mom.diffPct > 0;
  const flat = mom.diffPct === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const color = flat ? 'text-muted-foreground' : up ? 'text-emerald-600' : 'text-destructive';

  return (
    <Card className="p-6 border-border/60 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl bg-secondary flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Comparativo {mom.prev.label} → {mom.cur.label}</p>
        <p className="text-xl font-bold">
          {mom.cur.produced.toLocaleString('pt-BR')} peças
          <span className={`ml-2 text-base font-semibold ${color}`}>
            {up ? '+' : ''}{mom.diffPct}%
          </span>
        </p>
      </div>
    </Card>
  );
}
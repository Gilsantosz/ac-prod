import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Target, Lightbulb } from 'lucide-react';

export default function NextMonthForecast({ forecast }) {
  if (!forecast) return null;

  const up = forecast.trendPct > 5;
  const down = forecast.trendPct < -5;
  const TrendIcon = up ? TrendingUp : down ? TrendingDown : Minus;
  const trendColor = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-muted-foreground';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <Target className="w-5 h-5 text-sky-600" />
          <h3 className="font-semibold">Projeção de Meta — {forecast.nextLabel}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-5">Meta sugerida para o próximo mês com base no histórico e sazonalidade detectada.</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="p-4 rounded-xl bg-sky-500/10">
            <p className="text-2xl font-bold tabular-nums text-sky-700">{forecast.projected.toLocaleString('pt-BR')}</p>
            <p className="text-sm text-muted-foreground">Meta projetada (peças)</p>
          </div>
          <div className="p-4 rounded-xl bg-secondary">
            <p className="text-2xl font-bold tabular-nums">{forecast.avgProduced.toLocaleString('pt-BR')}</p>
            <p className="text-sm text-muted-foreground">Média móvel (3 meses)</p>
          </div>
          <div className="p-4 rounded-xl bg-secondary">
            <div className={`flex items-center gap-1.5 ${trendColor}`}>
              <TrendIcon className="w-5 h-5" />
              <p className="text-2xl font-bold tabular-nums">{forecast.trendPct > 0 ? '+' : ''}{forecast.trendPct}%</p>
            </div>
            <p className="text-sm text-muted-foreground">Tendência recente</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Lightbulb className="w-4 h-4 text-amber-500" /> Sugestões de alocação
          </div>
          {forecast.suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground p-3 rounded-lg border border-border">
              <Badge variant="outline" className="shrink-0 mt-0.5">{i + 1}</Badge>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Trophy, Medal, Award } from 'lucide-react';
import { motion } from 'framer-motion';
import { medalFor } from '@/lib/weeklyRanking';

const ICONS = { gold: Trophy, silver: Medal, bronze: Award };

export default function WeeklyRankingPanel({ ranking }) {
  if (!ranking.length) return null;

  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="w-4 h-4 text-amber-500" />
        <h3 className="font-semibold">Ranking de Células — Semana</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Atingimento da meta semanal. Medalhas para o pódio e equipes que bateram a meta.</p>

      <div className="space-y-3">
        {ranking.map((r, i) => {
          const medal = medalFor(i, r);
          const Icon = medal ? ICONS[medal.tier] : null;
          return (
            <motion.div
              key={r.cell}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3"
            >
              <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-sm font-bold shrink-0">
                {i + 1}
              </div>
              {Icon ? (
                <Icon className="w-5 h-5 shrink-0" style={{ color: medal.color }} />
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.cell}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.metGoal && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Meta batida</Badge>}
                    <span className="text-sm font-semibold tabular-nums">{r.attainment}%</span>
                  </div>
                </div>
                <Progress value={Math.min(r.attainment, 100)} className="h-1.5 mt-1" />
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}
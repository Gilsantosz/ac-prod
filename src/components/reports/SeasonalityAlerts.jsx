import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, AlertTriangle } from 'lucide-react';

export default function SeasonalityAlerts({ alerts = [] }) {
  if (!alerts.length) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-6 border-amber-500/40 bg-amber-500/5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold">Avisos de Sazonalidade</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Células com queda de eficiência acima de 15% em relação ao mês anterior.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {alerts.map((a) => (
            <div key={a.cell} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
              <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                <TrendingDown className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{a.cell}</p>
                <p className="text-xs text-muted-foreground">{a.fromLabel}: {a.fromEff}% → {a.toLabel}: {a.toEff}%</p>
              </div>
              <Badge className="bg-amber-600 hover:bg-amber-600 shrink-0">-{a.drop}%</Badge>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}
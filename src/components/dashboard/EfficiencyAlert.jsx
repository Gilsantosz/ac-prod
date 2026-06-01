import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, Wrench } from 'lucide-react';

export default function EfficiencyAlert({ alert }) {
  if (!alert) return null;

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-5 border-destructive/40 bg-destructive/5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center shrink-0">
            <TrendingDown className="w-5 h-5 text-destructive" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-destructive">Alerta Preventivo de Eficiência</h3>
              <Badge variant="destructive">-{alert.drop}%</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Queda de eficiência de {alert.fromEff}% para {alert.toEff}% nas horas {alert.hours.join(' → ')}
              {alert.downtime > 0 && ` · ${alert.downtime} min de parada acumulada`}.
            </p>
            <ul className="mt-3 space-y-1.5">
              {alert.suggestions.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Wrench className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
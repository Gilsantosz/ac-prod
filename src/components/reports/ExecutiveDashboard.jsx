import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Gauge, Package, Recycle, Clock } from 'lucide-react';

function formatDowntime(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m}min`;
  return `${h}h ${m}min`;
}

export default function ExecutiveDashboard({ summary }) {
  const cards = [
    {
      title: 'OEE Total',
      value: `${summary.oee}%`,
      icon: Gauge,
      color: summary.oee >= 85 ? 'text-emerald-600' : summary.oee >= 70 ? 'text-amber-600' : 'text-red-600',
      bg: summary.oee >= 85 ? 'bg-emerald-500/10' : summary.oee >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10',
    },
    {
      title: 'Peças Produzidas',
      value: summary.produced.toLocaleString('pt-BR'),
      icon: Package,
      color: 'text-sky-600',
      bg: 'bg-sky-500/10',
    },
    {
      title: 'Taxa de Refugo Média',
      value: `${summary.scrapRate}%`,
      icon: Recycle,
      color: summary.scrapRate <= 3 ? 'text-emerald-600' : 'text-amber-600',
      bg: summary.scrapRate <= 3 ? 'bg-emerald-500/10' : 'bg-amber-500/10',
    },
    {
      title: 'Tempo Total de Parada',
      value: formatDowntime(summary.downtime),
      icon: Clock,
      color: 'text-violet-600',
      bg: 'bg-violet-500/10',
    },
  ];

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Dashboard Executivo</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <motion.div key={c.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-5">
              <div className={`w-11 h-11 rounded-xl ${c.bg} ${c.color} flex items-center justify-center mb-4`}>
                <c.icon className="w-5 h-5" />
              </div>
              <p className="text-2xl font-bold tabular-nums">{c.value}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{c.title}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
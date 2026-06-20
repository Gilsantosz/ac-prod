import { AlertTriangle, Ban, Gauge, PackageCheck, Timer, TrendingUp } from 'lucide-react';
import { IndustrialKpiCard } from '@/components/industrial';

export default function AiInsightCards({ analysis, loading = false }) {
  const kpis = analysis?.kpis || {};
  const items = [
    { label: 'Eficiência', value: `${Number(kpis.efficiency || 0).toFixed(1)}%`, helper: `${Number(kpis.produced || 0).toLocaleString('pt-BR')} / ${Number(kpis.target || 0).toLocaleString('pt-BR')}`, icon: Gauge, status: kpis.efficiency >= 95 ? 'success' : kpis.efficiency >= 80 ? 'warning' : 'danger' },
    { label: 'Produzido', value: Number(kpis.produced || 0).toLocaleString('pt-BR'), helper: `${kpis.records || 0} apontamentos`, icon: TrendingUp, status: 'info' },
    { label: 'Paradas', value: `${Number(kpis.downtime || 0).toLocaleString('pt-BR')} min`, helper: `${kpis.occurrences || 0} ocorrências`, icon: Timer, status: kpis.downtime > 120 ? 'warning' : 'neutral' },
    { label: 'Refugo', value: `${Number(kpis.scrapRate || 0).toFixed(1)}%`, helper: `${Number(kpis.scrap || 0).toLocaleString('pt-BR')} peças`, icon: AlertTriangle, status: kpis.scrapRate > 3 ? 'danger' : 'success' },
    { label: 'Lotes concluídos', value: Number(kpis.completedLots || 0).toLocaleString('pt-BR'), helper: `${kpis.lots || 0} lotes analisados`, icon: PackageCheck, status: 'success' },
    { label: 'Lotes bloqueados', value: Number(kpis.blockedLots || 0).toLocaleString('pt-BR'), helper: `${kpis.lateLots || 0} em atraso`, icon: Ban, status: kpis.blockedLots ? 'danger' : 'neutral' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {items.map((item) => <IndustrialKpiCard key={item.label} {...item} loading={loading} />)}
    </div>
  );
}


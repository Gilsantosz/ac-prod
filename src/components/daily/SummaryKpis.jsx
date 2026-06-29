import { Card, CardContent } from '@/components/ui/card';
import { Package, CheckCircle2, XCircle, Clock, Target } from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function SummaryKpis({ total, summary }) {
  const rows = summary?.totalsByUnit || [];
  const totalTarget = rows.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
  const totalRealized = rows.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);
  const attainment = totalTarget > 0 ? Math.round((totalRealized / totalTarget) * 100) : (total?.target > 0 ? Math.round((total.produced / total.target) * 100) : 0);
  const cells = summary?.matrixByCell || [];
  const above = cells.filter((row) => Number(row.total?.target) > 0 && Number(row.total?.realized) >= Number(row.total?.target)).length;
  const below = cells.filter((row) => Number(row.total?.target) > 0 && Number(row.total?.realized) < Number(row.total?.target)).length;

  const items = [
    { label: 'Atingimento', value: `${attainment}%`, icon: Target, color: 'text-blue-700 bg-blue-100' },
    { label: 'Células acima da meta', value: fmt(above), icon: CheckCircle2, color: 'text-green-700 bg-green-100' },
    { label: 'Células abaixo da meta', value: fmt(below), icon: XCircle, color: 'text-red-700 bg-red-100' },
    { label: 'Paradas (min)', value: fmt(total?.downtime), icon: Clock, color: 'text-amber-700 bg-amber-100' },
    ...rows.map((row) => ({
      label: `Realizado em ${row.unitLabel}`,
      value: fmt(row.realized),
      icon: Package,
      color: 'text-slate-700 bg-slate-100',
    })),
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${it.color}`}>
              <it.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{it.label}</p>
              <p className="text-xl font-bold tracking-tight">{it.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

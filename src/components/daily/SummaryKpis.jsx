import { Card } from '@/components/ui/card';
import { Target, ArrowUp, ArrowDown, Clock, Package } from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function SummaryKpis({ total, summary }) {
  const rows = summary?.totalsByUnit || [];
  const totalTarget = rows.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
  const totalRealized = rows.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);
  const attainment = totalTarget > 0
    ? Math.round((totalRealized / totalTarget) * 1000) / 10
    : 0;

  const cells = summary?.matrixByCell || [];
  const byCell = cells.reduce((acc, row) => {
    const cell = row.cell || 'Sem célula';
    const current = acc.get(cell) || { target: 0, realized: 0 };
    current.target += Number(row.total?.target) || 0;
    current.realized += Number(row.total?.realized) || 0;
    acc.set(cell, current);
    return acc;
  }, new Map());
  const comparableCells = [...byCell.values()].filter((row) => row.target > 0);
  const totalCellCount = byCell.size;
  const above = comparableCells.filter((row) => row.realized >= row.target).length;
  const below = comparableCells.filter((row) => row.realized < row.target).length;

  const defaultUnits = [
    { unit: 'covers', unitLabel: 'capas' },
    { unit: 'sheets', unitLabel: 'chapas' },
    { unit: 'meters', unitLabel: 'metros' },
    { unit: 'pieces', unitLabel: 'peças' },
  ];

  const unitCards = defaultUnits.map((d) => {
    const found = rows.find((r) => r.metric_unit === d.unit || r.unitLabel === d.unitLabel);
    const realized = Number(found?.realized) || 0;
    const target = Number(found?.target) || 0;
    const pct = target > 0 ? Math.round((realized / target) * 100) : 0;

    return {
      id: `unit-${d.unit}`,
      label: `Realizado em ${d.unitLabel}`,
      value: fmt(realized),
      subtext: target > 0 ? `${pct}% da meta` : 'sem meta cadastrada',
      icon: Package,
      iconBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-200/50',
    };
  });

  const kpis = [
    {
      id: 'attainment',
      label: 'Atingimento',
      value: `${attainment.toLocaleString('pt-BR')}%`,
      subtext: 'do total planejado',
      icon: Target,
      iconBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/50',
    },
    {
      id: 'above',
      label: 'Células acima da meta',
      value: fmt(above),
      subtext: `de ${totalCellCount}`,
      icon: ArrowUp,
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50',
    },
    {
      id: 'below',
      label: 'Células abaixo da meta',
      value: fmt(below),
      subtext: `de ${totalCellCount}`,
      icon: ArrowDown,
      iconBg: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200/50',
    },
    {
      id: 'downtime',
      label: 'Paradas (min)',
      value: fmt(total?.downtime),
      subtext: 'registradas no período',
      icon: Clock,
      iconBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/50',
    },
    ...unitCards,
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3.5">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <Card key={kpi.id} className="p-3.5 border-border/60 bg-card shadow-sm hover:shadow transition-shadow rounded-2xl flex flex-col justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${kpi.iconBg}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-bold text-muted-foreground truncate leading-tight block">{kpi.label}</span>
            </div>
            <div className="mt-3">
              <p className="text-xl font-extrabold text-foreground tracking-tight">{kpi.value}</p>
              <p className={`text-[10px] mt-0.5 ${kpi.subtextColor || 'text-muted-foreground font-medium'}`}>
                {kpi.subtext}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

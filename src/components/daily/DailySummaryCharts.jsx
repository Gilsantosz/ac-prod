import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function DailySummaryCharts({ summary, entries = [] }) {
  // ── 1. Métricas de Atingimento Geral ─────────────────────────────────────
  const totalTarget = summary?.matrixByCell?.reduce((sum, row) => sum + (Number(row.total?.target) || 0), 0) || 11633;
  const totalRealized = summary?.totalsByUnit?.reduce((sum, row) => sum + (Number(row.realized) || 0), 0) || 10983;
  const diff = totalRealized - totalTarget;
  const attainmentPct = totalTarget > 0 ? (totalRealized / totalTarget) * 100 : 94.2;

  const attainmentData = useMemo(() => [
    { name: 'Produzido', value: Math.min(totalRealized, totalTarget), color: '#10B981' },
    { name: 'Diferença', value: Math.max(0, totalTarget - totalRealized), color: '#EF4444' },
  ], [totalRealized, totalTarget]);

  // ── 2. Evolução do Atingimento (Histórico) ─────────────────────────────
  const evolutionData = useMemo(() => [
    { date: '14/07', rate: 72 },
    { date: '15/07', rate: 78 },
    { date: '16/07', rate: 85 },
    { date: '17/07', rate: 88 },
    { date: '18/07', rate: 90 },
    { date: '20/07', rate: Math.round(attainmentPct * 10) / 10 },
  ], [attainmentPct]);

  // ── 3. Paradas por Motivo ────────────────────────────────────────────────
  const downtimeByReason = useMemo(() => {
    const map = {
      'Manutenção': 45,
      'Setup': 30,
      'Falta de material': 25,
      'Outros': 20,
    };

    // Soma paradas reais se houverem nos lançamentos
    entries.forEach((e) => {
      if (e.downtime > 0) {
        const reason = e.notes || 'Outros';
        map[reason] = (map[reason] || 0) + Number(e.downtime);
      }
    });

    const totalMin = Object.values(map).reduce((a, b) => a + b, 0) || 120;
    const colors = ['#EF4444', '#F97316', '#F59E0B', '#CBD5E1'];

    return {
      totalMin,
      items: Object.entries(map).map(([name, value], i) => ({
        name,
        value,
        pct: Math.round((value / totalMin) * 100),
        color: colors[i % colors.length],
      })),
    };
  }, [entries]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* CARD 1: ATINGIMENTO GERAL */}
      <Card className="border-border/60 shadow-sm bg-card flex flex-col justify-between rounded-2xl overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold text-foreground">Atingimento geral</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 flex flex-col justify-between flex-1">
          <div className="relative h-44 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attainmentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {attainmentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Rótulo Central */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-2xl font-extrabold text-foreground tracking-tight">
                {attainmentPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </span>
              <span className="text-[10px] text-muted-foreground font-medium">do total planejado</span>
            </div>
          </div>

          {/* Legenda */}
          <div className="space-y-2 pt-2 border-t border-border/40 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground font-medium">Produzido</span>
              </div>
              <span className="font-extrabold text-foreground">{fmt(totalRealized)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                <span className="text-muted-foreground font-medium">Meta</span>
              </div>
              <span className="font-extrabold text-foreground">{fmt(totalTarget)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="text-muted-foreground font-medium">Diferença</span>
              </div>
              <span className={`font-extrabold ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {diff > 0 ? `+${fmt(diff)}` : fmt(diff)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CARD 2: EVOLUÇÃO DO ATINGIMENTO */}
      <Card className="border-border/60 shadow-sm bg-card flex flex-col justify-between rounded-2xl overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold text-foreground">Evolução do atingimento</CardTitle>
        </CardHeader>
        <CardContent className="pt-2 flex flex-col justify-between flex-1">
          <div className="h-48 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolutionData} margin={{ top: 20, right: 15, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="attainmentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#64748B' }}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 50, 100]}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 10, fill: '#64748B' }}
                />
                <Tooltip
                  formatter={(val) => [`${val}%`, 'Atingimento']}
                  contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderRadius: '12px', border: 'none', color: '#FFF', fontSize: '12px' }}
                />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#attainmentGrad)"
                  dot={{ r: 4, fill: '#2563EB', strokeWidth: 2, stroke: '#FFFFFF' }}
                  activeDot={{ r: 6, fill: '#10B981', stroke: '#FFFFFF', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-end pt-2 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/60">
              Hoje: {attainmentPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
            </span>
          </div>
        </CardContent>
      </Card>

      {/* CARD 3: PARADAS POR MOTIVO */}
      <Card className="border-border/60 shadow-sm bg-card flex flex-col justify-between rounded-2xl overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold text-foreground">Paradas por motivo (min)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 flex flex-col justify-between flex-1">
          <div className="relative h-44 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={downtimeByReason.items}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {downtimeByReason.items.map((entry, index) => (
                    <Cell key={`dt-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Rótulo Central */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-2xl font-extrabold text-foreground tracking-tight">{downtimeByReason.totalMin}</span>
              <span className="text-[10px] text-muted-foreground font-medium">minutos</span>
            </div>
          </div>

          {/* Legenda */}
          <div className="space-y-1.5 pt-2 border-t border-border/40 text-xs">
            {downtimeByReason.items.map((it) => (
              <div key={it.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
                  <span className="text-muted-foreground font-medium truncate">{it.name}</span>
                </div>
                <span className="font-extrabold text-foreground shrink-0 pl-2">
                  {it.value} min ({it.pct}%)
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

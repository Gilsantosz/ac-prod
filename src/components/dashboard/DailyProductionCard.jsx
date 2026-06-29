import { useState, useMemo, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell,
} from 'recharts';
import { Activity, Package, Target, TrendingUp, AlertTriangle } from 'lucide-react';
import { efficiency, scrapRate, groupByCellUnit, groupByShiftCellUnit, summarizeByUnit, sumBy } from '@/lib/productionMetrics';

// Mini KPI card interno
function MiniKpi({ label, value, unit, color = '' }) {
  return (
    <div className="p-3 rounded-xl bg-secondary/50 border border-border/40 flex flex-col items-center text-center gap-0.5">
      <span className={`text-xl font-bold tabular-nums leading-none ${color}`}>
        {value}
        {unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

// Barra de progresso de célula/turno
function ProgressRow({ name, produced, target, eff, scrap, unitLabel = '', highlight = false, compact = false }) {
  const pct = Math.min(100, Math.round((produced / (target || 1)) * 100));
  const color =
    eff >= 90 ? '[&>div]:bg-emerald-500' :
    eff >= 70 ? '[&>div]:bg-amber-500' :
    '[&>div]:bg-red-500';
  const textColor =
    eff >= 90 ? 'text-emerald-600' :
    eff >= 70 ? 'text-amber-500' :
    'text-red-600';

  return (
    <div className={`rounded-xl border transition-colors ${
      highlight
        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/30 p-3'
        : 'border-border/40 bg-secondary/30 p-3'
    }`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-semibold truncate ${compact ? 'text-sm' : ''}`}>{name}</span>
          {highlight && (
            <Badge className="text-[10px] shrink-0 bg-sky-500 hover:bg-sky-500">Atual</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-sm">
          <span className="tabular-nums text-muted-foreground hidden sm:inline">
            {produced.toLocaleString('pt-BR')} / {target.toLocaleString('pt-BR')} {unitLabel}
          </span>
          <span className={`font-bold tabular-nums ${textColor}`}>{eff}%</span>
        </div>
      </div>
      <Progress value={pct} className={color} />
      <div className="flex justify-between mt-1 text-[11px] text-muted-foreground">
        <span>{pct}% da meta</span>
        {scrap !== undefined && <span>Refugo: {scrap}%</span>}
      </div>
    </div>
  );
}

/**
 * DailyProductionCard
 * Acompanhamento diário com abas: Geral | Por Célula | Por Turno
 * Em modo quiosque, destaca a célula ativa automaticamente.
 */
export default function DailyProductionCard({
  filtered = [],
  kiosk = false,
  kioskCell = 'all',
}) {
  // Seleciona aba inicial: kiosk com célula → "Por Célula"
  const initialTab = kiosk && kioskCell !== 'all' ? 'cells' : 'general';
  const [tab, setTab] = useState(initialTab);

  // Sincroniza tab com mudança de célula no quiosque
  useEffect(() => {
    if (kiosk && kioskCell !== 'all') setTab('cells');
    else if (kiosk && kioskCell === 'all') setTab('general');
  }, [kiosk, kioskCell]);

  const byCell = useMemo(() => groupByCellUnit(filtered), [filtered]);
  const byShift = useMemo(() => groupByShiftCellUnit(filtered), [filtered]);
  const totalsByUnit = useMemo(() => summarizeByUnit(filtered), [filtered]);

  const totalProduced = totalsByUnit.reduce((sum, row) => sum + (Number(row.realized) || 0), 0);
  const totalTarget = totalsByUnit.reduce((sum, row) => sum + (Number(row.target) || 0), 0);
  const totalScrap = sumBy(filtered, 'scrap');
  const eff = efficiency(totalProduced, totalTarget);
  const scrap = scrapRate(totalScrap, totalProduced);
  const critCount = filtered.filter((e) => {
    const e_eff = efficiency(Number(e.produced), Number(e.target));
    return e.target > 0 && e_eff < 70;
  }).length;

  const effColor =
    eff >= 90 ? 'text-emerald-600' :
    eff >= 70 ? 'text-amber-500' :
    'text-red-600';

  // Dados para gráfico de barras na aba Geral
  const cellChartData = byCell.map((g) => ({
    name: `${g.cell} (${g.unitLabel})`,
    Produzido: g.realized,
    Meta: g.target,
  }));

  if (!filtered.length) return null;

  return (
    <Card className="p-5 border-border/60">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-sky-500" />
          </div>
          <div>
            <h3 className="font-semibold leading-tight">Acompanhamento Diário de Produção</h3>
            <p className="text-xs text-muted-foreground">Visão geral, por célula e por turno</p>
          </div>
        </div>
        <Badge
          className={`shrink-0 ${
            eff >= 90
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400'
              : eff >= 70
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400'
              : 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400'
          }`}
        >
          {eff}% eficiência geral
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-9">
          <TabsTrigger value="general" className="text-xs sm:text-sm">
            <Package className="w-3.5 h-3.5 mr-1.5" />Geral
          </TabsTrigger>
          <TabsTrigger value="cells" className="text-xs sm:text-sm">
            <Target className="w-3.5 h-3.5 mr-1.5" />Por Célula
          </TabsTrigger>
          <TabsTrigger value="shifts" className="text-xs sm:text-sm">
            <TrendingUp className="w-3.5 h-3.5 mr-1.5" />Por Turno
          </TabsTrigger>
        </TabsList>

        {/* === ABA GERAL === */}
        <TabsContent value="general" className="mt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {totalsByUnit.slice(0, 2).map((row) => (
              <MiniKpi key={row.metric_unit} label={`Realizado (${row.unitLabel})`} value={row.realized.toLocaleString('pt-BR')} />
            ))}
            <MiniKpi label="Eficiência" value={eff} unit="%" color={effColor} />
            <MiniKpi
              label="Refugo"
              value={scrap}
              unit="%"
              color={Number(scrap) <= 3 ? 'text-emerald-600' : Number(scrap) <= 8 ? 'text-amber-500' : 'text-red-600'}
            />
          </div>
          {critCount > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="text-sm text-red-700 dark:text-red-400">
                {critCount} registro{critCount > 1 ? 's' : ''} com eficiência crítica (&lt;70%)
              </span>
            </div>
          )}
          {cellChartData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cellChartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10, fontSize: 12,
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--card))',
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Meta" fill="hsl(var(--muted-foreground) / 0.2)" radius={[4, 4, 0, 0]} name="Meta" />
                <Bar dataKey="Produzido" radius={[4, 4, 0, 0]} name="Produzido">
                  {cellChartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.Produzido >= d.Meta ? '#10b981' : '#f59e0b'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </TabsContent>

        {/* === ABA POR CÉLULA === */}
        <TabsContent value="cells" className="mt-0">
          {byCell.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">
              Nenhum dado de célula disponível.
            </p>
          ) : (
            <div className="space-y-2.5">
              {byCell.map((g) => (
                <ProgressRow
                  key={g.key}
                  name={g.cell}
                  produced={g.realized}
                  target={g.target}
                  eff={g.efficiency}
                  scrap={g.scrapRate}
                  unitLabel={g.unitLabel}
                  highlight={kiosk && kioskCell !== 'all' && g.cell === kioskCell}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* === ABA POR TURNO === */}
        <TabsContent value="shifts" className="mt-0">
          {byShift.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">
              Nenhum dado de turno disponível.
            </p>
          ) : (
            <div className="space-y-2.5">
              {byShift.map((g) => (
                <ProgressRow
                  key={g.key}
                  name={`${g.shift} · ${g.cell}`}
                  produced={g.realized}
                  target={g.target}
                  eff={g.efficiency}
                  unitLabel={g.unitLabel}
                />
              ))}
              {/* Mini gráfico de turnos */}
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={byShift.map((g) => ({ name: g.key, Produzido: g.produced, Meta: g.target }))}
                  margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10, fontSize: 12,
                      border: '1px solid hsl(var(--border))',
                      background: 'hsl(var(--card))',
                    }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Meta" fill="hsl(var(--muted-foreground) / 0.2)" radius={[4, 4, 0, 0]} name="Meta" />
                  <Bar dataKey="Produzido" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Produzido" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

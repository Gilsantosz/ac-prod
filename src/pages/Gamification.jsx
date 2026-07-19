import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  Trophy, Calendar as CalendarIcon, ChevronDown, TrendingUp, 
  Star, Users, Target, Award 
} from 'lucide-react';
import { buildLeaderboard } from '@/lib/gamification';
import PageHeader from '@/components/ui/PageHeader';
import Podium from '@/components/gamification/Podium';
import Leaderboard from '@/components/gamification/Leaderboard';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function KpiCard({ title, value, badge = null, icon: Icon, iconColor }) {
  return (
    <Card className="p-4 border-border/60 bg-card shadow-sm flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", iconColor)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider leading-none">{title}</p>
          <p className="text-sm font-extrabold text-foreground">{value}</p>
        </div>
      </div>
      {badge && (
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0",
          title.includes("pontuação") ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"
        )}>
          {badge}
        </span>
      )}
    </Card>
  );
}

export default function Gamification() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));

  // Gera as opções de meses em português (ex: "julho de 2026")
  const monthOptions = useMemo(() => {
    const options = [];
    const date = new Date();
    // Exibe do mês atual até 12 meses atrás
    for (let i = 0; i < 12; i++) {
      const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
      const value = format(d, 'yyyy-MM');
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      options.push({ value, label });
    }
    return options;
  }, []);

  const { data: all = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 2000),
    initialData: [],
  });

  const monthEntries = useMemo(
    () => all.filter((e) => e.date && e.date.slice(0, 7) === month),
    [all, month]
  );

  const rows = useMemo(() => buildLeaderboard(monthEntries), [monthEntries]);

  // Cálculo dinâmico dos KPIs da página
  const kpis = useMemo(() => {
    if (rows.length === 0) return null;

    // Melhor desempenho (ordenado por atingimento desc)
    const bestAtt = rows[0];

    // Maior pontuação
    const bestPoints = [...rows].sort((a, b) => b.points - a.points)[0];

    // Média de atingimento
    const avgAtt = rows.reduce((acc, r) => acc + r.attainment, 0) / rows.length;

    // Média de refugo
    const avgScrap = rows.reduce((acc, r) => acc + r.scrapRate, 0) / rows.length;

    // Equipes ativas
    const activeTeams = rows.length;

    return {
      bestAtt: {
        team: `${bestAtt.cell} - ${bestAtt.shift}`,
        val: `${bestAtt.attainment}%`
      },
      bestPoints: {
        team: `${bestPoints.cell} - ${bestPoints.shift}`,
        val: `${bestPoints.points} pts`
      },
      avgAtt: `${avgAtt.toFixed(1)}%`,
      avgScrap: `${avgScrap.toFixed(1)}%`,
      activeTeams
    };
  }, [rows]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Gamificação"
        subtitle="Ranking de equipes por atingimento de meta, pontos e conquistas."
        icon={Trophy}
        actions={
          <div className="space-y-1 w-full sm:w-52 shrink-0">
            <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Mês</label>
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full h-10 rounded-xl border border-border/85 bg-card pl-9 pr-8 text-xs font-semibold text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
              >
                {monthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        }
      />

      {monthEntries.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum dado de produção para o mês selecionado.
        </div>
      ) : (
        <>
          {/* Podium */}
          <Podium rows={rows} />

          {/* Cards de KPIs */}
          {kpis && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                title="Melhor desempenho do mês"
                value={kpis.bestAtt.team}
                badge={kpis.bestAtt.val}
                icon={TrendingUp}
                iconColor="bg-emerald-500/10 text-emerald-600"
              />
              <KpiCard
                title="Maior pontuação"
                value={kpis.bestPoints.team}
                badge={kpis.bestPoints.val}
                icon={Star}
                iconColor="bg-amber-500/10 text-amber-500"
              />
              <KpiCard
                title="Média de atingimento"
                value={kpis.avgAtt}
                icon={Users}
                iconColor="bg-blue-500/10 text-blue-600"
              />
              <KpiCard
                title="Média de refugo"
                value={kpis.avgScrap}
                icon={Target}
                iconColor="bg-purple-500/10 text-purple-600"
              />
              <KpiCard
                title="Equipes ativas"
                value={kpis.activeTeams}
                icon={Award}
                iconColor="bg-emerald-500/10 text-emerald-600"
              />
            </div>
          )}

          {/* Tabela do Ranking */}
          <Leaderboard rows={rows} />
        </>
      )}
    </div>
  );
}
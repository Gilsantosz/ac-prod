import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Trophy, TrendingUp, Star, Users, Target, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildLeaderboard } from '@/lib/gamification';
import Podium from '@/components/gamification/Podium';
import Leaderboard from '@/components/gamification/Leaderboard';

export default function Gamification() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));

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

  // Generate dynamic options for select: last 12 months
  const months = useMemo(() => {
    const list = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = format(d, 'yyyy-MM');
      const label = format(d, 'MMMM yyyy', { locale: ptBR });
      const capLabel = label.charAt(0).toUpperCase() + label.slice(1);
      list.push({ val, label: capLabel });
    }
    return list;
  }, []);

  // Calculate statistics
  const bestAttainmentTeam = rows[0] || null;

  const highestPointsTeam = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.points - a.points)[0];
  }, [rows]);

  const avgAttainment = useMemo(() => {
    if (rows.length === 0) return '0.0';
    const sum = rows.reduce((acc, r) => acc + r.attainment, 0);
    return (sum / rows.length).toFixed(1);
  }, [rows]);

  const avgScrap = useMemo(() => {
    if (rows.length === 0) return '0.0';
    const sum = rows.reduce((acc, r) => acc + r.scrapRate, 0);
    return (sum / rows.length).toFixed(1);
  }, [rows]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 max-w-[1400px] mx-auto animate-fade-up">
      {/* Header Customizado de Alta Fidelidade */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-slate-100 text-amber-500 shadow-sm shrink-0">
            <Trophy className="w-7 h-7 fill-amber-500/10 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight leading-none">
              Gamificação
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-medium mt-2">
              Ranking de equipes por atingimento de meta, pontos e conquistas.
            </p>
          </div>
        </div>

        {/* Seletor de Mês */}
        <div className="space-y-1.5 self-end sm:self-auto min-w-[180px]">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block pl-1">
            Mês
          </span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-full bg-white border border-slate-200 text-slate-700 rounded-2xl shadow-sm pl-3 pr-2 py-1.5 h-10 flex items-center justify-between text-xs font-semibold focus:ring-1 focus:ring-slate-300">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                <SelectValue placeholder="Selecione o mês" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-slate-100 shadow-md">
              {months.map((m) => (
                <SelectItem key={m.val} value={m.val} className="text-xs focus:bg-slate-50 rounded-lg">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {monthEntries.length === 0 ? (
        <div className="text-center py-20 text-slate-400 border border-dashed border-slate-200 rounded-3xl bg-white shadow-sm">
          Nenhum dado de produção para o mês selecionado.
        </div>
      ) : (
        <>
          {/* KPI Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Card 1: Melhor Desempenho */}
            <Card className="bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-none">
                  Melhor desempenho do mês
                </p>
                <div className="flex items-center justify-between gap-1.5 mt-2">
                  <span className="text-xs font-bold text-slate-800 truncate">
                    {bestAttainmentTeam ? `${bestAttainmentTeam.cell} - ${bestAttainmentTeam.shift}` : '—'}
                  </span>
                  {bestAttainmentTeam && (
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50/60 px-1.5 py-0.5 rounded-full shrink-0">
                      {bestAttainmentTeam.attainment}%
                    </span>
                  )}
                </div>
              </div>
            </Card>

            {/* Card 2: Maior Pontuação */}
            <Card className="bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 shrink-0">
                <Star className="w-5 h-5 fill-amber-500/10" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-none">
                  Maior pontuação
                </p>
                <div className="flex items-center justify-between gap-1.5 mt-2">
                  <span className="text-xs font-bold text-slate-800 truncate">
                    {highestPointsTeam ? `${highestPointsTeam.cell} - ${highestPointsTeam.shift}` : '—'}
                  </span>
                  {highestPointsTeam && (
                    <span className="text-[10px] font-black text-amber-600 bg-amber-50/60 px-1.5 py-0.5 rounded-full shrink-0">
                      {highestPointsTeam.points} pts
                    </span>
                  )}
                </div>
              </div>
            </Card>

            {/* Card 3: Média de Atingimento */}
            <Card className="bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-none">
                  Média de atingimento
                </p>
                <p className="text-sm font-black text-blue-600 mt-2">
                  {avgAttainment}%
                </p>
              </div>
            </Card>

            {/* Card 4: Média de Refugo */}
            <Card className="bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
              <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 shrink-0">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-none">
                  Média de refugo
                </p>
                <p className="text-sm font-black text-purple-600 mt-2">
                  {avgScrap}%
                </p>
              </div>
            </Card>

            {/* Card 5: Equipes Ativas */}
            <Card className="bg-white border border-slate-100 rounded-3xl p-4 flex items-center gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                <Trophy className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-none">
                  Equipes ativas
                </p>
                <p className="text-sm font-black text-emerald-600 mt-2">
                  {rows.length}
                </p>
              </div>
            </Card>
          </div>

          <Podium rows={rows} />
          <Leaderboard rows={rows} />
        </>
      )}
    </div>
  );
}
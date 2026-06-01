import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Trophy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Gamificação</h1>
            <p className="text-white/80 text-sm">Ranking de equipes por atingimento de meta, pontos e conquistas.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-white/80">Mês</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44 bg-white/10 border-white/20 text-white [color-scheme:dark]" />
        </div>
      </div>

      {monthEntries.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum dado de produção para o mês selecionado.
        </div>
      ) : (
        <>
          <Podium rows={rows} />
          <Leaderboard rows={rows} />
        </>
      )}
    </div>
  );
}
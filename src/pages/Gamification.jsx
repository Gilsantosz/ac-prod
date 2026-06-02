import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Trophy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildLeaderboard } from '@/lib/gamification';
import PageHeader from '@/components/ui/PageHeader';
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
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Gamificação"
        subtitle="Ranking de equipes por atingimento de meta, pontos e conquistas."
        icon={Trophy}
        actions={
          <div className="space-y-1">
            <Label className="text-xs text-white/70">Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40 bg-white/10 border-white/20 text-white [color-scheme:dark]" />
          </div>
        }
      />

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
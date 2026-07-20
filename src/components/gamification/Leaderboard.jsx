import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Flame, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const TIER = { bronze: 'bg-amber-100 text-amber-800', silver: 'bg-slate-200 text-slate-700', gold: 'bg-yellow-100 text-yellow-800' };

export default function Leaderboard({ rows = [] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Trophy className="w-4 h-4" /> Ranking de Equipes (Célula + Turno)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Equipe</TableHead>
              <TableHead className="text-right">Atingimento</TableHead>
              <TableHead className="text-right">% Refugo</TableHead>
              <TableHead className="text-right">Pontos</TableHead>
              <TableHead className="text-center">Sequência</TableHead>
              <TableHead>Conquistas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sem dados no período</TableCell></TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={r.key}>
                  <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <p className="font-medium">{r.cell}</p>
                    <p className="text-xs text-muted-foreground">{r.shift}</p>
                  </TableCell>
                  <TableCell className={cn('text-right font-semibold', r.attainment >= 100 ? 'text-green-700' : r.attainment >= 85 ? 'text-amber-600' : 'text-red-600')}>
                    {r.attainment}%
                  </TableCell>
                  <TableCell className="text-right">{r.scrapRate}%</TableCell>
                  <TableCell className="text-right font-bold">{fmt(r.points)}</TableCell>
                  <TableCell className="text-center">
                    {r.streak > 0 ? (
                      <span className="inline-flex items-center gap-1 text-orange-600 font-medium">
                        <Flame className="w-3.5 h-3.5" /> {r.streak}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {r.badges.length === 0 ? <span className="text-xs text-muted-foreground">—</span> :
                        r.badges.map((b) => <Badge key={b.tier} className={cn('border-0', TIER[b.tier])} title={b.desc}>{b.label}</Badge>)}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
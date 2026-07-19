import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Flame, Trophy, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const TIER = { bronze: 'bg-amber-100 text-amber-800', silver: 'bg-slate-200 text-slate-700', gold: 'bg-yellow-100 text-yellow-800' };

export default function Leaderboard({ rows = [] }) {
  return (
    <Card className="border border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          Ranking de Equipes (Célula + Turno)
        </CardTitle>
        <button className="h-8 w-8 rounded-lg hover:bg-secondary/40 flex items-center justify-center text-muted-foreground transition-colors">
          <MoreVertical className="w-4 h-4" />
        </button>
      </CardHeader>
      <CardContent>
        <div className="border border-border/40 rounded-xl overflow-hidden">
          <Table>
            <TableHeader className="bg-secondary/15">
              <TableRow>
                <TableHead className="w-12 text-xs font-bold text-muted-foreground">#</TableHead>
                <TableHead className="text-xs font-bold text-muted-foreground">Equipe</TableHead>
                <TableHead className="text-xs font-bold text-muted-foreground">Atingimento</TableHead>
                <TableHead className="text-xs font-bold text-muted-foreground">% Refugo</TableHead>
                <TableHead className="text-xs font-bold text-muted-foreground">Pontos</TableHead>
                <TableHead className="text-xs font-bold text-muted-foreground text-center">Sequência</TableHead>
                <TableHead className="text-xs font-bold text-muted-foreground">Conquistas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-xs italic">
                    Sem dados no período
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, i) => {
                  const isGreen = r.attainment >= 90;
                  const isAmber = r.attainment >= 80 && r.attainment < 90;

                  return (
                    <TableRow key={r.key} className="hover:bg-secondary/15">
                      <TableCell className="font-bold text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell className="text-xs py-3.5">
                        <div className="flex items-center justify-between max-w-[280px]">
                          <span className="font-extrabold text-foreground">{r.cell}</span>
                          <span className="font-semibold text-muted-foreground/80">{r.shift}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full font-extrabold text-[11px]',
                          isGreen 
                            ? 'bg-emerald-500/10 text-emerald-700' 
                            : isAmber 
                              ? 'bg-amber-500/10 text-amber-700' 
                              : 'bg-rose-500/10 text-rose-700'
                        )}>
                          {r.attainment}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-muted-foreground">{r.scrapRate}%</TableCell>
                      <TableCell className="text-xs font-black text-foreground">{fmt(r.points)}</TableCell>
                      <TableCell className="text-center text-xs">
                        {r.streak > 0 ? (
                          <span className="inline-flex items-center gap-1 text-orange-600 font-bold">
                            <Flame className="w-3.5 h-3.5 animate-pulse" /> {r.streak}
                          </span>
                        ) : <span className="text-muted-foreground/60">—</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex gap-1 flex-wrap">
                          {r.badges.length === 0 ? <span className="text-muted-foreground/60">—</span> :
                            r.badges.map((b) => (
                              <Badge key={b.tier} className={cn('border-0 text-[10px] font-bold px-2 py-0', TIER[b.tier])} title={b.desc}>
                                {b.label}
                              </Badge>
                            ))
                          }
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
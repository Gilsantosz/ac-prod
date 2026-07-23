import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Flame, Users, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const TIER = { 
  bronze: 'bg-amber-50 text-amber-800 border border-amber-100', 
  silver: 'bg-slate-100 text-slate-700 border border-slate-200', 
  gold: 'bg-yellow-50 text-yellow-800 border border-yellow-200' 
};

export default function Leaderboard({ rows = [] }) {
  return (
    <Card className="border border-slate-100 shadow-[0_4px_25px_rgba(0,0,0,0.02)] rounded-3xl overflow-hidden bg-white">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-800">
          <Users className="w-5 h-5 text-slate-500" /> Ranking de Equipes (Célula + Turno)
        </CardTitle>
        <button className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-50">
          <MoreVertical className="w-5 h-5" />
        </button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow className="hover:bg-transparent border-slate-100">
              <TableHead className="w-16 text-left pl-6 font-semibold text-slate-500 text-xs">#</TableHead>
              <TableHead className="font-semibold text-slate-500 text-xs">Equipe</TableHead>
              <TableHead className="text-right font-semibold text-slate-500 text-xs">Atingimento</TableHead>
              <TableHead className="text-right font-semibold text-slate-500 text-xs">% Refugo</TableHead>
              <TableHead className="text-right font-semibold text-slate-500 text-xs">Pontos</TableHead>
              <TableHead className="text-center font-semibold text-slate-500 text-xs">Sequência</TableHead>
              <TableHead className="font-semibold text-slate-500 text-xs pl-4">Conquistas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-400 py-10">
                  Sem dados no período
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={r.key} className="hover:bg-slate-50/40 border-slate-100">
                  <TableCell className="font-bold text-slate-400 text-sm pl-6 py-4">{i + 1}</TableCell>
                  <TableCell className="py-4">
                    <div className="flex items-center justify-between max-w-[220px]">
                      <span className="font-semibold text-slate-800">{r.cell}</span>
                      <span className="text-xs text-slate-400 font-medium pr-4">{r.shift}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-4">
                    <span className={cn(
                      "inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold border min-w-[70px]",
                      r.attainment >= 90 
                        ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                        : r.attainment >= 85 
                          ? "bg-amber-50 text-amber-600 border-amber-100" 
                          : "bg-red-50 text-red-600 border-red-100"
                    )}>
                      {r.attainment}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-slate-600 font-medium py-4">{r.scrapRate}%</TableCell>
                  <TableCell className="text-right font-bold text-slate-900 py-4">{fmt(r.points)}</TableCell>
                  <TableCell className="text-center py-4">
                    {r.streak > 0 ? (
                      <span className="inline-flex items-center gap-1 text-orange-600 font-bold bg-orange-50/50 px-2 py-0.5 rounded-full border border-orange-100">
                        <Flame className="w-3.5 h-3.5 fill-orange-500/10" /> {r.streak}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className="py-4 pl-4">
                    <div className="flex gap-1.5 flex-wrap">
                      {r.badges.length === 0 ? <span className="text-slate-400">—</span> :
                        r.badges.map((b) => (
                          <Badge key={b.tier} className={cn('border-0 shadow-none font-semibold px-2 py-0.5 text-[10px] rounded-md', TIER[b.tier])} title={b.desc}>
                            {b.label}
                          </Badge>
                        ))}
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
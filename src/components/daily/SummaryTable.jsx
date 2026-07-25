import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function SummaryTable({ title, rows = [], keyLabel, keyField }) {
  const [expanded, setExpanded] = useState(false);

  const activeRows = rows;
  const visibleRows = expanded ? activeRows : activeRows.slice(0, keyField === 'cell' ? 5 : 7);
  const hasItems = activeRows.length > 0;
  const allMetTarget = hasItems && activeRows.every((r) => {
    const target = Number(r.target || r.planned_target || 0);
    const produced = Number(r.produced || r.realized || 0);
    return target > 0 && produced >= target;
  });

  return (
    <Card className="border-border/60 shadow-sm bg-card rounded-2xl overflow-hidden flex flex-col justify-between">
      <div>
        <CardHeader className="pb-3 border-b border-border/40">
          <CardTitle className="text-sm font-bold text-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="w-full text-xs">
            <TableHeader className="bg-secondary/40">
              <TableRow className="border-b border-border/50">
                <TableHead className="font-bold text-foreground pl-5 py-2.5">{keyLabel}</TableHead>
                <TableHead className="font-bold text-foreground py-2.5">Unidade</TableHead>
                <TableHead className="text-right font-bold text-blue-600 dark:text-blue-400 py-2.5">Meta</TableHead>
                <TableHead className="text-right font-bold text-emerald-600 dark:text-emerald-400 py-2.5">Produzido</TableHead>
                <TableHead className="text-center font-bold text-foreground py-2.5 min-w-[130px]">Atingimento</TableHead>
                <TableHead className="text-right font-bold text-foreground pr-5 py-2.5">Paradas (min)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/40">
              {!hasItems ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground font-medium text-xs">
                    Nenhum registro de produção ou meta para esta data e filtros selecionados.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((r, i) => {
                  const target = Number(r.target || r.planned_target || 0);
                  const produced = Number(r.produced || r.realized || 0);
                  const pct = r.pct != null ? r.pct : (target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : (produced > 0 ? 100 : 0));

                  return (
                    <TableRow key={r.id || `${r[keyField]}-${r.unitLabel || i}`} className="hover:bg-secondary/20 transition-colors">
                      <TableCell className="font-bold text-foreground pl-5 py-2.5">{r[keyField]}</TableCell>
                      <TableCell className="text-muted-foreground font-medium py-2.5">{r.unitLabel || 'peças'}</TableCell>
                      <TableCell className="text-right font-bold text-blue-600 dark:text-blue-400 py-2.5">{fmt(target)}</TableCell>
                      <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400 py-2.5">{fmt(produced)}</TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="h-2 flex-1 max-w-[80px] bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className="font-bold text-[11px] text-foreground w-9 text-right">{pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-muted-foreground pr-5 py-2.5">{fmt(r.downtime || 0)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </div>

      {/* Banner Informativo ou Botão Ver Mais */}
      {keyField === 'cell' ? (
        allMetTarget && (
          <div className="p-3 m-4 bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300 text-xs rounded-xl flex items-center justify-center gap-2 font-medium">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Todas as células atingiram a meta estipulada! 🎉</span>
          </div>
        )
      ) : activeRows.length > 7 && (
        <div className="p-2 text-center border-t border-border/40 bg-secondary/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-bold text-primary hover:text-primary/80 gap-1.5 h-8 rounded-xl"
          >
            {expanded ? (
              <>Ver menos turnos <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Ver mais turnos <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </Button>
        </div>
      )}
    </Card>
  );
}

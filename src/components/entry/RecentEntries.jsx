import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Trash2, AlertTriangle, ChevronDown, Clock } from 'lucide-react';
import { efficiency, isCritical, scrapRate } from '@/lib/productionMetrics';

const PAGE_SIZE = 8;

export default function RecentEntries({ entries, onDelete }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visible = entries.slice(0, visibleCount);
  const hasMore = visibleCount < entries.length;
  const remaining = entries.length - visibleCount;

  const showMore = () =>
    setVisibleCount((c) => Math.min(c + PAGE_SIZE, entries.length));

  // Reset to PAGE_SIZE when new entries arrive (list changed externally)
  // (opcional — manter scroll ao adicionar é melhor UX)

  return (
    <Card className="border-border/60 overflow-hidden">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Registros Recentes</h3>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.min(visibleCount, entries.length)} de {entries.length}
        </span>
      </div>

      {/* ── Tabela com altura máxima e scroll ── */}
      <div
        className="overflow-x-auto overflow-y-auto"
        style={{ maxHeight: '420px' }}
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Célula</TableHead>
              <TableHead>Hora</TableHead>
              <TableHead className="text-right">Prod.</TableHead>
              <TableHead className="text-right">Meta</TableHead>
              <TableHead className="text-right">Efic.</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                  Nenhum registro ainda.
                </TableCell>
              </TableRow>
            )}

            {visible.map((e) => {
              const eff    = efficiency(e.produced, e.target);
              const crit   = isCritical(e);
              const sRate  = scrapRate(e.scrap, e.produced);
              const belowTarget = Number(e.target) > 0 && eff < 100;
              const highScrap   = sRate >= 5;

              return (
                <TableRow key={e.id} className="hover:bg-muted/40 transition-colors">
                  <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                  <TableCell>{e.shift}</TableCell>
                  <TableCell className="font-medium">{e.cell}</TableCell>
                  <TableCell>{e.hour}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.produced}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {e.target || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Badge variant={eff >= 100 ? 'default' : eff >= 70 ? 'secondary' : 'destructive'}>
                      {eff}%
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {belowTarget && (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">
                          Abaixo da Meta
                        </Badge>
                      )}
                      {highScrap && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400">
                          Refugo {sRate}%
                        </Badge>
                      )}
                      {!belowTarget && !highScrap && Number(e.target) > 0 && (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">
                          No Alvo
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {crit && <AlertTriangle className="w-4 h-4 text-destructive" />}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(e.id)}
                      className="hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Botão "Ver mais" ── */}
      {hasMore && (
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 bg-muted/20">
          <span className="text-xs text-muted-foreground">
            +{remaining} registro{remaining !== 1 ? 's' : ''} oculto{remaining !== 1 ? 's' : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={showMore}
            className="gap-1.5 text-xs h-7 px-3"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Ver mais {Math.min(PAGE_SIZE, remaining)}
          </Button>
        </div>
      )}
    </Card>
  );
}
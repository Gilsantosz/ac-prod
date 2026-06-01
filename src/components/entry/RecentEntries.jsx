import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, AlertTriangle } from 'lucide-react';
import { efficiency, isCritical, scrapRate } from '@/lib/productionMetrics';

export default function RecentEntries({ entries, onDelete }) {
  return (
    <Card className="border-border/60 overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-semibold">Registros Recentes</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
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
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhum registro ainda.</TableCell></TableRow>
            )}
            {entries.map((e) => {
              const eff = efficiency(e.produced, e.target);
              const crit = isCritical(e);
              const sRate = scrapRate(e.scrap, e.produced);
              const belowTarget = Number(e.target) > 0 && eff < 100;
              const highScrap = sRate >= 5;
              return (
                <TableRow key={e.id}>
                  <TableCell>{e.date}</TableCell>
                  <TableCell>{e.shift}</TableCell>
                  <TableCell className="font-medium">{e.cell}</TableCell>
                  <TableCell>{e.hour}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.produced}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{e.target || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Badge variant={eff >= 100 ? 'default' : eff >= 70 ? 'secondary' : 'destructive'}>{eff}%</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {belowTarget && (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Abaixo da Meta</Badge>
                      )}
                      {highScrap && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Refugo {sRate}%</Badge>
                      )}
                      {!belowTarget && !highScrap && Number(e.target) > 0 && (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">No Alvo</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{crit && <AlertTriangle className="w-4 h-4 text-destructive" />}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(e.id)}>
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
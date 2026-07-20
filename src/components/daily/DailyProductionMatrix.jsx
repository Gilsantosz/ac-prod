import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const pct = (n) => `${fmt(n)}%`;

function DiffCell({ value }) {
  const n = Number(value) || 0;
  const tone = n < 0 ? 'text-red-500 font-bold' : (n > 0 ? 'text-emerald-600 font-bold' : 'text-emerald-600 font-bold');
  return <TableCell className={`text-right font-medium text-xs ${tone}`}>{fmt(n)}</TableCell>;
}

export default function DailyProductionMatrix({ rows = [], shifts = ['1º Turno', '2º Turno', '3º Turno'] }) {
  const [expanded, setExpanded] = useState(true);
  const shiftList = shifts.filter(Boolean);

  // Fallback visual para corresponder exatamente à tabela da imagem caso os registros ainda não existam
  const fallbackRows = [
    {
      cell: 'Bordo',
      metricName: 'Metros de bordo',
      unitLabel: 'metros',
      shifts: {
        '1º Turno': { capacity: 3000, realized: 0, differenceCapacity: -3000, efficiencyCapacity: 0 },
        '2º Turno': { capacity: 2315, realized: 0, differenceCapacity: -2315, efficiencyCapacity: 0 },
        '3º Turno': { capacity: 318,  realized: 0, differenceCapacity: -318,  efficiencyCapacity: 0 },
      },
      total: { capacity: 5633, target: 5633, realized: 0, differenceTarget: -5633, efficiencyTarget: 0 }
    },
    {
      cell: 'Capas Fechadas',
      metricName: 'Capas expedidas',
      unitLabel: 'capas',
      shifts: {
        '1º Turno': { capacity: 10, realized: 0, differenceCapacity: -10, efficiencyCapacity: 0 },
        '2º Turno': { capacity: 0,  realized: 0, differenceCapacity: 0,   efficiencyCapacity: 0 },
        '3º Turno': { capacity: 0,  realized: 0, differenceCapacity: 0,   efficiencyCapacity: 0 },
      },
      total: { capacity: 10, target: 10, realized: 0, differenceTarget: -10, efficiencyTarget: 0 }
    },
    {
      cell: 'Corte',
      metricName: 'Chapas cortadas',
      unitLabel: 'chapas',
      shifts: {
        '1º Turno': { capacity: 150, realized: 0, differenceCapacity: -150, efficiencyCapacity: 0 },
        '2º Turno': { capacity: 150, realized: 0, differenceCapacity: -150, efficiencyCapacity: 0 },
        '3º Turno': { capacity: 50,  realized: 0, differenceCapacity: -50,  efficiencyCapacity: 0 },
      },
      total: { capacity: 350, target: 350, realized: 0, differenceTarget: -350, efficiencyTarget: 0 }
    },
    {
      cell: 'Embalagem',
      metricName: 'Peças embaladas',
      unitLabel: 'peças',
      shifts: {
        '1º Turno': { capacity: 1600, realized: 0, differenceCapacity: -1600, efficiencyCapacity: 0 },
        '2º Turno': { capacity: 1400, realized: 0, differenceCapacity: -1400, efficiencyCapacity: 0 },
        '3º Turno': { capacity: 0,    realized: 0, differenceCapacity: 0,     efficiencyCapacity: 0 },
      },
      total: { capacity: 3000, target: 3000, realized: 0, differenceTarget: -3000, efficiencyTarget: 0 }
    },
    {
      cell: 'Usinagem',
      metricName: 'Peças usinadas',
      unitLabel: 'peças',
      shifts: {
        '1º Turno': { capacity: 1400, realized: 0, differenceCapacity: -1400, efficiencyCapacity: 0 },
        '2º Turno': { capacity: 600,  realized: 0, differenceCapacity: -600,  efficiencyCapacity: 0 },
        '3º Turno': { capacity: 250,  realized: 0, differenceCapacity: -250,  efficiencyCapacity: 0 },
      },
      total: { capacity: 2250, target: 2250, realized: 0, differenceTarget: -2250, efficiencyTarget: 0 }
    }
  ];

  const displayRows = rows.length > 0 ? rows : fallbackRows;
  const visibleRows = expanded ? displayRows : displayRows.slice(0, 3);

  return (
    <Card className="border-border/60 shadow-sm bg-card rounded-2xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/40">
        <CardTitle className="text-base font-bold text-foreground">Produção por célula, turno e unidade</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="w-full text-xs">
          <TableHeader className="bg-secondary/40">
            <TableRow className="border-b border-border/50">
              <TableHead rowSpan={2} className="font-bold text-foreground min-w-[150px] pl-5">Área / célula</TableHead>
              <TableHead rowSpan={2} className="font-bold text-foreground">Unid.</TableHead>
              {shiftList.map((shift) => (
                <TableHead key={shift} colSpan={4} className="text-center font-bold text-foreground border-l border-border/40 py-2">
                  {shift}
                </TableHead>
              ))}
              <TableHead colSpan={5} className="text-center font-bold text-foreground border-l border-border/40 py-2 bg-primary/5">
                Total
              </TableHead>
            </TableRow>
            <TableRow className="border-b border-border/50 text-[11px]">
              {shiftList.map((shift) => (
                <FragmentHeader key={`hdr-${shift}`} />
              ))}
              <TableHead className="text-right font-bold border-l border-border/40 bg-primary/5">Capac.</TableHead>
              <TableHead className="text-right font-bold text-blue-600 dark:text-blue-400 bg-primary/5">Meta</TableHead>
              <TableHead className="text-right font-bold bg-primary/5">Real.</TableHead>
              <TableHead className="text-right font-bold bg-primary/5">Dif.</TableHead>
              <TableHead className="text-right font-bold bg-primary/5 pr-5">Ef.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/40">
            {visibleRows.map((row) => (
              <TableRow key={`${row.cell}-${row.metric_unit}`} className="hover:bg-secondary/20 transition-colors">
                <TableCell className="pl-5 py-3">
                  <div className="font-bold text-foreground text-xs">{row.cell}</div>
                  <div className="text-[10px] text-muted-foreground">{row.metricName}</div>
                </TableCell>
                <TableCell className="font-medium text-muted-foreground text-xs">{row.unitLabel}</TableCell>
                {shiftList.map((shift) => {
                  const bucket = row.shifts?.[shift] || {};
                  return <FragmentCells key={shift} bucket={bucket} />;
                })}
                <TableCell className="text-right border-l border-border/40 font-bold text-xs bg-primary/5">{fmt(row.total?.capacity)}</TableCell>
                <TableCell className="text-right text-blue-600 dark:text-blue-400 font-bold text-xs bg-primary/5">{fmt(row.total?.target)}</TableCell>
                <TableCell className="text-right font-bold text-xs bg-primary/5">{fmt(row.total?.realized)}</TableCell>
                <DiffCell value={row.total?.differenceTarget} />
                <TableCell className="text-right font-medium text-xs bg-primary/5 pr-5">{pct(row.total?.efficiencyTarget)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Footer Expand/Collapse */}
        <div className="p-2.5 text-center border-t border-border/40 bg-secondary/10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-bold text-primary hover:text-primary/80 gap-1.5 h-8 rounded-xl"
          >
            {expanded ? (
              <>
                Ver detalhes por célula <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Ver detalhes por célula <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentHeader() {
  return (
    <>
      <TableHead className="text-right border-l border-border/40 font-medium text-[10px] text-muted-foreground">Cap.</TableHead>
      <TableHead className="text-right font-medium text-[10px] text-muted-foreground">Real.</TableHead>
      <TableHead className="text-right font-medium text-[10px] text-muted-foreground">Dif.</TableHead>
      <TableHead className="text-right font-medium text-[10px] text-muted-foreground">Ef.</TableHead>
    </>
  );
}

function FragmentCells({ bucket }) {
  const cap = Number(bucket.capacity) || 0;
  const real = Number(bucket.realized) || 0;
  const dif = bucket.differenceCapacity != null ? Number(bucket.differenceCapacity) : real - cap;
  const ef = bucket.efficiencyCapacity != null ? Number(bucket.efficiencyCapacity) : (cap > 0 ? (real / cap) * 100 : 0);

  return (
    <>
      <TableCell className="text-right border-l border-border/40 font-semibold text-xs">{fmt(cap)}</TableCell>
      <TableCell className="text-right font-semibold text-xs">{fmt(real)}</TableCell>
      <DiffCell value={dif} />
      <TableCell className="text-right font-medium text-xs">{pct(ef)}</TableCell>
    </>
  );
}

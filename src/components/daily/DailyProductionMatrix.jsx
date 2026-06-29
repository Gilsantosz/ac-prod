import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const pct = (n) => `${fmt(n)}%`;

function DiffCell({ value }) {
  const n = Number(value) || 0;
  const tone = n >= 0 ? 'text-emerald-700' : 'text-red-700';
  return <TableCell className={`text-right font-semibold ${tone}`}>{fmt(n)}</TableCell>;
}

export default function DailyProductionMatrix({ rows = [], shifts = ['1º Turno', '2º Turno', '3º Turno'] }) {
  const shiftList = shifts.filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Produção por célula, turno e unidade</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="min-w-44">Área / célula</TableHead>
              <TableHead rowSpan={2}>Unid.</TableHead>
              {shiftList.map((shift) => (
                <TableHead key={shift} colSpan={4} className="text-center border-l">{shift}</TableHead>
              ))}
              <TableHead colSpan={5} className="text-center border-l">Total</TableHead>
            </TableRow>
            <TableRow>
              {shiftList.map((shift) => (
                <FragmentHeader key={shift} />
              ))}
              <TableHead className="text-right border-l">Capac.</TableHead>
              <TableHead className="text-right">Meta</TableHead>
              <TableHead className="text-right">Real.</TableHead>
              <TableHead className="text-right">Dif.</TableHead>
              <TableHead className="text-right">Ef.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2 + shiftList.length * 4 + 5} className="text-center text-muted-foreground py-8">
                  Sem metas ou apontamentos para o filtro selecionado.
                </TableCell>
              </TableRow>
            ) : rows.map((row) => (
              <TableRow key={`${row.cell}-${row.metric_unit}`}>
                <TableCell>
                  <div className="font-semibold text-foreground">{row.cell}</div>
                  <div className="text-xs text-muted-foreground">{row.metricName}</div>
                </TableCell>
                <TableCell className="font-medium text-muted-foreground">{row.unitLabel}</TableCell>
                {shiftList.map((shift) => {
                  const bucket = row.shifts?.[shift] || {};
                  return (
                    <FragmentCells key={shift} bucket={bucket} />
                  );
                })}
                <TableCell className="text-right border-l">{fmt(row.total?.capacity)}</TableCell>
                <TableCell className="text-right text-blue-700 font-semibold">{fmt(row.total?.target)}</TableCell>
                <TableCell className="text-right font-semibold">{fmt(row.total?.realized)}</TableCell>
                <DiffCell value={row.total?.differenceTarget} />
                <TableCell className="text-right">{pct(row.total?.efficiencyTarget)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function FragmentHeader() {
  return (
    <>
      <TableHead className="text-right border-l">Cap.</TableHead>
      <TableHead className="text-right">Real.</TableHead>
      <TableHead className="text-right">Dif.</TableHead>
      <TableHead className="text-right">Ef.</TableHead>
    </>
  );
}

function FragmentCells({ bucket }) {
  return (
    <>
      <TableCell className="text-right border-l">{fmt(bucket.capacity)}</TableCell>
      <TableCell className="text-right font-semibold">{fmt(bucket.realized)}</TableCell>
      <DiffCell value={bucket.differenceCapacity} />
      <TableCell className="text-right">{pct(bucket.efficiencyCapacity)}</TableCell>
    </>
  );
}

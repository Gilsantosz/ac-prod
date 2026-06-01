import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function SummaryTable({ title, rows, keyLabel, keyField }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{keyLabel}</TableHead>
              <TableHead className="text-right">Meta</TableHead>
              <TableHead className="text-right">Produzido</TableHead>
              <TableHead className="text-right">Boas</TableHead>
              <TableHead className="text-right">Refugo</TableHead>
              <TableHead className="text-right">% Refugo</TableHead>
              <TableHead className="text-right">Paradas (min)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sem dados</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r[keyField]}>
                  <TableCell className="font-medium">{r[keyField]}</TableCell>
                  <TableCell className="text-right text-blue-700">{fmt(r.target)}</TableCell>
                  <TableCell className="text-right">{fmt(r.produced)}</TableCell>
                  <TableCell className="text-right text-green-700">{fmt(r.good)}</TableCell>
                  <TableCell className="text-right text-red-700">{fmt(r.scrap)}</TableCell>
                  <TableCell className="text-right">{r.scrapRate}%</TableCell>
                  <TableCell className="text-right">{fmt(r.downtime)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
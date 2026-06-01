import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { worstFactor } from '@/lib/oeeMetrics';

const cellColor = (v) => (v >= 85 ? 'text-green-600' : v >= 60 ? 'text-amber-600' : 'text-red-600');

export default function OeeCellTable({ rows }) {
  return (
    <Card className="p-5 border-border/60">
      <h3 className="font-semibold mb-4">Detalhamento e Gargalos</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Célula</TableHead>
              <TableHead className="text-center">OEE</TableHead>
              <TableHead className="text-center">Disponib.</TableHead>
              <TableHead className="text-center">Perform.</TableHead>
              <TableHead className="text-center">Qualidade</TableHead>
              <TableHead>Maior Gargalo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const wf = worstFactor(r);
              return (
                <TableRow key={r.cell}>
                  <TableCell className="font-medium">{r.cell}</TableCell>
                  <TableCell className={`text-center font-bold ${cellColor(r.oee)}`}>{r.oee}%</TableCell>
                  <TableCell className={`text-center ${cellColor(r.availability)}`}>{r.availability}%</TableCell>
                  <TableCell className={`text-center ${cellColor(r.performance)}`}>{r.performance}%</TableCell>
                  <TableCell className={`text-center ${cellColor(r.quality)}`}>{r.quality}%</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-red-200 text-red-700">
                      {wf.label} · {wf.value}%
                    </Badge>
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
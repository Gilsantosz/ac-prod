import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function MonthlyGoalList({ goals = [], onDelete, dailyPreview }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Metas mensais cadastradas</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead>Célula</TableHead>
              <TableHead className="text-right">Meta Mensal</TableHead>
              <TableHead className="text-right">Meta Diária</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {goals.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhuma meta mensal</TableCell></TableRow>
            ) : (
              goals.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>{g.month}</TableCell>
                  <TableCell className="font-medium">{g.cell}</TableCell>
                  <TableCell className="text-right">{fmt(g.monthlyTarget)}</TableCell>
                  <TableCell className="text-right font-medium text-blue-700">{fmt(dailyPreview(g.monthlyTarget, g.month))}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(g.id)} className="text-red-600 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
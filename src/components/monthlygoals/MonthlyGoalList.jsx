import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Trash2, Pencil } from 'lucide-react';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

export default function MonthlyGoalList({ goals = [], onDelete, onEdit, dailyPreview }) {
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
              <TableHead className="w-20 text-right">Ações</TableHead>
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
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(g)}
                          className="text-muted-foreground hover:text-primary h-8 w-8 rounded-lg"
                          title="Editar Meta Mensal"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Deseja realmente excluir a meta mensal da célula "${g.cell}" (${g.month})?`)) {
                            onDelete(g.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-700 h-8 w-8 rounded-lg"
                        title="Excluir Meta Mensal"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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
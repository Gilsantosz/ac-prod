import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Pencil, Factory } from 'lucide-react';

export default function CellList({ cells, onEdit, onDelete }) {
  if (!cells.length) {
    return (
      <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
        Nenhuma célula cadastrada. Cadastre uma célula acima.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cells.map((c) => (
        <Card key={c.id} className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            <Factory className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{c.name}</p>
              {c.active === false && <Badge variant="outline">Inativa</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Horas/turno: 1º {c.hoursShift1 ?? 8}h · 2º {c.hoursShift2 ?? 8}h · 3º {c.hoursShift3 ?? 8}h
            </p>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => onEdit(c)}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(c.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}
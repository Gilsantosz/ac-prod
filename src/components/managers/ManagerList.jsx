import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Mail, Pencil, Trash2 } from 'lucide-react';

export default function ManagerList({ managers, onEdit, onDelete }) {
  if (!managers || managers.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground border-border/60">
        Nenhum gestor cadastrado ainda.
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {managers.map((m) => (
        <Card key={m.id} className="p-4 border-border/60">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold truncate">{m.name}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1 truncate">
                <Mail className="w-3.5 h-3.5 shrink-0" /> {m.email}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="icon" variant="ghost" onClick={() => onEdit(m)}><Pencil className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => onDelete(m)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(!m.cells || m.cells.length === 0)
              ? <Badge variant="secondary">Todas as células</Badge>
              : m.cells.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
            {m.active === false && <Badge variant="destructive">Inativo</Badge>}
          </div>
        </Card>
      ))}
    </div>
  );
}
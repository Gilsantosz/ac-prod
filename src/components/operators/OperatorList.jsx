import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, User, Building2, LogIn, LogOut } from 'lucide-react';

export default function OperatorList({ operators = [], onEdit, onDelete }) {
  if (operators.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground border-border/60">
        Nenhum operador cadastrado ainda.
      </Card>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {operators.map((op) => (
        <Card key={op.id} className="p-4 border-border/60 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{op.name}</p>
                {op.registration && (
                  <p className="text-xs text-muted-foreground font-mono">Matrícula {op.registration}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {op.active === false && <Badge variant="outline">Inativo</Badge>}
              {op.login_enabled !== false
                ? <Badge variant="outline" className="text-emerald-600 border-emerald-200 gap-1 text-[10px]"><LogIn className="w-2.5 h-2.5" />Login ativo</Badge>
                : <Badge variant="outline" className="text-muted-foreground gap-1 text-[10px]"><LogOut className="w-2.5 h-2.5" />Login desativado</Badge>
              }
            </div>
          </div>

          {/* Célula principal */}
          {op.primary_cell && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-medium text-foreground">{op.primary_cell}</span>
              <span className="text-muted-foreground">(principal)</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {op.shift && <Badge variant="secondary">{op.shift}</Badge>}
            {(op.cells || []).filter((c) => c !== op.primary_cell).map((c) => (
              <Badge key={c} variant="outline">{c}</Badge>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" className="gap-1.5 flex-1" onClick={() => onEdit(op)}>
              <Pencil className="w-3.5 h-3.5" /> Editar
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => onDelete(op.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
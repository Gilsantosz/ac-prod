import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Target } from 'lucide-react';
import { format } from 'date-fns';

export default function GoalList({ goals, onDelete }) {
  if (!goals.length) {
    return (
      <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
        Nenhuma meta definida. Crie uma meta acima para acompanhar o progresso no painel.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {goals.map((g) => (
        <Card key={g.id} className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-accent text-accent-foreground flex items-center justify-center shrink-0">
            <Target className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{g.cell}</p>
              <Badge variant="secondary">{g.shift}</Badge>
              <Badge variant="outline">{format(new Date(g.date + 'T00:00:00'), 'dd/MM/yyyy')}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Meta: {Number(g.target).toLocaleString('pt-BR')} peças
              {g.hours != null && ` · ${g.hours}h`}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(g.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}
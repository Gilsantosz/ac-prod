import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Clock } from 'lucide-react';

export default function RecentOccurrences({ occurrences, onDelete }) {
  const { user } = useAuth();
  const userRole = user?.role || 'operator';

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, role');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const profileRolesMap = useMemo(() => {
    const map = {};
    for (const p of profiles) {
      map[p.id] = p.role;
    }
    return map;
  }, [profiles]);
  return (
    <Card className="p-6 border-border/60">
      <h3 className="font-semibold mb-4">Ocorrências Recentes</h3>
      {occurrences.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada.</p>
      ) : (
        <div className="space-y-2">
          {occurrences.map((o) => {
            const creatorRole = o.created_by ? profileRolesMap[o.created_by] : null;
            const isCreatedByAdminOrManager = creatorRole === 'admin' || creatorRole === 'manager';
            const cannotDelete = userRole === 'operator' && isCreatedByAdminOrManager;

            return (
              <div key={o.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/60">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{o.reason}</Badge>
                    <span className="text-sm font-medium">{o.cell}</span>
                    <span className="text-xs text-muted-foreground">{o.date} · {o.shift}</span>
                  </div>
                  {o.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{o.notes}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" /> {o.downtime} min
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (cannotDelete) {
                        toast.warning('Acesso Restrito: Seu perfil operacional não permite excluir ocorrências cadastradas por gestores ou administradores.');
                      } else {
                        onDelete(o.id);
                      }
                    }}
                    title={cannotDelete ? 'Acesso Restrito' : 'Deletar ocorrência'}
                    className={cannotDelete ? 'text-slate-400 opacity-40 cursor-not-allowed hover:bg-transparent' : ''}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
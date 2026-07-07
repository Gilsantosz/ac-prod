import { useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { ACTIVE_ALERTS_QUERY_KEY, runOperationalAlertDiagnostics } from '@/lib/operationalAlertService';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bell, Check, AlertTriangle, BellRing } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Helper robusto para validar acesso a célula do usuário (operações e gestores)
function userHasCellAccess(user, cellName) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  let userCells = [];
  try {
    if (typeof user.cell === 'string') {
      if (user.cell.startsWith('[')) {
        userCells = JSON.parse(user.cell);
      } else {
        userCells = [user.cell];
      }
    } else if (Array.isArray(user.cell)) {
      userCells = user.cell;
    } else if (user.cells && Array.isArray(user.cells)) {
      userCells = user.cells;
    }
  } catch {
    userCells = [user.cell];
  }

  // Normalização e limpeza
  const cleanUserCells = userCells.filter(Boolean).map((c) => c.trim().toLowerCase());
  if (cleanUserCells.length === 0) return true; // sem célula associada vê todas

  const cleanCellName = cellName ? cellName.trim().toLowerCase() : '';
  return cleanUserCells.includes(cleanCellName);
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Executa diagnóstico silencioso em background ao carregar e a cada 60 segundos
  useEffect(() => {
    if (!user) return;
    
    // Executa diagnóstico inicial
    runOperationalAlertDiagnostics()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
        queryClient.invalidateQueries({ queryKey: ACTIVE_ALERTS_QUERY_KEY });
      })
      .catch((err) => {
        console.error('[NotificationCenter] Falha no diagnóstico de alertas inicial:', err);
      });

    // Agenda execuções a cada 60 segundos
    const interval = setInterval(() => {
      runOperationalAlertDiagnostics()
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
          queryClient.invalidateQueries({ queryKey: ACTIVE_ALERTS_QUERY_KEY });
        })
        .catch((err) => {
          console.error('[NotificationCenter] Falha no diagnóstico de alertas periódico:', err);
        });
    }, 60000);

    return () => clearInterval(interval);
  }, [user, queryClient]);

  // Busca apenas alertas não resolvidos (ordenados do mais recente ao mais antigo)
  const { data: alerts = [] } = useQuery({
    queryKey: ['unresolvedAlerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_logs')
        .select('*')
        .eq('resolved', false)
        .order('triggered_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Filtra as notificações baseando-se no acesso do usuário às células
  const visibleAlerts = useMemo(() => {
    if (!user) return [];
    return alerts.filter((a) => userHasCellAccess(user, a.cell));
  }, [alerts, user]);

  // Mutação para resolver a notificação no banco
  const resolveAlert = useMutation({
    mutationFn: async (alertId) => {
      const { data, error } = await supabase
        .from('alert_logs')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id,
        })
        .eq('id', alertId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
      queryClient.invalidateQueries({ queryKey: ACTIVE_ALERTS_QUERY_KEY });
      toast.success('Notificação marcada como resolvida.');
    },
    onError: (err) => {
      console.error('Falha ao resolver notificação:', err);
      toast.error('Erro ao resolver notificação.');
    },
  });

  const count = visibleAlerts.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative flex items-center justify-center w-10 h-10 shrink-0 rounded-xl border border-border/80 bg-card text-muted-foreground hover:text-foreground active:scale-95 transition-all focus:outline-none"
          title="Central de Notificações"
        >
          {count > 0 ? (
            <>
              <BellRing className="w-4.5 h-4.5 text-rose-500 animate-pulse" />
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-background tabular-nums">
                {count}
              </span>
            </>
          ) : (
            <Bell className="w-4.5 h-4.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 sm:w-96 p-0 rounded-2xl border-border/80 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20">
          <div>
            <h4 className="font-semibold text-sm">Notificações e Alertas</h4>
            <p className="text-[10px] text-muted-foreground">Alertas críticos das células de produção</p>
          </div>
          {count > 0 && (
            <Badge className="bg-rose-500 text-white hover:bg-rose-500 text-[10px] font-bold px-2 py-0.5">
              {count} pendente{count !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        {/* Content List */}
        <ScrollArea className="max-h-[350px] divide-y divide-border/40">
          {count === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Tudo certo por aqui!</p>
                <p className="text-xs text-muted-foreground mt-0.5">Nenhuma notificação crítica sem solução.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {visibleAlerts.map((a) => {
                const date = a.triggered_at || a.created_date;
                const timeLabel = date
                  ? formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
                  : '';
                return (
                  <div key={a.id} className="p-4 hover:bg-secondary/40 transition-colors flex gap-3 relative group">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="w-4.5 h-4.5 text-rose-500" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.cell && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-rose-200 bg-rose-50/20 text-rose-600 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-400">
                            {a.cell}
                          </Badge>
                        )}
                        {timeLabel && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {timeLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground leading-normal font-medium">
                        {a.message}
                      </p>
                      <div className="pt-1.5 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs gap-1 border-border/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-200 dark:hover:border-emerald-800 hover:text-emerald-600 rounded-lg shadow-sm"
                          onClick={() => resolveAlert.mutate(a.id)}
                          disabled={resolveAlert.isPending}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Resolvido</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

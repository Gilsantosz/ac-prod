import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Bell, BellRing, Check, AlertTriangle, ExternalLink, RefreshCw
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { resolveAlertManually, ACTIVE_ALERTS_QUERY_KEY } from '@/lib/operationalAlertService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';

function userHasCellAccess(user, cellName) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager' || user.role === 'supervisor') return true;

  let userCells = [];
  try {
    if (typeof user.cells === 'string') {
      userCells = JSON.parse(user.cells);
    } else if (user.cells && Array.isArray(user.cells)) {
      userCells = user.cells;
    }
  } catch {
    userCells = [user.cell];
  }

  const cleanUserCells = userCells.filter(Boolean).map((c) => c.trim().toLowerCase());
  if (cleanUserCells.length === 0) return true;

  const cleanCellName = cellName ? cellName.trim().toLowerCase() : '';
  return cleanUserCells.includes(cleanCellName);
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: alerts = [] } = useQuery({
    queryKey: ['unresolvedAlerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_logs')
        .select('id, cell, message, severity, triggered_at, created_at, resolved')
        .or('resolved.eq.false,resolved.is.null')
        .order('triggered_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 30000,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const visibleAlerts = useMemo(() => {
    if (!user) return [];
    return alerts.filter((a) => userHasCellAccess(user, a.cell));
  }, [alerts, user]);

  const resolveAlert = useMutation({
    mutationFn: async (alertId) => {
      const data = await resolveAlertManually(alertId, 'Resolvido via Central de Notificações');
      if (!data) {
        throw new Error('Nenhuma linha foi atualizada no banco.');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
      queryClient.invalidateQueries({ queryKey: ACTIVE_ALERTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['mes-hub-kpis'] });
      toast.success('Notificação marcada como resolvida.');
    },
    onError: (err) => {
      console.error('Falha ao resolver notificação:', err);
      toast.error(`Erro ao resolver notificação: ${err.message || 'Erro de banco'}`);
    },
  });

  const count = visibleAlerts.length;

  const handleNavigateToAlerts = () => {
    setOpen(false);
    navigate('/alertas-mes');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="end" className="w-80 sm:w-96 p-0 rounded-2xl border-border/80 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20 shrink-0">
          <div>
            <h4 className="font-semibold text-sm">Notificações e Alertas MES</h4>
            <p className="text-[10px] text-muted-foreground">
              {count > 0 ? `${count} alerta(s) crítico(s) detectado(s)` : 'Alertas críticos das células de produção'}
            </p>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 text-xs font-bold text-primary hover:text-primary/80 px-2 flex items-center gap-1"
            onClick={handleNavigateToAlerts}
          >
            <span>Ver página</span>
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>

        {/* Conteúdo com rolagem contínua e suave */}
        <div className="max-h-[60vh] sm:max-h-[460px] overflow-y-auto divide-y divide-border/40 pr-0.5 scrollbar-thin">
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
                const date = a.triggered_at || a.created_at;
                const timeLabel = date
                  ? formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
                  : '';
                return (
                  <div 
                    key={a.id} 
                    className="p-4 hover:bg-secondary/50 active:bg-secondary/70 transition-colors flex gap-3 relative group cursor-pointer"
                    onClick={(e) => {
                      if (!e.defaultPrevented) {
                        handleNavigateToAlerts();
                      }
                    }}
                    title="Clique para abrir na página de Alertas MES"
                  >
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
                      <p className="text-xs text-foreground leading-normal font-medium hover:text-primary transition-colors">
                        {a.message}
                      </p>
                      <div className="pt-1.5 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs gap-1 border-border/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-200 dark:hover:border-emerald-800 hover:text-emerald-600 rounded-lg shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            resolveAlert.mutate(a.id);
                          }}
                          disabled={resolveAlert.isPending}
                        >
                          {resolveAlert.isPending && resolveAlert.variables === a.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Resolvido</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border/60 bg-muted/15 text-center shrink-0">
          <Button 
            variant="default"
            size="sm"
            className="w-full h-8 text-xs font-bold gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            onClick={handleNavigateToAlerts}
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>Ver Página de Alertas MES</span>
            <ExternalLink className="w-3 h-3 ml-auto" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

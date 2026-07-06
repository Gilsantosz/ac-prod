import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  BellRing, RefreshCw, AlertTriangle, AlertCircle, CheckCircle, Info, Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  runOperationalAlertDiagnostics,
  getActiveAlerts,
  resolveAlertManually
} from '@/lib/operationalAlertService';

export default function OperationalAlertsPanel() {
  const qc = useQueryClient();
  const [runningDiag, setRunningDiag] = useState(false);

  // Buscar alertas ativos
  const { data: alerts = [], isLoading, refetch } = useQuery({
    queryKey: ['unresolved-alerts-list'],
    queryFn: getActiveAlerts,
    refetchInterval: 15000, // atualiza a cada 15 segundos
  });

  // Rodar diagnóstico
  const handleRunDiagnostics = async () => {
    setRunningDiag(true);
    try {
      const res = await runOperationalAlertDiagnostics();
      if (res.success) {
        toast.success(`Diagnóstico concluído! ${res.alertsTriggeredCount} alerta(s) ativo(s) detectado(s).`);
        refetch();
        qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
      } else {
        toast.error(`Falha no diagnóstico: ${res.error}`);
      }
    } catch (e) {
      toast.error(`Erro ao rodar diagnóstico: ${e.message}`);
    } finally {
      setRunningDiag(false);
    }
  };

  // Resolver Alerta
  const handleResolveAlert = async (alertId) => {
    try {
      await resolveAlertManually(alertId);
      toast.success('Alerta marcado como resolvido!');
      refetch();
      qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
    } catch (e) {
      toast.error(`Erro ao resolver alerta: ${e.message}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-foreground">Alertas de Rastreabilidade MES</h3>
          <p className="text-xs text-muted-foreground">
            Acompanhe peças paradas, sumidas, lotes atrasados e retrabalhos pendentes no chão de fábrica.
          </p>
        </div>
        <Button
          className="gap-2 bg-rose-600 hover:bg-rose-700 text-white text-xs h-9"
          onClick={handleRunDiagnostics}
          disabled={runningDiag}
        >
          {runningDiag ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <BellRing className="w-4 h-4" />
          )}
          Rodar Diagnóstico e Atualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" /> Carregando alertas do chão de fábrica…
        </div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border/40 rounded-2xl bg-card">
          <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-60" />
          <p className="font-semibold text-sm">Fábrica em Conformidade! Zero alertas ativos.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Nenhuma peça parada, atrasada ou com retrabalho detectada no diagnóstico.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Estatísticas Rápidas de Alertas */}
          <div className="md:col-span-1 space-y-4">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold">Resumo do Diagnóstico</CardTitle>
                <CardDescription className="text-xs">Gravidade e gargalos ativos</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="flex justify-between items-center py-1.5 border-b">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" /> Críticos (Atraso/Bloqueio)
                  </span>
                  <Badge variant="destructive" className="font-mono">
                    {alerts.filter(a => a.severity === 'critical').length}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Advertências (Retenção/Pendência)
                  </span>
                  <Badge variant="warning" className="font-mono bg-amber-500 text-white">
                    {alerts.filter(a => a.severity === 'warning').length}
                  </Badge>
                </div>
                <div className="pt-2 text-[10px] text-muted-foreground leading-relaxed">
                  Os alertas são recalculados e atualizados dinamicamente pelo MES a cada bipagem ou rodando o diagnóstico.
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Lista de Alertas Ativos */}
          <div className="md:col-span-2 space-y-3">
            {alerts.map(alert => (
              <div
                key={alert.id}
                className={cn(
                  'border rounded-2xl p-4 flex items-start gap-3 transition-all duration-150',
                  alert.severity === 'critical'
                    ? 'border-red-200 bg-red-50/10 dark:border-red-950/40 dark:bg-red-950/5'
                    : 'border-amber-200 bg-amber-50/10 dark:border-amber-950/40 dark:bg-amber-950/5'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  alert.severity === 'critical'
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                    : 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                )}>
                  {alert.severity === 'critical' ? (
                    <AlertCircle className="w-4.5 h-4.5" />
                  ) : (
                    <AlertTriangle className="w-4.5 h-4.5" />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1 text-xs">
                  <div className="flex justify-between items-start gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">Posto: {alert.cell}</span>
                      <Badge variant="outline" className="text-[9px] font-mono leading-none py-0.5">
                        {alert.signature.split(':')[0]}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(alert.triggered_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <p className="text-foreground leading-normal">{alert.message}</p>
                  
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">
                      ID: {alert.signature}
                    </span>
                    <div className="flex gap-1.5 shrink-0">
                      {alert.signature.includes(':') && (
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50/50"
                        >
                          <Link to={`/rastreabilidade?tab=search&q=${alert.signature.split(':')[1]}`}>
                            Abrir Origem
                          </Link>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50"
                        onClick={() => handleResolveAlert(alert.id)}
                      >
                        Resolver Alerta
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

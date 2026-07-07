import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  BellRing, RefreshCw, AlertTriangle, AlertCircle, CheckCircle,
  MapPin, Cpu, User, Box, Truck, Landmark, Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  ACTIVE_ALERTS_QUERY_KEY,
  runOperationalAlertDiagnostics,
  getActiveAlerts,
  resolveAlertManually
} from '@/lib/operationalAlertService';

function getAlertSignature(alert) {
  return String(alert?.signature || `alert:${alert?.id || 'sem-id'}`);
}

function getAlertType(alert) {
  const signature = getAlertSignature(alert);
  return signature.includes(':') ? signature.split(':')[0] : 'alerta';
}

function getAlertDate(alert) {
  const date = alert?.triggered_at || alert?.created_at || alert?.created_date || alert?.date;
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('pt-BR');
}

function getOriginQuery(alert) {
  const signature = getAlertSignature(alert);
  const parts = signature.split(':');
  if (parts.length > 1 && parts[0] !== 'alert') return parts[1];
  const metadata = alert?.metadata || {};
  return metadata.piece_id || metadata.lot_id || metadata.production_order_id || '';
}

export default function OperationalAlertsPanel() {
  const qc = useQueryClient();
  const [runningDiag, setRunningDiag] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [alertDetails, setAlertDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const handleOpenAlertDetails = async (alert) => {
    setSelectedAlert(alert);
    setLoadingDetails(true);
    setAlertDetails(null);
    try {
      const metadata = alert.metadata || {};
      const pieceId = metadata.piece_id;
      const lotId = metadata.lot_id;

      let pieceData = null;
      let lastReading = null;
      let lotData = null;

      if (pieceId) {
        const { data: piece } = await supabase
          .from('production_pieces')
          .select('*')
          .eq('id', pieceId)
          .maybeSingle();
        pieceData = piece;

        if (piece) {
          const { data: reading } = await supabase
            .from('production_stage_readings')
            .select('*')
            .or(`tag_value.eq.${piece.piece_uid},piece_code.eq.${piece.piece_uid}`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          lastReading = reading;

          if (!lastReading) {
            const { data: colEvent } = await supabase
              .from('production_collection_events')
              .select('*')
              .or(`raw_value.eq.${piece.piece_uid},piece_code.eq.${piece.piece_uid}`)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (colEvent) {
              lastReading = {
                cell_name: colEvent.cell_name,
                machine_name: colEvent.machine_name,
                operator: colEvent.operator_name,
                load_number: colEvent.load_number
              };
            }
          }
        }
      }

      if (lotId) {
        const { data: lot } = await supabase
          .from('production_lots')
          .select(`
            id,
            lot_code,
            status,
            current_stage,
            production_orders:production_orders!production_order_id (
              id,
              order_code,
              customer_name,
              load_number
            )
          `)
          .eq('id', lotId)
          .maybeSingle();
        lotData = lot;
      } else if (pieceData && pieceData.production_order_id) {
        const { data: lot } = await supabase
          .from('production_lots')
          .select(`
            id,
            lot_code,
            status,
            current_stage,
            production_orders:production_orders!production_order_id (
              id,
              order_code,
              customer_name,
              load_number
            )
          `)
          .eq('production_order_id', pieceData.production_order_id)
          .limit(1)
          .maybeSingle();
        lotData = lot;
      }

      setAlertDetails({
        piece: pieceData,
        lastReading,
        lot: lotData
      });
    } catch (e) {
      toast.error(`Erro ao carregar detalhes: ${e.message}`);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Buscar alertas ativos
  const { data: alerts = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ACTIVE_ALERTS_QUERY_KEY,
    queryFn: getActiveAlerts,
    refetchInterval: 15000, // atualiza a cada 15 segundos
  });

  // Rodar diagnóstico
  const handleRunDiagnostics = async () => {
    setRunningDiag(true);
    try {
      const res = await runOperationalAlertDiagnostics();
      if (res.success) {
        if (Array.isArray(res.activeAlerts)) {
          qc.setQueryData(ACTIVE_ALERTS_QUERY_KEY, res.activeAlerts);
        }
        const refreshed = await refetch();
        const activeCount = refreshed.data?.length ?? res.activeAlertsCount ?? res.alertsTriggeredCount;
        toast.success(`Diagnóstico concluído! ${activeCount} alerta(s) ativo(s) na página.`);
        qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
        qc.invalidateQueries({ queryKey: ACTIVE_ALERTS_QUERY_KEY });
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
      await refetch();
      qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
      qc.invalidateQueries({ queryKey: ACTIVE_ALERTS_QUERY_KEY });
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
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/30 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/10 dark:text-red-300">
          <p className="font-semibold">Não foi possível carregar os alertas ativos.</p>
          <p className="mt-1 text-xs opacity-90">{error?.message || 'Erro desconhecido ao consultar alert_logs.'}</p>
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
            {alerts.map(alert => {
              const signature = getAlertSignature(alert);
              const originQuery = getOriginQuery(alert);
              const isCritical = alert.severity === 'critical';

              return (
                <div
                  key={alert.id || signature}
                  className={cn(
                    'border rounded-2xl p-4 flex items-start gap-3 transition-all duration-150',
                    isCritical
                      ? 'border-red-200 bg-red-50/10 dark:border-red-950/40 dark:bg-red-950/5'
                      : 'border-amber-200 bg-amber-50/10 dark:border-amber-950/40 dark:bg-amber-950/5'
                  )}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    isCritical
                      ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                      : 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                  )}>
                    {isCritical ? (
                      <AlertCircle className="w-4.5 h-4.5" />
                    ) : (
                      <AlertTriangle className="w-4.5 h-4.5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1 text-xs">
                    <div className="flex justify-between items-start gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">Posto: {alert.cell || 'Fábrica'}</span>
                        <Badge variant="outline" className="text-[9px] font-mono leading-none py-0.5">
                          {getAlertType(alert)}
                        </Badge>
                      </div>
                      {getAlertDate(alert) && (
                        <span className="text-[10px] text-muted-foreground">
                          {getAlertDate(alert)}
                        </span>
                      )}
                    </div>
                    <p className="text-foreground leading-normal">
                      {alert.message || 'Alerta operacional sem mensagem detalhada.'}
                    </p>

                    <div className="flex items-center justify-between gap-3 pt-2">
                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">
                        ID: {signature}
                      </span>
                      <div className="flex gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50/50"
                          onClick={() => handleOpenAlertDetails(alert)}
                        >
                          Abrir
                        </Button>
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
              );
            })}
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Peça / Retenção MES */}
      <Dialog open={!!selectedAlert} onOpenChange={(open) => { if (!open) setSelectedAlert(null); }}>
        <DialogContent className="max-w-md bg-card border border-border/70 rounded-2xl shadow-2xl p-6">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2 text-foreground font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              Detalhes da Retenção MES
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Informações detalhadas sobre onde a peça está retida e sua origem.
            </DialogDescription>
          </DialogHeader>

          {loadingDetails ? (
            <div className="animate-pulse space-y-4 py-4">
              <div className="h-4 bg-muted rounded w-2/3"></div>
              <div className="h-16 bg-muted rounded w-full"></div>
              <div className="h-16 bg-muted rounded w-full"></div>
            </div>
          ) : alertDetails ? (
            <div className="space-y-4 py-2 text-foreground">
              {/* Seção 1: Dados da Peça */}
              {alertDetails.piece && (
                <div className="bg-slate-50 dark:bg-slate-900/40 border border-border/40 rounded-xl p-3.5 space-y-1">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Peça / Kit</h4>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-sm text-foreground">{alertDetails.piece.piece_name}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{alertDetails.piece.piece_uid}</p>
                    </div>
                    {alertDetails.piece.material && (
                      <Badge variant="outline" className="text-[10px] bg-card shrink-0">
                        {alertDetails.piece.material}
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Seção 2: Localização Física */}
              <div className="bg-slate-50 dark:bg-slate-900/40 border border-border/40 rounded-xl p-3.5 space-y-2.5">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Localização da Retenção</h4>
                <div className="grid grid-cols-1 gap-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <MapPin className="w-4 h-4 text-rose-500 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-none">Estação / Célula</p>
                      <p className="font-semibold text-foreground mt-0.5">
                        {alertDetails.lastReading?.cell_name || selectedAlert?.cell || 'Geral'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Cpu className="w-4 h-4 text-blue-500 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-none">Máquina / Posto</p>
                      <p className="font-semibold text-foreground mt-0.5">
                        {alertDetails.lastReading?.machine_name || 'N/A'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <User className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-none">Operador Responsável</p>
                      <p className="font-semibold text-foreground mt-0.5">
                        {alertDetails.lastReading?.operator || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Seção 3: Relações Lote / Carga / Cliente */}
              <div className="bg-slate-50 dark:bg-slate-900/40 border border-border/40 rounded-xl p-3.5 space-y-2.5">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Origem e Rastreabilidade</h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-none flex items-center gap-1">
                      <Box className="w-3.5 h-3.5 text-indigo-500 shrink-0" /> Lote
                    </p>
                    <p className="font-bold text-foreground mt-1 break-words">
                      {alertDetails.lot?.lot_code || selectedAlert?.metadata?.lot_code || 'Geral'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-none flex items-center gap-1">
                      <Truck className="w-3.5 h-3.5 text-sky-500 shrink-0" /> Carga
                    </p>
                    <p className="font-bold text-foreground mt-1 break-words">
                      {alertDetails.lot?.production_orders?.load_number || alertDetails.lastReading?.load_number || 'N/A'}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] text-muted-foreground leading-none flex items-center gap-1">
                      <Landmark className="w-3.5 h-3.5 text-teal-500 shrink-0" /> Cliente
                    </p>
                    <p className="font-bold text-foreground mt-1 break-words">
                      {alertDetails.lot?.production_orders?.customer_name || selectedAlert?.metadata?.customer_name || 'Geral'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-xs">
              Não foi possível carregar os detalhes do alerta.
            </div>
          )}

          <DialogFooter className="sm:justify-between gap-2 border-t pt-4">
            {alertDetails?.piece?.piece_uid && (
              <Button
                asChild
                variant="outline"
                className="gap-1.5 text-xs h-9"
              >
                <Link to={`/rastreabilidade?tab=search&q=${alertDetails.piece.piece_uid}`}>
                  <Search className="w-3.5 h-3.5 text-muted-foreground" /> Rastreabilidade Completa
                </Link>
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setSelectedAlert(null)}
              className="text-xs h-9"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

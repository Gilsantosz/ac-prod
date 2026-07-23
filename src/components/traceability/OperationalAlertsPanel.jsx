import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  BellRing, RefreshCw, AlertTriangle, AlertCircle, CheckCircle,
  MapPin, Cpu, User, Box, Truck, Landmark, Search, Clock, History, FileText
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
  runOperationalAlertDiagnostics,
  resolveAlertManually
} from '@/lib/operationalAlertService';

const STAGE_CODE_TO_NAME = {
  cut: 'Corte',
  edge: 'Borda',
  drill: 'Furação',
  cnc: 'Usinagem',
  joinery: 'Marcenaria',
  separation: 'Separação',
  packaging: 'Embalagem',
  shipping: 'Expedição'
};

function getStageDisplayName(stage) {
  if (!stage) return 'Geral';
  const clean = stage.trim().toLowerCase();
  if (STAGE_CODE_TO_NAME[clean]) return STAGE_CODE_TO_NAME[clean];
  const matched = Object.entries(STAGE_CODE_TO_NAME).find(([k, v]) => v.toLowerCase() === clean);
  if (matched) return matched[1];
  return stage;
}

function getAlertSignature(alert) {
  return String(alert?.signature || `alert:${alert?.id || 'sem-id'}`);
}

function getAlertType(alert) {
  const signature = getAlertSignature(alert);
  return signature.includes(':') ? signature.split(':')[0] : 'alerta';
}

function getAlertTypeLabel(type) {
  switch (type) {
    case 'stuck_pieces_group': return 'Peças Retidas';
    case 'late_lot': return 'Lote Atrasado';
    case 'blocked_lot': return 'Lote Bloqueado';
    case 'pending_rework': return 'Retrabalho Pendente';
    case 'incomplete_package': return 'Embalagem Incompleta';
    case 'collection_error': return 'Erro de Coleta';
    case 'stuck_collection': return 'Coleta Travada';
    case 'high_rejections': return 'Rejeição Anormal';
    case 'high_duplicates': return 'Leitura Duplicada';
    case 'special_piece': return 'Peça Especial';
    case 'pending_special_piece': return 'Peça Especial';
    default: return type;
  }
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
  
  // Estado para os filtros
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [filterCell, setFilterCell] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('unresolved'); // 'unresolved', 'resolved', 'all'

  // Estados para modal de observação de resolução
  const [resolvingAlert, setResolvingAlert] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolvingIds, setResolvingIds] = useState({});

  // Executa o diagnóstico automático ao abrir a página para garantir que os alertas sejam calculados
  useEffect(() => {
    let isMounted = true;
    setRunningDiag(true);
    runOperationalAlertDiagnostics()
      .then(() => {
        if (!isMounted) return;
        refetch();
        refetchHistory();
        qc.invalidateQueries({ queryKey: ['all-alerts-list'] });
        qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
        qc.invalidateQueries({ queryKey: ['mes-hub-kpis'] });
      })
      .catch((err) => {
        console.error('[OperationalAlertsPanel] Erro no diagnóstico automático:', err);
      })
      .finally(() => {
        if (isMounted) setRunningDiag(false);
      });

    return () => { isMounted = false; };
  }, []);

  // Buscar todos os alertas (para permitir filtragem dinâmica por situação)
  const { data: alerts = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['all-alerts-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_logs')
        .select('*')
        .order('triggered_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  // Buscar histórico de ações
  const { data: actionHistory = [], refetch: refetchHistory } = useQuery({
    queryKey: ['alert-action-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_action_history')
        .select(`
          id,
          alert_id,
          action,
          note,
          created_at,
          metadata,
          profiles:user_id ( name, email )
        `)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15000,
  });

  // Filtros dinâmicos calculados a partir dos dados retornados
  const cells = useMemo(() => {
    const set = new Set(alerts.map(a => a.cell).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [alerts]);

  const alertTypes = useMemo(() => {
    const set = new Set(alerts.map(a => getAlertType(a)).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [alerts]);

  // Aplicar os filtros aos alertas em memória
  const filteredAlerts = useMemo(() => {
    return alerts.filter(a => {
      const matchesSeverity = filterSeverity === 'all' || a.severity === filterSeverity;
      const matchesCell = filterCell === 'all' || a.cell === filterCell;
      const matchesType = filterType === 'all' || getAlertType(a) === filterType;
      
      let matchesStatus = true;
      if (filterStatus === 'unresolved') {
        matchesStatus = a.resolved === false || a.resolved === null;
      } else if (filterStatus === 'resolved') {
        matchesStatus = a.resolved === true;
      }

      return matchesSeverity && matchesCell && matchesType && matchesStatus;
    });
  }, [alerts, filterSeverity, filterCell, filterType, filterStatus]);

  const handleOpenAlertDetails = async (alert) => {
    setSelectedAlert(alert);
    setLoadingDetails(true);
    setAlertDetails(null);
    try {
      const metadata = alert.metadata || {};
      const pieceId = metadata.piece_id;
      const lotId = metadata.lot_id || metadata.client_lot_id;

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

  // Rodar diagnóstico
  const handleRunDiagnostics = async () => {
    setRunningDiag(true);
    try {
      const res = await runOperationalAlertDiagnostics();
      if (res.success) {
        toast.success(`Diagnóstico concluído! Banco reconciliado.`);
        await refetch();
        await refetchHistory();
        qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
        qc.invalidateQueries({ queryKey: ['mes-hub-kpis'] });
      } else {
        toast.error(`Falha no diagnóstico: ${res.error}`);
      }
    } catch (e) {
      toast.error(`Erro ao rodar diagnóstico: ${e.message}`);
    } finally {
      setRunningDiag(false);
    }
  };

  // Solicitar observação de resolução
  const askForResolutionNote = (alert) => {
    setResolvingAlert(alert);
    setResolutionNote('');
  };

  // Executar resolução
  const handleResolveAlert = async (alertId, note) => {
    setResolvingIds(prev => ({ ...prev, [alertId]: true }));
    
    // Atualização otimista local
    qc.setQueryData(['all-alerts-list'], (oldAlerts) => {
      if (!oldAlerts) return oldAlerts;
      return oldAlerts.map(a => a.id === alertId ? { ...a, resolved: true, resolved_at: new Date().toISOString() } : a);
    });

    try {
      const result = await resolveAlertManually(alertId, note);
      if (!result) {
        throw new Error('Nenhuma linha retornada pelo servidor.');
      }
      toast.success('Alerta marcado como resolvido!');
      await refetch();
      await refetchHistory();
      qc.invalidateQueries({ queryKey: ['unresolvedAlerts'] });
      qc.invalidateQueries({ queryKey: ['mes-hub-kpis'] });
    } catch (e) {
      toast.error(`Erro ao resolver alerta: ${e.message}`);
      // Reverter alteração otimista em caso de falha
      await refetch();
    } finally {
      setResolvingIds(prev => ({ ...prev, [alertId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-2">
        <div>
          <h3 className="text-lg font-bold text-foreground">Alertas de Rastreabilidade MES</h3>
          <p className="text-xs text-muted-foreground">
            Acompanhe peças paradas, sumidas, lotes atrasados e retrabalhos pendentes no chão de fábrica.
          </p>
        </div>
        <Button
          className="gap-2 bg-rose-600 hover:bg-rose-700 text-white text-xs h-9 shadow-sm"
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

      {/* Painel de Filtros */}
      <div className="bg-slate-50 dark:bg-slate-900/30 p-4 border border-border/50 rounded-2xl grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label htmlFor="filter-status" className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Situação
          </label>
          <select
            id="filter-status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full bg-background border border-border/80 rounded-xl px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-rose-500 focus:outline-none"
          >
            <option value="unresolved">Ativos (Pendentes)</option>
            <option value="resolved">Resolvidos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        <div>
          <label htmlFor="filter-severity" className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Gravidade
          </label>
          <select
            id="filter-severity"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="w-full bg-background border border-border/80 rounded-xl px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-rose-500 focus:outline-none"
          >
            <option value="all">Todas as Gravidades</option>
            <option value="critical">Crítico (Vermelho)</option>
            <option value="warning">Advertência (Laranja)</option>
          </select>
        </div>

        <div>
          <label htmlFor="filter-cell" className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Posto / Célula
          </label>
          <select
            id="filter-cell"
            value={filterCell}
            onChange={(e) => setFilterCell(e.target.value)}
            className="w-full bg-background border border-border/80 rounded-xl px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-rose-500 focus:outline-none capitalize"
          >
            <option value="all">Todos os Postos</option>
            {cells.filter(c => c !== 'all').map(c => (
              <option key={c} value={c}>{getStageDisplayName(c)}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-type" className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
            Tipo de Alerta
          </label>
          <select
            id="filter-type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full bg-background border border-border/80 rounded-xl px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-rose-500 focus:outline-none"
          >
            <option value="all">Todos os Tipos</option>
            {alertTypes.filter(t => t !== 'all').map(t => (
              <option key={t} value={t}>{getAlertTypeLabel(t)}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 p-8 justify-center text-sm text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin text-rose-500" /> Carregando alertas do chão de fábrica…
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/30 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/10 dark:text-red-300">
          <p className="font-semibold">Não foi possível carregar os alertas.</p>
          <p className="mt-1 text-xs opacity-90">{error?.message || 'Erro desconhecido ao consultar alert_logs.'}</p>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border/40 rounded-2xl bg-card">
          <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3 opacity-60" />
          <p className="font-semibold text-sm">Nenhum alerta localizado!</p>
          <p className="text-xs text-muted-foreground mt-1.5">
            Os filtros selecionados não retornaram ocorrências de fábrica ativas ou resolvidas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Estatísticas Rápidas de Alertas */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="border-border/60 shadow-sm bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-rose-500" /> Painel de Diagnóstico
                </CardTitle>
                <CardDescription className="text-[11px]">Resumo de anomalias no estado selecionado</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-500" /> Críticos (Atraso/Bloqueio)
                  </span>
                  <Badge variant="destructive" className="font-mono">
                    {filteredAlerts.filter(a => a.severity === 'critical').length}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Advertências (Retenção/Pendências)
                  </span>
                  <Badge variant="warning" className="font-mono bg-amber-500 text-white">
                    {filteredAlerts.filter(a => a.severity === 'warning').length}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-500" /> Resolvidos
                  </span>
                  <Badge variant="outline" className="font-mono border-emerald-500 text-emerald-500 bg-emerald-50/10">
                    {filteredAlerts.filter(a => a.resolved === true).length}
                  </Badge>
                </div>
                <div className="pt-2 text-[10px] text-muted-foreground leading-relaxed">
                  Alertas operacionais recalculados dinamicamente via backend integrado. A resolução manual de um alerta é preservada mesmo em novas execuções de diagnóstico.
                </div>
              </CardContent>
            </Card>

            {/* Histórico Recente de Ações */}
            <Card className="border-border/60 shadow-sm bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <History className="w-4 h-4 text-indigo-500" /> Histórico de Resoluções
                </CardTitle>
                <CardDescription className="text-[11px]">Últimas reaberturas e resoluções no banco</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {actionHistory.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    Sem histórico de ações registrado.
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 text-[11px]">
                    {actionHistory.map(hist => {
                      const date = new Date(hist.created_at).toLocaleString('pt-BR');
                      const userLabel = hist.profiles?.name || hist.profiles?.email || 'Sistema';
                      
                      let actionBadge = (
                        <Badge className="text-[9px] bg-slate-500/10 text-slate-600 hover:bg-slate-500/10 leading-none py-0.5" variant="outline">
                          {hist.action}
                        </Badge>
                      );
                      if (hist.action === 'resolve_manual') {
                        actionBadge = <Badge className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-200 leading-none py-0.5" variant="outline">Resolvido</Badge>;
                      } else if (hist.action === 'resolve_auto') {
                        actionBadge = <Badge className="text-[9px] bg-sky-500/10 text-sky-600 border-sky-200 leading-none py-0.5" variant="outline">Auto-Resolvido</Badge>;
                      } else if (hist.action === 'reopen') {
                        actionBadge = <Badge className="text-[9px] bg-rose-500/10 text-rose-600 border-rose-200 leading-none py-0.5" variant="outline">Reaberto</Badge>;
                      } else if (hist.action === 'create') {
                        actionBadge = <Badge className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-200 leading-none py-0.5" variant="outline">Novo</Badge>;
                      }

                      return (
                        <div key={hist.id} className="p-3 space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-foreground truncate max-w-[120px]">
                              {hist.metadata?.signature ? getAlertTypeLabel(hist.metadata.signature.split(':')[0]) : 'Alerta'}
                            </span>
                            {actionBadge}
                          </div>
                          {hist.note && (
                            <p className="text-muted-foreground leading-normal italic text-[10px]">
                              "{hist.note}"
                            </p>
                          )}
                          <div className="flex justify-between text-[9px] text-muted-foreground pt-0.5">
                            <span>Por: {userLabel}</span>
                            <span>{date}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Lista de Alertas */}
          <div className="lg:col-span-2 space-y-4">
            {filteredAlerts.map(alert => {
              const signature = getAlertSignature(alert);
              const isCritical = alert.severity === 'critical';
              const isResolved = alert.resolved === true;
              const isResolving = resolvingIds[alert.id] === true;

              return (
                <div
                  key={alert.id || signature}
                  className={cn(
                    'border rounded-2xl p-4 flex items-start gap-3.5 transition-all duration-150 relative bg-card shadow-sm',
                    isResolved
                      ? 'border-emerald-100 bg-emerald-50/5 opacity-80'
                      : isCritical
                        ? 'border-red-200/80 bg-red-50/5 dark:border-red-950/40'
                        : 'border-amber-200/80 bg-amber-50/5 dark:border-amber-950/40'
                  )}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm border',
                    isResolved
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/20'
                      : isCritical
                        ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-950/20'
                        : 'bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-950/20'
                  )}>
                    {isResolved ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : isCritical ? (
                      <AlertCircle className="w-5 h-5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1.5 text-xs">
                    <div className="flex justify-between items-start gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground text-sm">Posto: {getStageDisplayName(alert.cell)}</span>
                        <Badge variant="outline" className="text-[9px] font-mono leading-none py-0.5 uppercase">
                          {getAlertTypeLabel(getAlertType(alert))}
                        </Badge>
                        {alert.occurrence_count > 1 && (
                          <Badge variant="secondary" className="text-[9px] bg-rose-500/10 text-rose-500 font-bold leading-none py-0.5">
                            Ocorrência: {alert.occurrence_count}x
                          </Badge>
                        )}
                      </div>
                      {getAlertDate(alert) && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                          <Clock className="w-3 h-3" /> {getAlertDate(alert)}
                        </span>
                      )}
                    </div>

                    <p className="text-foreground leading-relaxed text-xs">
                      {alert.message || 'Alerta operacional sem mensagem detalhada.'}
                    </p>

                    {/* Detalhes de Lote Geral / Lote Cliente e Progresso */}
                    {alert.metadata && (
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-border/40 text-[11px]">
                        {alert.metadata.general_lot_code && (
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground block text-[9px] uppercase tracking-wider font-semibold">Lote Geral</span>
                            <span className="font-bold text-foreground flex items-center gap-1">
                              {alert.metadata.general_lot_code}
                              {alert.metadata.general_lot_progress !== undefined && (
                                <Badge className="bg-indigo-500/10 text-indigo-600 font-mono text-[9px] leading-none py-0.5" variant="outline">
                                  {alert.metadata.general_lot_progress}%
                                </Badge>
                              )}
                            </span>
                          </div>
                        )}
                        {alert.metadata.client_lot_code && (
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground block text-[9px] uppercase tracking-wider font-semibold">Lote Cliente</span>
                            <span className="font-bold text-foreground flex items-center gap-1">
                              {alert.metadata.client_lot_code}
                              {alert.metadata.client_lot_progress !== undefined && (
                                <Badge className="bg-emerald-500/10 text-emerald-600 font-mono text-[9px] leading-none py-0.5" variant="outline">
                                  {alert.metadata.client_lot_progress}%
                                </Badge>
                              )}
                            </span>
                          </div>
                        )}
                        {alert.metadata.customer_name && (
                          <div className="space-y-0.5 col-span-1">
                            <span className="text-muted-foreground block text-[9px] uppercase tracking-wider font-semibold">Cliente</span>
                            <span className="font-bold text-foreground truncate block max-w-[150px]">{alert.metadata.customer_name}</span>
                          </div>
                        )}
                        {alert.metadata.piece_count && (
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground block text-[9px] uppercase tracking-wider font-semibold">Qtd Peças</span>
                            <span className="font-bold text-rose-600 font-mono text-sm">{alert.metadata.piece_count}</span>
                          </div>
                        )}
                        {alert.metadata.last_operator && (
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground block text-[9px] uppercase tracking-wider font-semibold">Último Operador</span>
                            <span className="font-semibold text-foreground truncate block max-w-[120px]">{alert.metadata.last_operator}</span>
                          </div>
                        )}
                        {alert.metadata.last_machine && (
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground block text-[9px] uppercase tracking-wider font-semibold">Máquina</span>
                            <span className="font-semibold text-foreground truncate block max-w-[120px]">{alert.metadata.last_machine}</span>
                          </div>
                        )}
                        {alert.metadata.last_movement_at && (
                          <div className="space-y-0.5 col-span-2 sm:col-span-3 border-t border-border/30 pt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>Último Bipagem física detectada:</span>
                            <span className="font-semibold text-foreground">{new Date(alert.metadata.last_movement_at).toLocaleString('pt-BR')}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 pt-2.5">
                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                        Assinatura: {signature}
                      </span>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50/50 rounded-lg px-3"
                          onClick={() => handleOpenAlertDetails(alert)}
                        >
                          Abrir Detalhes
                        </Button>
                        {!isResolved && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-lg px-3 border border-emerald-100 hover:border-emerald-200"
                            onClick={() => askForResolutionNote(alert)}
                            disabled={isResolving}
                          >
                            {isResolving ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                            ) : null}
                            Resolver Alerta
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal para Observação da Resolução */}
      <Dialog open={!!resolvingAlert} onOpenChange={(open) => { if (!open) setResolvingAlert(null); }}>
        <DialogContent className="max-w-md bg-card border border-border/70 rounded-2xl shadow-2xl p-6">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2 text-foreground font-bold text-base">
              <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
              Resolver Alerta MES
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Insira uma observação justificando ou descrevendo a resolução deste alerta.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label htmlFor="resolution-note-input" className="block text-xs font-semibold text-muted-foreground mb-1">
              Observação de Resolução
            </label>
            <textarea
              id="resolution-note-input"
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="Ex: Peça encontrada e encaminhada manualmente para a bordadeira."
              className="w-full min-h-[80px] p-2.5 rounded-xl border border-border/80 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-rose-500 placeholder:text-muted-foreground/60 resize-none"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setResolvingAlert(null)}
              className="text-xs h-9"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const alertId = resolvingAlert.id;
                setResolvingAlert(null);
                handleResolveAlert(alertId, resolutionNote);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 font-semibold"
            >
              Confirmar Resolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                      {alertDetails.lot?.lot_code || selectedAlert?.metadata?.client_lot_code || selectedAlert?.metadata?.lot_code || 'Geral'}
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

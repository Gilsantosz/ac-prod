import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2, ShieldAlert, FileText, UserCheck, XOctagon, Loader2, Info
} from 'lucide-react';

export default function LotIntegrity() {
  const qc = useQueryClient();
  const [selectedLotId, setSelectedLotId] = useState('');
  const [activeTab, setActiveTab] = useState('integrity');

  // Liberação Especial Modal State
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [selectedPieceForRelease, setSelectedPieceForRelease] = useState(null);
  const [releaseForm, setReleaseForm] = useState({
    reason: 'Etapa executada manualmente offline',
    justification: '',
    impact: 'Nenhum impacto na montagem'
  });

  // Queries - Listar Lotes Ativos
  const { data: activeLots = [], isLoading: loadingLots } = useQuery({
    queryKey: ['activeLotsForIntegrity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_lots')
        .select('id, lot_code, status, progress_percent')
        .neq('status', 'cancelled')
        .neq('status', 'closed')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Query - Calcular Integridade do Lote Selecionado
  const { data: integrityData = null, isLoading: loadingIntegrity, refetch: refetchIntegrity } = useQuery({
    queryKey: ['lotIntegrityData', selectedLotId],
    queryFn: async () => {
      if (!selectedLotId) return null;
      const { data, error } = await supabase.rpc('calcular_integridade_do_lote', {
        p_lot_id: selectedLotId
      });
      if (error) throw error;
      return data;
    },
    enabled: !!selectedLotId
  });

  // Query - Listar Peças do Lote Selecionado com Problemas (Bloqueadas, Rework, Reposição)
  const { data: problematicPieces = [], isLoading: loadingPieces } = useQuery({
    queryKey: ['problematicPieces', selectedLotId],
    queryFn: async () => {
      if (!selectedLotId) return [];
      const { data, error } = await supabase
        .from('production_pieces')
        .select('*')
        .eq('lot_id', selectedLotId)
        .or('is_blocked.eq.true,status.eq.rejected,status.eq.rework_pending,status.eq.rework_in_progress,status.eq.replacement_in_production')
        .neq('status', 'cancelled')
        .neq('status', 'replaced');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedLotId
  });

  // Query - Peças Fora de Fluxo (Leituras com status de block)
  const { data: outOfFlowReadings = [], isLoading: loadingOutOfFlow, refetch: refetchOutOfFlow } = useQuery({
    queryKey: ['outOfFlowReadings', selectedLotId],
    queryFn: async () => {
      let query = supabase
        .from('production_events')
        .select(`
          id,
          traceability_code,
          event_type,
          from_stage,
          to_stage,
          cell_name,
          event_status,
          notes,
          created_at,
          piece_id,
          operators (name)
        `)
        .eq('event_type', 'block')
        .order('created_at', { ascending: false })
        .limit(50);

      if (selectedLotId) {
        query = query.eq('lot_id', selectedLotId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Query - Logs de Coletas/Auditoria Recentes do Lote
  const { data: integrityLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['integrityAuditLogs', selectedLotId],
    queryFn: async () => {
      let query = supabase
        .from('production_collection_events')
        .select('*')
        .order('processed_at', { ascending: false })
        .limit(100);

      if (selectedLotId) {
        query = query.eq('lot_id', selectedLotId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
  });

  // Mutation - Encerramento de Lote
  const closeLotMutation = useMutation({
    mutationFn: async (lotId) => {
      const { data, error } = await supabase
        .from('production_lots')
        .update({ status: 'closed', current_status: 'completed', updated_at: new Date() })
        .eq('id', lotId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Lote encerrado com sucesso!');
      setSelectedLotId('');
      qc.invalidateQueries({ queryKey: ['activeLotsForIntegrity'] });
    },
    onError: (err) => {
      toast.error(err.message || 'Falha ao encerrar o lote.');
    }
  });

  // Mutation - Liberação Especial
  const specialReleaseMutation = useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('authorize_special_release', {
        p_piece_id: payload.pieceId,
        p_stage: payload.stage,
        p_reason: payload.reason,
        p_justification: payload.justification,
        p_impact: payload.impact
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Liberação Especial autorizada com sucesso!');
      setReleaseModalOpen(false);
      qc.invalidateQueries({ queryKey: ['lotIntegrityData', selectedLotId] });
      qc.invalidateQueries({ queryKey: ['problematicPieces', selectedLotId] });
      qc.invalidateQueries({ queryKey: ['outOfFlowReadings', selectedLotId] });
      qc.invalidateQueries({ queryKey: ['integrityAuditLogs', selectedLotId] });
    },
    onError: (err) => {
      toast.error(err.message || 'Falha ao autorizar liberação especial.');
    }
  });

  const handleOpenReleaseModal = (piece, targetStage) => {
    setSelectedPieceForRelease({ piece, targetStage });
    setReleaseForm({
      reason: 'Etapa executada manualmente offline',
      justification: '',
      impact: 'Nenhum impacto na montagem'
    });
    setReleaseModalOpen(true);
  };

  const handleReleaseSubmit = (e) => {
    e.preventDefault();
    if (!selectedPieceForRelease) return;
    specialReleaseMutation.mutate({
      pieceId: selectedPieceForRelease.piece.piece_id || selectedPieceForRelease.piece.id,
      stage: selectedPieceForRelease.targetStage,
      reason: releaseForm.reason,
      justification: releaseForm.justification,
      impact: releaseForm.impact
    });
  };

  const handleRefreshAll = () => {
    refetchIntegrity();
    refetchOutOfFlow();
    qc.invalidateQueries({ queryKey: ['problematicPieces', selectedLotId] });
    qc.invalidateQueries({ queryKey: ['integrityAuditLogs', selectedLotId] });
    toast.success('Dados atualizados!');
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <PageHeader 
        title="Painel de Integridade de Lote" 
        subtitle="Controle de sequenciamento operacional, retrabalhos, reposições e autorização de encerramento." 
        icon={ShieldCheck} 
      />

      {/* Seletor de Lote */}
      <Card className="p-4 border-border/60 shadow-sm flex flex-col md:flex-row gap-4 items-end justify-between bg-card">
        <div className="space-y-1.5 flex-1 min-w-[280px]">
          <Label htmlFor="lot-select" className="text-xs font-bold text-muted-foreground uppercase">Selecione o Lote Produtivo</Label>
          <select
            id="lot-select"
            value={selectedLotId}
            onChange={(e) => setSelectedLotId(e.target.value)}
            className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium"
          >
            <option value="">-- Selecione um lote ativo --</option>
            {activeLots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.lot_code} ({lot.progress_percent || 0}% Concluído) - {lot.status}
              </option>
            ))}
          </select>
        </div>

        {selectedLotId && (
          <Button onClick={handleRefreshAll} variant="outline" size="sm" className="h-10 rounded-xl gap-2 font-medium shrink-0 border-border/60">
            <RefreshCw className="w-4 h-4" /> Recarregar Dados
          </Button>
        )}
      </Card>

      {!selectedLotId ? (
        <Card className="p-12 text-center text-muted-foreground border-dashed border-border/80 flex flex-col items-center justify-center space-y-3">
          <Info className="w-10 h-10 text-muted-foreground/30" />
          <div>
            <p className="font-bold text-foreground">Aguardando Lote</p>
            <p className="text-xs text-muted-foreground mt-1">Selecione um lote produtivo acima para abrir o centro de integridade do lote.</p>
          </div>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-secondary/40 p-1 rounded-xl h-11 border border-border/20">
            <TabsTrigger value="integrity" className="rounded-lg text-xs font-bold px-4 py-2">Integridade do Lote</TabsTrigger>
            <TabsTrigger value="out-of-flow" className="rounded-lg text-xs font-bold px-4 py-2">Peças Fora de Fluxo</TabsTrigger>
            <TabsTrigger value="logs" className="rounded-lg text-xs font-bold px-4 py-2">Auditoria de Logs</TabsTrigger>
          </TabsList>

          {/* ABA 1: INTEGRIDADE DO LOTE */}
          <TabsContent value="integrity" className="space-y-6 focus-visible:outline-none">
            {loadingIntegrity ? (
              <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : (
              integrityData && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Gauge de Integridade */}
                  <Card className="lg:col-span-1 p-6 flex flex-col items-center justify-center text-center space-y-6 bg-card border-border/60">
                    <h4 className="font-bold text-sm text-muted-foreground uppercase tracking-wider">Integridade do Lote</h4>
                    
                    <div className="relative w-40 h-40 flex items-center justify-center">
                      {/* Círculo de fundo */}
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="80" cy="80" r="70" className="stroke-secondary" strokeWidth="8" fill="transparent" />
                        <circle 
                          cx="80" 
                          cy="80" 
                          r="70" 
                          className={integrityData.integrity_percent === 100 ? "stroke-emerald-500" : "stroke-amber-500"} 
                          strokeWidth="8" 
                          fill="transparent" 
                          strokeDasharray={440} 
                          strokeDashoffset={440 - (440 * (integrityData.integrity_percent || 0)) / 100}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute text-center">
                        <p className="text-3xl font-extrabold text-foreground">{integrityData.integrity_percent}%</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">De Integridade</p>
                      </div>
                    </div>

                    <div className="w-full text-center space-y-2">
                      {integrityData.can_close ? (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-5 h-5 shrink-0" />
                          <span className="text-xs font-bold uppercase tracking-wider">Lote liberado para fechamento</span>
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-xl flex items-center justify-center gap-2">
                          <AlertTriangle className="w-5 h-5 shrink-0" />
                          <span className="text-xs font-bold uppercase tracking-wider">Lote não pode ser fechado</span>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">O fechamento exige 100% de peças aprovadas e nenhuma reposição/retrabalho aberto.</p>
                    </div>

                    {integrityData.can_close ? (
                      <Button 
                        onClick={() => {
                          if (confirm('Deseja realmente encerrar este lote de produção?')) {
                            closeLotMutation.mutate(selectedLotId);
                          }
                        }}
                        disabled={closeLotMutation.isPending}
                        className="w-full bg-emerald-500 hover:bg-emerald-600 font-bold rounded-xl"
                      >
                        {closeLotMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                        Encerrar Lote Produtivo
                      </Button>
                    ) : (
                      <Button disabled variant="outline" className="w-full rounded-xl opacity-60">
                        Aguardando Resoluções
                      </Button>
                    )}
                  </Card>

                  {/* Estatísticas e Gargalo */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Contadores */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div className="bg-card border border-border/60 rounded-2xl p-4">
                        <span className="text-[10px] text-muted-foreground font-bold uppercase block">Peças Totais</span>
                        <p className="text-3xl font-extrabold text-foreground mt-1">{integrityData.total_pieces}</p>
                      </div>
                      <div className="bg-card border border-border/60 rounded-2xl p-4">
                        <span className="text-[10px] text-emerald-600 font-bold uppercase block">Aprovadas</span>
                        <p className="text-3xl font-extrabold text-emerald-600 mt-1">{integrityData.approved_pieces}</p>
                      </div>
                      <div className="bg-card border border-border/60 rounded-2xl p-4">
                        <span className="text-[10px] text-amber-600 font-bold uppercase block">Pendentes de Etapa</span>
                        <p className="text-3xl font-extrabold text-amber-600 mt-1">{integrityData.pending_pieces}</p>
                      </div>
                      <div className="bg-card border border-border/60 rounded-2xl p-4">
                        <span className="text-[10px] text-rose-600 font-bold uppercase block">Bloqueadas</span>
                        <p className="text-3xl font-extrabold text-rose-600 mt-1">{integrityData.blocked_pieces}</p>
                      </div>
                      <div className="bg-card border border-border/60 rounded-2xl p-4">
                        <span className="text-[10px] text-purple-600 font-bold uppercase block">Em Retrabalho</span>
                        <p className="text-3xl font-extrabold text-purple-600 mt-1">{integrityData.rework_pieces}</p>
                      </div>
                      <div className="bg-card border border-border/60 rounded-2xl p-4">
                        <span className="text-[10px] text-sky-600 font-bold uppercase block">Em Reposição</span>
                        <p className="text-3xl font-extrabold text-sky-600 mt-1">{integrityData.replacement_pieces}</p>
                      </div>
                    </div>

                    {/* Gargalo */}
                    <Card className="p-4 border-border/60 bg-secondary/15 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-500/10 text-amber-600 rounded-xl flex items-center justify-center">
                          <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground font-semibold">Gargalo Crítico do Lote</p>
                          <p className="font-extrabold text-foreground text-sm mt-0.5">{integrityData.bottleneck || 'Nenhum'}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="border-amber-500/20 text-amber-600 bg-amber-500/5">
                        Alerta de Fluxo
                      </Badge>
                    </Card>

                    {/* Tabela de Peças Problemáticas */}
                    <Card className="p-5 border-border/60 space-y-4">
                      <h5 className="font-bold text-sm text-foreground flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-500" />
                        Peças Pendentes ou com Anomalias ({problematicPieces.length})
                      </h5>

                      {loadingPieces ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                      ) : problematicPieces.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-4 text-center">Nenhuma peça deste lote está bloqueada, em retrabalho ou reposição.</p>
                      ) : (
                        <div className="border border-border/40 rounded-xl overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Peça</TableHead>
                                <TableHead className="text-xs">Estação Atual</TableHead>
                                <TableHead className="text-xs">Status da Peça</TableHead>
                                <TableHead className="text-xs">Retrabalho/Reposição</TableHead>
                                <TableHead className="text-xs text-right">Ação</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {problematicPieces.map((p) => (
                                <TableRow key={p.id}>
                                  <TableCell className="font-mono text-xs font-bold">{p.traceability_code}</TableCell>
                                  <TableCell className="text-xs font-semibold capitalize">{p.current_stage}</TableCell>
                                  <TableCell className="text-xs">
                                    <Badge variant={p.is_blocked ? "destructive" : "secondary"} className="text-[10px] py-0">
                                      {p.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs font-medium">
                                    {p.rework_status !== 'none' && <Badge variant="outline" className="text-[10px] text-purple-600 bg-purple-500/5 border-purple-500/20">Retrabalho: {p.rework_status}</Badge>}
                                    {p.replacement_status !== 'none' && <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-500/5 border-amber-500/20">Reposição: {p.replacement_status}</Badge>}
                                    {p.rework_status === 'none' && p.replacement_status === 'none' && <span className="text-muted-foreground">-</span>}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      className="h-7 text-[10px] gap-1 border-border/60 hover:bg-secondary/40"
                                      onClick={() => handleOpenReleaseModal(p, p.current_stage)}
                                    >
                                      <UserCheck className="w-3.5 h-3.5" /> Liberação Especial
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </Card>
                  </div>
                  
                </div>
              )
            )}
          </TabsContent>

          {/* ABA 2: PEÇAS FORA DE FLUXO */}
          <TabsContent value="out-of-flow" className="space-y-6 focus-visible:outline-none">
            <Card className="p-6 border-border/60 space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <XOctagon className="w-5 h-5 text-rose-500" />
                  Histórico de Tentativas Irregulares de Bipe
                </h4>
                <Button onClick={() => refetchOutOfFlow()} variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

              {loadingOutOfFlow ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : outOfFlowReadings.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-8 text-center">Nenhum evento de quebra de fluxo registrado.</p>
              ) : (
                <div className="border border-border/40 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Código da Peça</TableHead>
                        <TableHead className="text-xs">Posto</TableHead>
                        <TableHead className="text-xs">De (Estação)</TableHead>
                        <TableHead className="text-xs">Para (Tentado)</TableHead>
                        <TableHead className="text-xs">Operador</TableHead>
                        <TableHead className="text-xs">Data/Hora</TableHead>
                        <TableHead className="text-xs">Motivo do Bloqueio</TableHead>
                        <TableHead className="text-xs text-right">Ação Corretiva</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outOfFlowReadings.map((evt) => (
                        <TableRow key={evt.id}>
                          <TableCell className="font-mono text-xs font-bold">{evt.traceability_code}</TableCell>
                          <TableCell className="text-xs font-semibold">{evt.cell_name}</TableCell>
                          <TableCell className="text-xs capitalize">{evt.from_stage}</TableCell>
                          <TableCell className="text-xs capitalize text-rose-500 font-bold">{evt.to_stage}</TableCell>
                          <TableCell className="text-xs">{evt.operators?.name || 'Operador'}</TableCell>
                          <TableCell className="text-xs">{new Date(evt.created_at).toLocaleString('pt-BR')}</TableCell>
                          <TableCell className="text-xs text-rose-600 font-medium max-w-xs truncate" title={evt.notes}>
                            {evt.notes}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-[10px] gap-1 border-border/60 hover:bg-secondary/40"
                              onClick={() => handleOpenReleaseModal({ id: evt.piece_id, traceability_code: evt.traceability_code }, evt.to_stage)}
                            >
                              <UserCheck className="w-3.5 h-3.5" /> Forçar Liberação
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ABA 3: LOGS DE AUDITORIA */}
          <TabsContent value="logs" className="space-y-6 focus-visible:outline-none">
            <Card className="p-6 border-border/60 space-y-4">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Logs Completos do Motor de Rastreabilidade e Integridade
              </h4>

              {loadingLogs ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : integrityLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-8 text-center">Nenhum evento de auditoria recente para este lote.</p>
              ) : (
                <div className="border border-border/40 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data/Hora</TableHead>
                        <TableHead className="text-xs">Peça</TableHead>
                        <TableHead className="text-xs">Estação / Célula</TableHead>
                        <TableHead className="text-xs">Operador</TableHead>
                        <TableHead className="text-xs">Ação</TableHead>
                        <TableHead className="text-xs">Resultado da Validação</TableHead>
                        <TableHead className="text-xs">Log de Detalhes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {integrityLogs.map((log) => {
                        const isError = log.result_status === 'blocked' || log.status === 'ignored';
                        const isWarning = log.result_status === 'duplicated';
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs">{new Date(log.processed_at || log.created_at).toLocaleString('pt-BR')}</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{log.piece_code || log.raw_value}</TableCell>
                            <TableCell className="text-xs font-semibold">{log.cell_name}</TableCell>
                            <TableCell className="text-xs">{log.operator_name || 'Operador'}</TableCell>
                            <TableCell className="text-xs capitalize">{log.reader_type}</TableCell>
                            <TableCell className="text-xs">
                              <Badge 
                                variant={isError ? "destructive" : isWarning ? "outline" : "secondary"} 
                                className={`text-[10px] py-0 ${isWarning ? 'border-amber-500/20 text-amber-600 bg-amber-500/5' : ''}`}
                              >
                                {log.result_status || log.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-sm truncate" title={log.error_message || 'OK'}>
                              {log.error_message || 'Sucesso'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* DIALOG DE AUTORIZAÇÃO DE LIBERAÇÃO ESPECIAL */}
      <Dialog open={releaseModalOpen} onOpenChange={setReleaseModalOpen}>
        <DialogContent className="max-w-md rounded-2xl bg-card border border-border/80">
          <form onSubmit={handleReleaseSubmit}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary animate-pulse" />
                Liberação Especial de Fluxo
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Aprovação manual supervisionada da peça <strong className="font-mono text-foreground">{selectedPieceForRelease?.piece?.traceability_code}</strong> na etapa <strong className="capitalize text-foreground">{selectedPieceForRelease?.targetStage}</strong>. Esta ação anula bloqueios e audita o responsável.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="release-reason" className="text-xs font-semibold">Motivo</Label>
                <select
                  id="release-reason"
                  value={releaseForm.reason}
                  onChange={(e) => setReleaseForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium"
                >
                  <option value="Etapa executada manualmente offline">Etapa executada manualmente offline</option>
                  <option value="Peça liberada por autorização gerencial">Peça liberada por autorização gerencial</option>
                  <option value="Ajuste técnico de roteiro">Ajuste técnico de roteiro</option>
                  <option value="Necessidade de urgência operacional">Necessidade de urgência operacional</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="release-justification" className="text-xs font-semibold">Justificativa Detalhada</Label>
                <textarea
                  id="release-justification"
                  value={releaseForm.justification}
                  onChange={(e) => setReleaseForm(f => ({ ...f, justification: e.target.value }))}
                  required
                  placeholder="Informe detalhadamente por que esta peça está sendo autorizada a pular esta estação obrigatória..."
                  className="w-full min-h-20 rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="release-impact" className="text-xs font-semibold">Impacto / Risco</Label>
                <Input
                  id="release-impact"
                  value={releaseForm.impact}
                  onChange={(e) => setReleaseForm(f => ({ ...f, impact: e.target.value }))}
                  placeholder="Ex: Nenhum risco para montagem"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReleaseModalOpen(false)} className="rounded-xl h-9 border-border/60 font-medium">
                Cancelar
              </Button>
              <Button type="submit" disabled={specialReleaseMutation.isPending} size="sm" className="rounded-xl h-9 bg-primary text-white font-bold">
                {specialReleaseMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Autorizar Liberação
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

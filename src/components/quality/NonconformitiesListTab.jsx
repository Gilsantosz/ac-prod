import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Filter, CheckCircle2, Plus, ChevronDown, ChevronUp, FileText,
  AlertTriangle, Loader2, RefreshCw, Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  getNonconformities,
  closeNonconformity,
  saveQualityAction,
  NC_DISPOSITION_LABELS,
  NC_STATUS_LABELS
} from '@/lib/qualityService';
import { toast } from 'sonner';

export default function NonconformitiesListTab({ userPermissions = {} }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [dispositionFilter, setDispositionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedNcId, setExpandedNcId] = useState(null);
  const deferredSearch = useDeferredValue(search.trim());

  // Modal 5W2H
  const [actionModal, setActionModal] = useState(null);
  const [actionForm, setActionForm] = useState({
    what: '',
    why: '',
    who_owner_name: '',
    when_deadline: '',
    how: '',
    action_type: 'corrective'
  });

  const {
    data: ncResult,
    error: ncError,
    isError,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['quality-nonconformities', statusFilter, dispositionFilter, deferredSearch],
    queryFn: () => getNonconformities({
        status: statusFilter !== 'all' ? statusFilter : null,
        disposition: dispositionFilter !== 'all' ? dispositionFilter : null,
        search: deferredSearch || null
      }),
    staleTime: 10_000,
    retry: 1,
    refetchInterval: 20_000,
    placeholderData: (previousData) => previousData,
  });

  const ncs = ncResult?.nonconformities || [];
  const totalNcs = ncResult?.count || 0;

  const refreshQualityData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['quality-nonconformities'] }),
      queryClient.invalidateQueries({ queryKey: ['quality-metrics'] }),
    ]);
  };

  const handleCloseNc = async (nc) => {
    const notes = prompt(`Motivo ou observações do encerramento da NC ${nc.nc_code}:`);
    if (notes === null) return;

    try {
      await closeNonconformity(nc.id, { notes });
      toast.success(`Não Conformidade ${nc.nc_code} encerrada com sucesso!`);
      await refreshQualityData();
    } catch (error) {
      console.error('Erro ao encerrar NC:', error);
      toast.error(error.message || 'Falha ao encerrar NC.');
    }
  };

  const handleSaveAction = async (e) => {
    e.preventDefault();
    if (!actionForm.what) {
      toast.error('O campo "O que será feito (What)" é obrigatório.');
      return;
    }

    try {
      await saveQualityAction({
        nonconformity_id: actionModal.id,
        action_type: actionForm.action_type,
        what: actionForm.what,
        why: actionForm.why,
        who_owner_name: actionForm.who_owner_name,
        when_deadline: actionForm.when_deadline ? new Date(actionForm.when_deadline).toISOString() : null,
        how: actionForm.how
      });
      toast.success('Plano de Ação 5W2H adicionado com sucesso!');
      setActionModal(null);
      await refreshQualityData();
    } catch (error) {
      console.error('Erro ao salvar plano de ação:', error);
      toast.error(error.message || 'Falha ao salvar plano de ação.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Filtros e Busca */}
      <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Buscar por código NC, defeito, lote, pedido..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-xs rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-xl border border-input bg-background px-3 font-medium focus-visible:outline-none"
            >
              <option value="all">Todos os Status</option>
              <option value="open">Abertas</option>
              <option value="contained">Contidas</option>
              <option value="analysis">Em Análise</option>
              <option value="closed">Encerradas</option>
            </select>

            <select
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
              className="h-9 rounded-xl border border-input bg-background px-3 font-medium focus-visible:outline-none"
            >
              <option value="all">Todas as Disposições</option>
              <option value="scrap">Refugo</option>
              <option value="rework">Retrabalho</option>
              <option value="replacement">Reposição</option>
              <option value="use_as_is">Uso Como Está</option>
              <option value="hold">Quarentena</option>
            </select>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-9 rounded-xl gap-1.5 text-xs font-bold"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
          <span>{totalNcs.toLocaleString('pt-BR')} não conformidade(s) encontrada(s)</span>
          <span>Atualização automática a cada 20 segundos</span>
        </div>
      </div>

      {/* Lista de Não Conformidades */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Carregando Não Conformidades...
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <p className="text-sm font-extrabold text-foreground">Não foi possível carregar as Não Conformidades</p>
                <p className="mt-1 text-xs text-muted-foreground">{ncError?.message || 'Falha ao consultar os dados de Qualidade.'}</p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()} className="rounded-xl gap-2">
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        </div>
      ) : ncs.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-2xl p-12 text-center text-xs text-muted-foreground">
          Nenhuma Não Conformidade encontrada para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-3">
          {ncs.map((nc) => {
            const statusConfig = NC_STATUS_LABELS[nc.status] || { label: nc.status, color: 'bg-slate-500/10 text-slate-600' };
            const dispConfig = NC_DISPOSITION_LABELS[nc.disposition] || { label: nc.disposition, color: 'bg-slate-500/10 text-slate-600' };
            const isExpanded = expandedNcId === nc.id;

            return (
              <div key={nc.id} className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-sm hover:shadow-md transition-all">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-sm text-foreground">{nc.nc_code}</span>
                    <Badge variant="outline" className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusConfig.color}`}>
                      {statusConfig.label}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${dispConfig.color}`}>
                      Disposição: {dispConfig.label}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Detectado em: {new Date(nc.detected_at || nc.created_at).toLocaleString('pt-BR')}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedNcId(isExpanded ? null : nc.id)}
                      className="h-8 w-8 p-0 text-muted-foreground rounded-lg"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-secondary/30 p-2.5 rounded-xl space-y-0.5">
                    <p className="text-muted-foreground font-semibold">Defeito:</p>
                    <p className="font-bold text-foreground">{nc.defect_name}</p>
                    <p className="text-[11px] text-muted-foreground">Severidade: <strong className="capitalize text-foreground">{nc.severity}</strong></p>
                  </div>

                  <div className="bg-secondary/30 p-2.5 rounded-xl space-y-0.5">
                    <p className="text-muted-foreground font-semibold">Lote & Pedido:</p>
                    <p className="font-mono font-bold text-foreground">{nc.lot_code || 'LOTE N/A'}</p>
                    <p className="text-[11px] text-muted-foreground">{nc.order_number ? `Pedido: ${nc.order_number}` : ''} {nc.customer_name ? `• ${nc.customer_name}` : ''}</p>
                  </div>

                  <div className="bg-secondary/30 p-2.5 rounded-xl space-y-0.5">
                    <p className="text-muted-foreground font-semibold">Posto / Operador:</p>
                    <p className="font-bold text-foreground">{nc.cell_name || 'Célula N/A'}</p>
                    <p className="text-[11px] text-muted-foreground">Operador: {nc.operator_name || 'N/A'}</p>
                  </div>
                </div>

                {/* Planos de Ação 5W2H Existentes */}
                {isExpanded && nc.actions && nc.actions.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2 text-xs">
                    <p className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      Planos de Ação 5W2H Registrados ({nc.actions.length}):
                    </p>
                    <div className="space-y-1.5">
                      {nc.actions.map(act => (
                        <div key={act.id} className="bg-background/80 p-2 rounded-lg border border-border/40 text-[11px] space-y-0.5">
                          <p className="font-bold text-foreground">[{act.action_type.toUpperCase()}] What: {act.what}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expansão e Ações */}
                {isExpanded && <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border/40 text-xs">
                  <p className="text-muted-foreground text-[11px]">
                    {nc.notes ? `Obs: ${nc.notes}` : ''}
                  </p>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-bold rounded-xl flex items-center gap-1.5 border-border/60"
                    >
                      <Link to={`/coleta?code=${encodeURIComponent(nc.piece_uid || nc.piece_code || nc.piece_id || nc.nc_code)}`}>
                        <Layers className="w-3.5 h-3.5 text-[#2d9c4a]" />
                        Rastreabilidade
                      </Link>
                    </Button>

                    {userPermissions.manage_quality && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActionModal(nc);
                          setActionForm({ what: '', why: '', who_owner_name: '', when_deadline: '', how: '', action_type: 'corrective' });
                        }}
                        className="h-8 text-xs font-bold rounded-xl flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Nova Ação 5W2H
                      </Button>
                    )}

                    {nc.status !== 'closed' && (userPermissions.close_quality_nonconformities || userPermissions.manage_quality) && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleCloseNc(nc)}
                        className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Encerrar NC
                      </Button>
                    )}
                  </div>
                </div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal 5W2H */}
      {actionModal && (
        <Dialog open={!!actionModal} onOpenChange={(open) => !open && setActionModal(null)}>
          <DialogContent className="sm:max-w-[500px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-extrabold flex items-center gap-2 text-amber-600">
                <FileText className="w-5 h-5" />
                Criar Plano de Ação 5W2H
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Vincule um plano de ação para a Não Conformidade {actionModal.nc_code}.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveAction} className="space-y-3 py-2 text-xs">
              <div className="space-y-1">
                <Label className="font-bold text-muted-foreground">Tipo de Ação</Label>
                <select
                  value={actionForm.action_type}
                  onChange={(e) => setActionForm({ ...actionForm, action_type: e.target.value })}
                  className="w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-medium focus-visible:outline-none"
                >
                  <option value="containment">Contenção Imediata</option>
                  <option value="corrective">Ação Corretiva (Causa Raiz)</option>
                  <option value="preventive">Ação Preventiva</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="font-bold text-muted-foreground">O que será feito (What) *</Label>
                <Input
                  value={actionForm.what}
                  onChange={(e) => setActionForm({ ...actionForm, what: e.target.value })}
                  placeholder="Ex: Ajustar gabarito de furação da máquina CNC-02"
                  className="h-9 text-xs rounded-xl"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="font-bold text-muted-foreground">Por que será feito (Why)</Label>
                <Input
                  value={actionForm.why}
                  onChange={(e) => setActionForm({ ...actionForm, why: e.target.value })}
                  placeholder="Ex: Eliminar folga que causa deslocamento do furo"
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="font-bold text-muted-foreground">Quem fará (Who)</Label>
                  <Input
                    value={actionForm.who_owner_name}
                    onChange={(e) => setActionForm({ ...actionForm, who_owner_name: e.target.value })}
                    placeholder="Nome do responsável"
                    className="h-9 text-xs rounded-xl"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="font-bold text-muted-foreground">Prazo (When)</Label>
                  <Input
                    type="date"
                    value={actionForm.when_deadline}
                    onChange={(e) => setActionForm({ ...actionForm, when_deadline: e.target.value })}
                    className="h-9 text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="font-bold text-muted-foreground">Como será feito (How)</Label>
                <Textarea
                  value={actionForm.how}
                  onChange={(e) => setActionForm({ ...actionForm, how: e.target.value })}
                  placeholder="Passo a passo da implementação..."
                  rows={2}
                  className="text-xs rounded-xl resize-none"
                />
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActionModal(null)}
                  className="text-xs font-semibold rounded-xl"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
                >
                  Salvar Plano de Ação
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

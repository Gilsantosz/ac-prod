import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateAllMesQueries } from '@/config/queryKeys';
import {
  RotateCcw, Filter, Search, CheckCircle2, RefreshCw, Printer, FileText, Download,
  History, Settings, CheckSquare, Square
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  getReplacementKpis,
  releaseReplacement,
  completeReplacement,
  cancelReplacement
} from '@/lib/replacementService';
import { getCanonicalReplacementOrders } from '@/lib/replacementCanonicalService';
import { generateReplacementPdfReport } from '@/lib/reports/replacementPdfReportService';
import { useAuth } from '@/lib/AuthContext';
import ReplacementOrderCard from '@/components/replacement/ReplacementOrderCard';
import ReplacementApproveModal from '@/components/replacement/ReplacementApproveModal';
import ReplacementLabelPreviewModal from '@/components/replacement/ReplacementLabelPreviewModal';
import ReplacementBatchPrintModal from '@/components/replacement/ReplacementBatchPrintModal';
import ReplacementHistoryModal from '@/components/replacement/ReplacementHistoryModal';
import LabelTemplateConfigModal from '@/components/replacement/LabelTemplateConfigModal';
import { toast } from 'sonner';

export default function ReplacementPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');
  
  // Modais
  const [approveOrderId, setApproveOrderId] = useState(null);
  const [labelModalOrder, setLabelModalOrder] = useState(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Seleção Múltipla
  const [selectedIds, setSelectedIds] = useState([]);

  // Permissões
  const userPermissions = {
    approve_replacements: user?.role === 'admin' || user?.role === 'manager' || user?.permissions?.approve_replacements,
    manage_replacements: user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor' || user?.permissions?.manage_replacements,
    admin: user?.role === 'admin'
  };

  // Carregar KPIs
  const { data: kpis = {}, refetch: refetchKpis } = useQuery({
    queryKey: ['replacement-kpis'],
    queryFn: () => getReplacementKpis(),
    refetchInterval: 15000
  });

  // Carregar Ordens com Filtros
  const { data: ordersData = { orders: [], count: 0 }, isLoading, refetch: refetchOrders } = useQuery({
    queryKey: ['replacement-orders', activeTab, statusFilter, priorityFilter, search],
    queryFn: () => getCanonicalReplacementOrders({
      status: statusFilter !== 'all' ? statusFilter : null,
      priority: priorityFilter !== 'all' ? priorityFilter : null,
      search: search.trim() || null,
      limit: 100
    }),
    refetchInterval: 10000
  });

  const filteredOrders = (ordersData.orders || []).filter(order => {
    if (statusFilter !== 'all') return true;
    if (activeTab === 'active') {
      return ['requested', 'under_review', 'approved', 'released', 'in_production'].includes(order.status);
    } else {
      return ['completed', 'cancelled'].includes(order.status);
    }
  });

  // Ordens selecionadas
  const selectedOrdersList = filteredOrders.filter(o => selectedIds.includes(o.id));
  const approvedSelectedCount = selectedOrdersList.filter(o => ['approved', 'released', 'in_production', 'completed'].includes(o.status)).length;
  const pendingSelectedCount = selectedOrdersList.length - approvedSelectedCount;

  const handleRefresh = () => {
    invalidateAllMesQueries(queryClient);
    refetchKpis();
    refetchOrders();
    toast.info('Dados de reposição atualizados.');
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === filteredOrders.length && filteredOrders.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredOrders.map(o => o.id));
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleRelease = async (order) => {
    try {
      await releaseReplacement(order.id);
      toast.success('Ordem de reposição liberada para fabricação.');
      handleRefresh();
    } catch (error) {
      console.error('Erro ao liberar reposição:', error);
      toast.error(error.message || 'Falha ao liberar reposição.');
    }
  };

  const handleComplete = async (order) => {
    try {
      await completeReplacement(order.id);
      toast.success('Ordem de reposição concluída! Peça original atualizada para replaced.');
      handleRefresh();
    } catch (error) {
      console.error('Erro ao concluir reposição:', error);
      toast.error(error.message || 'Falha ao concluir reposição.');
    }
  };

  const handleCancel = async (order) => {
    try {
      await cancelReplacement(order.id, { reason: 'Cancelado via painel de reposição' });
      toast.success('Ordem de reposição cancelada.');
      handleRefresh();
    } catch (error) {
      console.error('Erro ao cancelar reposição:', error);
      toast.error(error.message || 'Falha ao cancelar reposição.');
    }
  };

  // Exportação em PDF por Filtro
  const handleExportFilteredPdf = async () => {
    try {
      await generateReplacementPdfReport({
        orders: filteredOrders,
        filters: { status: statusFilter, priority: priorityFilter, search },
        reportType: 'filtered',
        userName: user?.name || 'Operador MES'
      });
      toast.success('Relatório PDF das reposições filtradas gerado com sucesso.');
    } catch (err) {
      console.error('Erro ao gerar relatório PDF filtrado:', err);
      toast.error('Falha ao exportar relatório PDF.');
    }
  };

  // Exportação em PDF dos Selecionados
  const handleExportSelectedPdf = async () => {
    if (selectedOrdersList.length === 0) {
      toast.error('Selecione ao menos uma ordem de reposição para exportar.');
      return;
    }
    try {
      await generateReplacementPdfReport({
        orders: selectedOrdersList,
        reportType: 'selected',
        userName: user?.name || 'Operador MES'
      });
      toast.success('Relatório PDF das reposições selecionadas gerado com sucesso.');
    } catch (err) {
      console.error('Erro ao gerar relatório PDF selecionados:', err);
      toast.error('Falha ao exportar relatório PDF.');
    }
  };

  // Exportação de PDF Individual
  const handleOpenSinglePdfReport = async (order) => {
    try {
      await generateReplacementPdfReport({
        singleOrder: order,
        reportType: 'individual',
        userName: user?.name || 'Operador MES'
      });
      toast.success(`Relatório PDF da reposição ${order.replacement_code} gerado.`);
    } catch (err) {
      console.error('Erro ao gerar relatório individual:', err);
      toast.error('Falha ao gerar relatório PDF.');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-foreground flex items-center gap-2 tracking-tight">
            <RotateCcw className="w-6 h-6 text-amber-500" />
            Módulo de Reposição MES
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Gestão transacional de peças reprovadas, ordens de reposição, emissão de etiquetas e relatórios PDF.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Novo Botão Principal Imprimir / Exportar */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-md"
              >
                <Printer className="w-4 h-4" />
                Imprimir / Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-2xl p-1.5 border-border shadow-xl text-xs">
              <DropdownMenuItem onClick={handleExportFilteredPdf} className="cursor-pointer rounded-xl flex items-center gap-2 py-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span>Relatório PDF das reposições filtradas</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={selectedOrdersList.length === 0}
                onClick={handleExportSelectedPdf}
                className="cursor-pointer rounded-xl flex items-center gap-2 py-2"
              >
                <FileText className="w-4 h-4 text-emerald-500" />
                <span>Relatório PDF das reposições selecionadas</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (filteredOrders.length > 0) handleOpenSinglePdfReport(filteredOrders[0]);
                }}
                className="cursor-pointer rounded-xl flex items-center gap-2 py-2"
              >
                <Download className="w-4 h-4 text-indigo-500" />
                <span>Relatório individual</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={selectedOrdersList.length === 0}
                onClick={() => setShowBatchModal(true)}
                className="cursor-pointer rounded-xl flex items-center gap-2 py-2 font-bold text-foreground"
              >
                <Printer className="w-4 h-4 text-amber-500" />
                <span>Imprimir etiquetas selecionadas</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowBatchModal(true)} className="cursor-pointer rounded-xl flex items-center gap-2 py-2">
                <Printer className="w-4 h-4 text-amber-500" />
                <span>Imprimir etiquetas por lote</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (filteredOrders.length > 0) setLabelModalOrder(filteredOrders[0]);
                }}
                className="cursor-pointer rounded-xl flex items-center gap-2 py-2"
              >
                <Printer className="w-4 h-4 text-slate-500" />
                <span>Imprimir etiqueta individual</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowHistoryModal(true)} className="cursor-pointer rounded-xl flex items-center gap-2 py-2">
                <History className="w-4 h-4 text-purple-500" />
                <span>Histórico de impressões e exportações</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowConfigModal(true)} className="cursor-pointer rounded-xl flex items-center gap-2 py-2 text-muted-foreground">
                <Settings className="w-4 h-4 text-slate-500" />
                <span>Configurar modelos de etiqueta</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="h-10 rounded-xl border-border/60 text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Cards de KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-1 shadow-sm">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Solicitadas</p>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{kpis.requested || 0}</p>
          <p className="text-[10px] text-muted-foreground">Aguardando análise</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-1 shadow-sm">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Aprovadas</p>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{kpis.approved || 0}</p>
          <p className="text-[10px] text-muted-foreground">Prontas p/ liberar</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-1 shadow-sm">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Em Produção</p>
          <p className="text-2xl font-black text-cyan-600 dark:text-cyan-400">{kpis.inProduction || 0}</p>
          <p className="text-[10px] text-muted-foreground">No chão de fábrica</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-1 shadow-sm">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Concluídas</p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{kpis.completed || 0}</p>
          <p className="text-[10px] text-muted-foreground">Peças finalizadas</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-1 shadow-sm">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Atrasadas</p>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400">{kpis.delayed || 0}</p>
          <p className="text-[10px] text-muted-foreground">&gt; 24h em aberto</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-3.5 space-y-1 shadow-sm">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Tempo Médio</p>
          <p className="text-2xl font-black text-foreground">{kpis.avgHours || 0}h</p>
          <p className="text-[10px] text-muted-foreground">Solicitação → Fim</p>
        </div>
      </div>

      {/* Abas e Filtros */}
      <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Abas */}
          <div className="flex p-1 bg-secondary/50 rounded-xl border border-border/40 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === 'active' ? 'bg-background shadow text-amber-600 dark:text-amber-400 font-extrabold' : 'text-muted-foreground hover:bg-background/40'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Fila Ativa ({(kpis.requested || 0) + (kpis.approved || 0) + (kpis.inProduction || 0)})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === 'completed' ? 'bg-background shadow text-emerald-600 dark:text-emerald-400 font-extrabold' : 'text-muted-foreground hover:bg-background/40'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Histórico & Concluídas ({kpis.completed || 0})
            </button>
          </div>

          {/* Busca Textual */}
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Buscar por lote, pedido, cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-xs rounded-xl"
            />
          </div>
        </div>

        {/* Filtros Secundários */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/40 text-xs">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-semibold text-muted-foreground">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs font-medium focus-visible:outline-none"
            >
              <option value="all">Todos os Status</option>
              <option value="requested">Solicitadas</option>
              <option value="under_review">Em Análise</option>
              <option value="approved">Aprovadas</option>
              <option value="released">Liberadas</option>
              <option value="in_production">Em Produção</option>
              <option value="completed">Concluídas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-muted-foreground">Prioridade:</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs font-medium focus-visible:outline-none"
            >
              <option value="all">Todas as Prioridades</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="critical">Crítica</option>
            </select>
          </div>
        </div>
      </div>

      {/* BARRA DE SELEÇÃO EM LOTE */}
      <div className="bg-secondary/40 border border-border/60 rounded-2xl p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleSelectAll}
            className="h-8 text-xs font-bold flex items-center gap-1.5"
          >
            {selectedIds.length === filteredOrders.length && filteredOrders.length > 0 ? (
              <CheckSquare className="w-4 h-4 text-amber-500" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground" />
            )}
            {selectedIds.length === filteredOrders.length && filteredOrders.length > 0
              ? 'Limpar seleção'
              : 'Selecionar todos os visíveis'}
          </Button>

          <span className="text-muted-foreground font-semibold">
            <strong>{selectedIds.length}</strong> reposições selecionadas
            {selectedIds.length > 0 && (
              <span className="text-[11px] ml-1 font-normal">
                ({approvedSelectedCount} aprovadas e {pendingSelectedCount} aguardando aprovação)
              </span>
            )}
          </span>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSelectedPdf}
              className="h-8 rounded-xl text-xs font-bold border-border/60 flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5 text-blue-500" />
              Exportar Selecionados (PDF)
            </Button>
            <Button
              size="sm"
              onClick={() => setShowBatchModal(true)}
              className="h-8 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5 shadow"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir Etiquetas ({approvedSelectedCount})
            </Button>
          </div>
        )}
      </div>

      {/* Lista de Ordens de Reposição */}
      {isLoading ? (
        <div className="py-12 text-center space-y-3">
          <div className="w-8 h-8 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-muted-foreground">Carregando ordens de reposição...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-2xl p-12 text-center space-y-3 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto text-muted-foreground">
            <RotateCcw className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-foreground">Nenhuma Ordem de Reposição Encontrada</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Não há ordens de reposição registradas para os filtros selecionados nesta aba.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <ReplacementOrderCard
              key={order.id}
              order={order}
              onApprove={() => setApproveOrderId(order.id)}
              onRelease={handleRelease}
              onComplete={handleComplete}
              onCancel={handleCancel}
              userPermissions={userPermissions}
              isSelected={selectedIds.includes(order.id)}
              onToggleSelect={() => handleToggleSelect(order.id)}
              onOpenLabelModal={(ord) => setLabelModalOrder(ord)}
              onOpenPdfReport={handleOpenSinglePdfReport}
              onOpenHistoryModal={() => setShowHistoryModal(true)}
            />
          ))}
        </div>
      )}

      {/* Modal de Aprovação */}
      {approveOrderId && (
        <ReplacementApproveModal
          open={!!approveOrderId}
          onOpenChange={(open) => !open && setApproveOrderId(null)}
          orderId={approveOrderId}
          onApproved={handleRefresh}
        />
      )}

      {/* Modal de Pré-visualização de Etiqueta Térmica */}
      {labelModalOrder && (
        <ReplacementLabelPreviewModal
          open={!!labelModalOrder}
          onOpenChange={(open) => !open && setLabelModalOrder(null)}
          order={labelModalOrder}
          userPermissions={userPermissions}
          onPrinted={handleRefresh}
        />
      )}

      {/* Modal de Impressão e Exportação em Lote */}
      {showBatchModal && (
        <ReplacementBatchPrintModal
          open={showBatchModal}
          onOpenChange={setShowBatchModal}
          selectedOrders={selectedOrdersList.length > 0 ? selectedOrdersList : filteredOrders}
          userPermissions={userPermissions}
          onBatchComplete={handleRefresh}
        />
      )}

      {/* Modal de Histórico de Impressões e Exportações */}
      {showHistoryModal && (
        <ReplacementHistoryModal
          open={showHistoryModal}
          onOpenChange={setShowHistoryModal}
        />
      )}

      {/* Modal de Configuração de Modelos de Etiqueta */}
      {showConfigModal && (
        <LabelTemplateConfigModal
          open={showConfigModal}
          onOpenChange={setShowConfigModal}
        />
      )}
    </div>
  );
}

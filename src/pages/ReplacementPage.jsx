import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateAllMesQueries } from '@/config/queryKeys';
import {
  RotateCcw, Filter, Search, CheckCircle2, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getReplacementKpis,
  releaseReplacement,
  completeReplacement,
  cancelReplacement
} from '@/lib/replacementService';
import { getCanonicalReplacementOrders } from '@/lib/replacementCanonicalService';
import { useAuth } from '@/lib/AuthContext';
import ReplacementOrderCard from '@/components/replacement/ReplacementOrderCard';
import ReplacementApproveModal from '@/components/replacement/ReplacementApproveModal';
import { toast } from 'sonner';

export default function ReplacementPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [approveOrderId, setApproveOrderId] = useState(null);

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
      limit: 50
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

  const handleRefresh = () => {
    invalidateAllMesQueries(queryClient);
    refetchKpis();
    refetchOrders();
    toast.info('Dados de reposição atualizados.');
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
            Gestão transacional de peças reprovadas, ordens de reposição e rastreabilidade até a conclusão.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
    </div>
  );
}

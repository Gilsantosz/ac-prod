import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, CheckCircle2, CheckSquare, Download, Factory, FileText,
  Filter, History, LockKeyhole, Printer, RefreshCw, RotateCcw, Search,
  Settings, ShieldCheck, Square, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { invalidateAllMesQueries } from '@/config/queryKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  cancelReplacement, getActiveReplacementOperators, getReplacementKpis,
  releaseReplacement,
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
import ReplacementForceCompleteModal from '@/components/replacement/ReplacementForceCompleteModal';

const ACTIVE_STATUSES = ['requested', 'under_review', 'approved', 'released', 'in_production'];
const CLOSED_STATUSES = ['completed', 'cancelled'];

export default function ReplacementPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('active');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [approveOrderId, setApproveOrderId] = useState(null);
  const [labelModalOrder, setLabelModalOrder] = useState(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [forceCompleteOrder, setForceCompleteOrder] = useState(null);
  const [cancelOrder, setCancelOrder] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const userPermissions = {
    approve_replacements: user?.role === 'admin' || user?.role === 'manager' || user?.permissions?.approve_replacements,
    manage_replacements: ['admin', 'manager', 'supervisor'].includes(user?.role) || user?.permissions?.manage_replacements,
    admin: user?.role === 'admin',
  };

  const { data: kpis = {}, refetch: refetchKpis } = useQuery({
    queryKey: ['replacement-kpis'],
    queryFn: getReplacementKpis,
    refetchInterval: 15_000,
  });

  const { data: activeOperators = [] } = useQuery({
    queryKey: ['replacement-active-operators'],
    queryFn: getActiveReplacementOperators,
    refetchInterval: 30_000,
  });

  const {
    data: ordersData = { orders: [], count: 0 },
    isLoading,
    isError,
    error: ordersError,
    refetch: refetchOrders,
  } = useQuery({
    queryKey: ['replacement-orders', activeTab, statusFilter, priorityFilter, search],
    queryFn: () => getCanonicalReplacementOrders({
      status: statusFilter !== 'all' ? statusFilter : null,
      priority: priorityFilter !== 'all' ? priorityFilter : null,
      search: search.trim() || null,
      limit: 100,
    }),
    refetchInterval: 10_000,
  });

  const filteredOrders = useMemo(() => (ordersData.orders || []).filter((order) => {
    if (statusFilter !== 'all') return true;
    return (activeTab === 'active' ? ACTIVE_STATUSES : CLOSED_STATUSES).includes(order.status);
  }), [activeTab, ordersData.orders, statusFilter]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => filteredOrders.some((order) => order.id === id)));
  }, [filteredOrders]);

  const selectedOrders = filteredOrders.filter((order) => selectedIds.includes(order.id));
  const printableSelected = selectedOrders.filter((order) => order.status !== 'cancelled');
  const activeTotal = (kpis.requested || 0) + (kpis.underReview || 0) + (kpis.approved || 0) + (kpis.released || 0) + (kpis.inProduction || 0);

  const handleRefresh = () => {
    invalidateAllMesQueries(queryClient);
    refetchKpis();
    refetchOrders();
  };

  const toggleAll = () => {
    setSelectedIds(selectedIds.length === filteredOrders.length && filteredOrders.length
      ? []
      : filteredOrders.map((order) => order.id));
  };

  const toggleOne = (id) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  };

  const handleRelease = async (order) => {
    try {
      await releaseReplacement(order.id);
      toast.success('Ordem liberada para fabricação.');
      handleRefresh();
    } catch (error) {
      toast.error(error.message || 'Falha ao liberar a reposição.');
    }
  };

  const confirmCancel = async () => {
    if (!cancelOrder || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      await cancelReplacement(cancelOrder.id, cancelReason.trim());
      toast.success('Ordem de reposição cancelada com auditoria.');
      setCancelOrder(null);
      setCancelReason('');
      handleRefresh();
    } catch (error) {
      toast.error(error.message || 'Falha ao cancelar a reposição.');
    } finally {
      setCancelling(false);
    }
  };

  const exportPdf = async ({ orders = null, singleOrder = null, reportType }) => {
    if (!singleOrder && (!orders || orders.length === 0)) {
      toast.error('Selecione ao menos uma reposição para exportar.');
      return;
    }
    try {
      await generateReplacementPdfReport({
        orders,
        singleOrder,
        filters: { status: statusFilter, priority: priorityFilter, search },
        reportType,
        userName: user?.name || 'Operador MES',
      });
      toast.success('Relatório PDF gerado com sucesso.');
    } catch (error) {
      toast.error(error.message || 'Falha ao exportar o relatório PDF.');
    }
  };

  return (
    <div className="mx-auto max-w-[1700px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-balance text-2xl font-black text-foreground">
            <RotateCcw className="h-7 w-7 text-amber-500" />
            Módulo de Reposição MES
          </h1>
          <p className="mt-1 max-w-3xl text-pretty text-sm text-muted-foreground">
            Gestão transacional de peças reprovadas, aprovação, fabricação, etiquetas, rastreabilidade e relatórios.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-10 rounded-xl bg-amber-500 font-bold text-white hover:bg-amber-600">
                <Printer className="mr-2 h-4 w-4" /> Imprimir / Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-2xl p-1.5">
              <DropdownMenuItem onClick={() => exportPdf({ orders: filteredOrders, reportType: 'filtered' })} className="rounded-xl py-2">
                <FileText className="mr-2 h-4 w-4 text-blue-500" /> PDF das reposições filtradas
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!selectedOrders.length} onClick={() => exportPdf({ orders: selectedOrders, reportType: 'selected' })} className="rounded-xl py-2">
                <Download className="mr-2 h-4 w-4 text-emerald-500" /> PDF das selecionadas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!printableSelected.length} onClick={() => setShowBatchModal(true)} className="rounded-xl py-2 font-bold">
                <Printer className="mr-2 h-4 w-4 text-amber-500" /> Imprimir {printableSelected.length} etiqueta(s)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowHistoryModal(true)} className="rounded-xl py-2">
                <History className="mr-2 h-4 w-4" /> Histórico de impressão
              </DropdownMenuItem>
              {userPermissions.admin && <DropdownMenuSeparator />}
              {userPermissions.admin && (
                <DropdownMenuItem onClick={() => setShowConfigModal(true)} className="rounded-xl py-2">
                  <Settings className="mr-2 h-4 w-4" /> Modelo da etiqueta
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
        </div>
      </header>

      <section className="overflow-hidden rounded-3xl border border-amber-500/25 bg-card shadow-sm" data-testid="replacement-station-entry">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600"><Factory className="h-7 w-7" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-balance text-lg font-black">Posto de Baixa Produtiva de Reposição</h2>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  {activeOperators.length} operador(es) online
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-pretty text-sm text-muted-foreground">
                A bipagem por célula funciona em uma página operacional separada. O login só é liberado para colaboradores com permissão de reposição ativa.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {userPermissions.admin && (
              <Button variant="outline" className="rounded-xl" onClick={() => navigate('/operadores')}>
                <Users className="mr-2 h-4 w-4" /> Liberar colaboradores
              </Button>
            )}
            <Button className="rounded-xl bg-amber-500 font-bold text-white hover:bg-amber-600" onClick={() => navigate('/reposicao/posto')}>
              Abrir Posto de Reposição <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid border-t border-border/60 bg-secondary/15 sm:grid-cols-3">
          <StationDetail icon={LockKeyhole} title="Login restrito" text="Matrícula, usuário autenticado e liberação de reposição." />
          <StationDetail icon={ShieldCheck} title="Célula autorizada" text="Somente células e máquinas vinculadas ao colaborador." />
          <StationDetail icon={RefreshCw} title="Fila e sincronização" text="Sequência produtiva, Realtime e reconciliação offline." />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Solicitadas" value={kpis.requested} caption="Aguardando análise" tone="text-amber-600" />
        <Kpi label="Aprovadas" value={kpis.approved} caption="Prontas para liberar" tone="text-blue-600" />
        <Kpi label="Em produção" value={kpis.inProduction} caption="No chão de fábrica" tone="text-cyan-600" />
        <Kpi label="Concluídas" value={kpis.completed} caption="Peças finalizadas" tone="text-emerald-600" />
        <Kpi label="Atrasadas" value={kpis.delayed} caption="Mais de 24h abertas" tone="text-rose-600" />
        <Kpi label="Tempo médio" value={`${kpis.avgHours || 0}h`} caption="Solicitação até fim" />
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex w-fit rounded-xl border border-border/40 bg-secondary/50 p-1 text-xs font-bold">
            <TabButton active={activeTab === 'active'} onClick={() => { setActiveTab('active'); setStatusFilter('all'); }} icon={RotateCcw}>
              Fila ativa ({activeTotal})
            </TabButton>
            <TabButton active={activeTab === 'completed'} onClick={() => { setActiveTab('completed'); setStatusFilter('all'); }} icon={CheckCircle2} completed>
              Histórico e concluídas ({kpis.completed || 0})
            </TabButton>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lote, pedido, cliente ou peça" className="h-10 rounded-xl pl-9" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-3 text-xs">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <label className="flex items-center gap-2 font-semibold text-muted-foreground">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-xs font-medium text-foreground">
              <option value="all">Todos</option><option value="requested">Solicitadas</option><option value="under_review">Em análise</option>
              <option value="approved">Aprovadas</option><option value="released">Liberadas</option><option value="in_production">Em produção</option>
              <option value="completed">Concluídas</option><option value="cancelled">Canceladas</option>
            </select>
          </label>
          <label className="flex items-center gap-2 font-semibold text-muted-foreground">
            Prioridade
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-xs font-medium text-foreground">
              <option value="all">Todas</option><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option>
            </select>
          </label>
        </div>
      </section>

      <section className="flex flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/35 p-3.5 text-xs sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={toggleAll} className="h-8 font-bold">
            {selectedIds.length === filteredOrders.length && filteredOrders.length
              ? <CheckSquare className="mr-2 h-4 w-4 text-amber-500" />
              : <Square className="mr-2 h-4 w-4" />}
            {selectedIds.length === filteredOrders.length && filteredOrders.length ? 'Limpar seleção' : 'Selecionar todos os visíveis'}
          </Button>
          <span className="font-semibold text-muted-foreground"><strong className="tabular-nums text-foreground">{selectedIds.length}</strong> selecionada(s)</span>
        </div>
        {!!selectedIds.length && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => exportPdf({ orders: selectedOrders, reportType: 'selected' })}><FileText className="mr-2 h-4 w-4" /> PDF</Button>
            <Button size="sm" className="rounded-xl bg-amber-500 font-bold text-white hover:bg-amber-600" onClick={() => setShowBatchModal(true)}><Printer className="mr-2 h-4 w-4" /> Etiquetas ({printableSelected.length})</Button>
          </div>
        )}
      </section>

      {isLoading ? (
        <div className="space-y-4" aria-label="Carregando ordens de reposição"><OrderSkeleton /><OrderSkeleton /></div>
      ) : isError ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-center">
          <p className="font-bold text-rose-700 dark:text-rose-300">Não foi possível carregar as reposições.</p>
          <p className="mt-1 text-sm text-muted-foreground">{ordersError?.message}</p>
          <Button variant="outline" className="mt-4" onClick={() => refetchOrders()}>Tentar novamente</Button>
        </div>
      ) : !filteredOrders.length ? (
        <div className="rounded-2xl border border-border/60 bg-card p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60"><RotateCcw className="h-6 w-6 text-muted-foreground" /></div>
          <h3 className="mt-3 text-base font-bold">Nenhuma Ordem de Reposição Encontrada</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Não há ordens registradas para os filtros selecionados nesta aba.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <ReplacementOrderCard
              key={order.id}
              order={order}
              onApprove={() => setApproveOrderId(order.id)}
              onRelease={handleRelease}
              onComplete={() => setForceCompleteOrder(order)}
              onCancel={() => { setCancelOrder(order); setCancelReason(''); }}
              userPermissions={userPermissions}
              isSelected={selectedIds.includes(order.id)}
              onToggleSelect={() => toggleOne(order.id)}
              onOpenLabelModal={setLabelModalOrder}
              onOpenPdfReport={(singleOrder) => exportPdf({ singleOrder, reportType: 'individual' })}
              onOpenHistoryModal={() => setShowHistoryModal(true)}
            />
          ))}
        </div>
      )}

      {approveOrderId && <ReplacementApproveModal open onOpenChange={(open) => !open && setApproveOrderId(null)} orderId={approveOrderId} onApproved={handleRefresh} />}
      {labelModalOrder && <ReplacementLabelPreviewModal open onOpenChange={(open) => !open && setLabelModalOrder(null)} order={labelModalOrder} userPermissions={userPermissions} onPrinted={handleRefresh} />}
      {showBatchModal && <ReplacementBatchPrintModal open onOpenChange={setShowBatchModal} selectedOrders={selectedOrders.length ? selectedOrders : filteredOrders} userPermissions={userPermissions} onBatchComplete={handleRefresh} />}
      {showHistoryModal && <ReplacementHistoryModal open onOpenChange={setShowHistoryModal} />}
      {showConfigModal && <LabelTemplateConfigModal open onOpenChange={setShowConfigModal} />}
      {forceCompleteOrder && <ReplacementForceCompleteModal order={forceCompleteOrder} open onOpenChange={(open) => !open && setForceCompleteOrder(null)} onSuccess={handleRefresh} />}

      <AlertDialog open={!!cancelOrder} onOpenChange={(open) => !open && setCancelOrder(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar ordem de reposição?</AlertDialogTitle>
            <AlertDialogDescription>O cancelamento será registrado na auditoria e exige uma justificativa operacional.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Informe o motivo do cancelamento" rows={3} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Voltar</AlertDialogCancel>
            <AlertDialogAction disabled={!cancelReason.trim() || cancelling} onClick={(event) => { event.preventDefault(); confirmCancel(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancelling ? 'Cancelando...' : 'Confirmar cancelamento'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StationDetail({ icon: Icon, title, text }) {
  return <div className="flex gap-3 border-border/60 p-4 sm:border-r sm:last:border-r-0"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="text-xs font-bold">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{text}</p></div></div>;
}

function Kpi({ label, value = 0, caption, tone = 'text-foreground' }) {
  return <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm"><p className="text-[11px] font-bold uppercase text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-black tabular-nums ${tone}`}>{value ?? 0}</p><p className="mt-1 text-[10px] text-muted-foreground">{caption}</p></div>;
}

function TabButton({ active, onClick, icon: Icon, children, completed = false }) {
  return <button type="button" onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 ${active ? `bg-background shadow-sm ${completed ? 'text-emerald-600' : 'text-amber-600'}` : 'text-muted-foreground hover:bg-background/50'}`}><Icon className="h-3.5 w-3.5" />{children}</button>;
}

function OrderSkeleton() {
  return <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5"><div className="flex justify-between"><Skeleton className="h-8 w-52 rounded-xl" /><Skeleton className="h-7 w-28 rounded-xl" /></div><div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div><Skeleton className="h-24 rounded-xl" /></div>;
}

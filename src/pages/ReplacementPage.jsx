import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle, CheckCircle2, Clock3, FileClock, FileDown, Factory,
  History, PackageCheck, Printer, RefreshCw, Route, Search, ShieldCheck,
  Truck, UserRound, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';
import {
  REPLACEMENT_STATUS_LABELS,
  approveReplacement,
  calculateReplacementAdminSummary,
  cancelReplacement,
  forceCompleteReplacement,
  getActiveReplacementOperators,
  getReplacementHistory,
  getReplacementOrders,
  registerReplacementLabelPrint,
  releaseReplacement,
} from '@/lib/replacementService';

const OPEN_STATUSES = new Set(['requested', 'under_review', 'approved', 'released', 'in_production', 'Reposição solicitada', 'Reposição em produção']);
const COMPLETE_STATUSES = new Set(['completed', 'Finalizada']);
const CANCELLED_STATUSES = new Set(['cancelled', 'Cancelada']);

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatElapsed(value) {
  const seconds = Math.max((Date.now() - new Date(value || Date.now()).getTime()) / 1000, 0);
  if (seconds < 3600) return `${Math.max(Math.floor(seconds / 60), 1)} min`;
  const hours = Math.floor(seconds / 3600);
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}min`;
}

function orderCode(order) {
  return order.production_order?.order_number || order.production_order?.order_code || order.production_order_id?.slice(0, 8) || '—';
}

function customerName(order) {
  return order.production_order?.customer_legal_name || order.production_order?.customer_name || '—';
}

function pieceCode(piece) {
  return piece?.traceability_code || piece?.piece_uid || piece?.piece_code || '—';
}

function normalizeStage(value) {
  const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return ({ corte: 'cut', cut: 'cut', borda: 'edge', edge: 'edge', usinagem: 'cnc', cnc: 'cnc', marcenaria: 'joinery', joinery: 'joinery', separacao: 'separation', separation: 'separation', embalagem: 'packaging', packaging: 'packaging' })[key] || key;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function statusTone(status) {
  if (COMPLETE_STATUSES.has(status)) return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (CANCELLED_STATUSES.has(status)) return 'border-slate-500/25 bg-slate-500/10 text-slate-600';
  if (['in_production', 'Reposição em produção'].includes(status)) return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300';
  return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

export default function ReplacementPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [history, setHistory] = useState(null);

  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role)
    || user?.permissions?.manage_replacements === true;

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [ordersResult, operatorsResult] = await Promise.all([
        getReplacementOrders(),
        getActiveReplacementOperators(),
      ]);
      setOrders(ordersResult);
      setOperators(operatorsResult);
    } catch (error) {
      toast.error(error.message || 'Falha ao carregar a gestão de reposições.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = window.setInterval(() => loadData({ silent: true }), 45_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const summary = useMemo(() => calculateReplacementAdminSummary(orders), [orders]);
  const filteredOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return orders.filter((order) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'open' && OPEN_STATUSES.has(order.status))
        || (statusFilter === 'completed' && COMPLETE_STATUSES.has(order.status))
        || (statusFilter === 'cancelled' && CANCELLED_STATUSES.has(order.status))
        || order.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || order.priority === priorityFilter;
      const searchable = [
        order.id, order.reason, order.status, orderCode(order), customerName(order),
        order.production_lot?.lot_code, pieceCode(order.original_piece),
        pieceCode(order.replacement_piece), order.original_piece?.piece_name,
        order.replacement_piece?.piece_name,
      ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return matchesStatus && matchesPriority && (!term || searchable.includes(term));
    });
  }, [orders, priorityFilter, search, statusFilter]);

  const runAction = async (order, action, successMessage) => {
    setBusyId(order.id);
    try {
      await action();
      toast.success(successMessage);
      await loadData({ silent: true });
    } catch (error) {
      toast.error(error.message || 'A operação foi recusada pelo servidor.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = (order) => {
    const reason = window.prompt('Informe o motivo obrigatório do cancelamento:');
    if (!reason?.trim()) return;
    runAction(order, () => cancelReplacement(order.id, reason.trim()), 'Reposição cancelada com auditoria.');
  };

  const handleForceComplete = (order) => {
    const reason = window.prompt('Justifique a conclusão forçada. Esta ação será auditada:');
    if (!reason?.trim()) return;
    runAction(order, () => forceCompleteReplacement(order.id, reason.trim()), 'Reposição concluída de forma auditada.');
  };

  const handlePrint = async (order) => {
    const isReprint = Boolean(order.label_printed_at || order.print_count > 0);
    const reason = isReprint ? window.prompt('Informe o motivo da reimpressão:') : null;
    if (isReprint && !reason?.trim()) return;
    setBusyId(order.id);
    try {
      await registerReplacementLabelPrint(order, { reason: reason?.trim() || null });
      const popup = window.open('', '_blank', 'width=760,height=520');
      if (!popup) throw new Error('O navegador bloqueou a janela de impressão.');
      popup.document.write(`<!doctype html><html><head><title>Etiqueta de reposição</title><style>body{font-family:Arial;padding:28px}.box{border:3px solid #111;padding:24px}.code{font:700 30px monospace}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}small{display:block;color:#555;text-transform:uppercase}</style></head><body><div class="box"><h1>REPOSIÇÃO</h1><div class="code">${escapeHtml(pieceCode(order.replacement_piece))}</div><div class="grid"><div><small>Peça</small>${escapeHtml(order.replacement_piece?.piece_name)}</div><div><small>Original</small>${escapeHtml(pieceCode(order.original_piece))}</div><div><small>Pedido</small>${escapeHtml(orderCode(order))}</div><div><small>Lote</small>${escapeHtml(order.production_lot?.lot_code)}</div><div><small>Cliente</small>${escapeHtml(customerName(order))}</div><div><small>Prioridade</small>${escapeHtml(order.priority)}</div></div></div><script>window.onload=()=>{window.print();window.close()}</script></body></html>`);
      popup.document.close();
      toast.success(isReprint ? 'Reimpressão registrada.' : 'Impressão registrada.');
      await loadData({ silent: true });
    } catch (error) {
      toast.error(error.message || 'Falha ao imprimir a etiqueta.');
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (order) => {
    setBusyId(order.id);
    try {
      const data = await getReplacementHistory(order.id);
      setHistory({ order, ...data });
    } catch (error) {
      toast.error(error.message || 'Falha ao consultar o histórico.');
    } finally {
      setBusyId(null);
    }
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(17);
    doc.text('Relatório de Reposições — AC.Prod', 14, 16);
    doc.setFontSize(9);
    doc.text(`Gerado em ${formatDate(new Date())} · ${filteredOrders.length} registro(s)`, 14, 23);
    let y = 32;
    filteredOrders.forEach((order, index) => {
      if (y > 190) { doc.addPage(); y = 16; }
      const line = `${index + 1}. ${pieceCode(order.replacement_piece)} | OP ${orderCode(order)} | ${customerName(order)} | ${REPLACEMENT_STATUS_LABELS[order.status] || order.status} | ${order.reason || 'Sem motivo'}`;
      const lines = doc.splitTextToSize(line, 265);
      doc.text(lines, 14, y);
      y += lines.length * 5 + 2;
    });
    doc.save(`reposicoes-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="mx-auto max-w-[1700px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Gestão de Reposições"
        subtitle="Aprovação, liberação, auditoria, etiquetas e acompanhamento do fluxo substituto."
        actions={(
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportPdf}><FileDown className="mr-2 h-4 w-4" /> Relatório PDF</Button>
          <Button className="bg-amber-500 font-bold text-white hover:bg-amber-600" onClick={() => navigate('/reposicao/posto')}>
            <Factory className="mr-2 h-4 w-4" /> Abrir Posto de Reposição
          </Button>
        </div>
        )}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={PackageCheck} label="Disponíveis" value={summary.available} tone="emerald" />
        <SummaryCard icon={Factory} label="Em fabricação" value={summary.inProduction} tone="blue" />
        <SummaryCard icon={AlertTriangle} label="Atrasadas (+24h)" value={summary.delayed} tone="rose" />
        <SummaryCard icon={CheckCircle2} label="Concluídas no turno" value={summary.completedThisShift} tone="violet" />
      </section>

      <section className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça, lote, pedido, cliente ou motivo" className="h-11 rounded-xl pl-10" />
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="open">Em aberto</option><option value="all">Todos os status</option><option value="completed">Concluídas</option><option value="cancelled">Canceladas</option>
            <option value="requested">Solicitadas</option><option value="approved">Aprovadas</option><option value="released">Liberadas</option><option value="in_production">Em fabricação</option>
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="all">Todas as prioridades</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="normal">Normal</option>
          </select>
          <Button variant="outline" onClick={() => loadData()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar</Button>
        </div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black">Ordens de reposição</h2>
            <Badge variant="outline">{filteredOrders.length}</Badge>
          </div>
          {loading && orders.length === 0 ? (
            <EmptyState icon={RefreshCw} text="Carregando reposições..." spin />
          ) : filteredOrders.length === 0 ? (
            <EmptyState icon={PackageCheck} text="Nenhuma reposição corresponde aos filtros." />
          ) : filteredOrders.map((order) => (
            <ReplacementOrderCard
              key={order.id}
              order={order}
              busy={busyId === order.id}
              canManage={canManage}
              onApprove={() => runAction(order, () => approveReplacement(order.id), 'Reposição aprovada.')}
              onRelease={() => runAction(order, () => releaseReplacement(order.id), 'Reposição liberada para produção.')}
              onCancel={() => handleCancel(order)}
              onForceComplete={() => handleForceComplete(order)}
              onPrint={() => handlePrint(order)}
              onHistory={() => openHistory(order)}
            />
          ))}
        </div>

        <aside className="space-y-3">
          <div>
            <h2 className="text-sm font-black">Operadores ativos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Sessões operacionais validadas no servidor</p>
          </div>
          {operators.length === 0 ? <EmptyState icon={UserRound} text="Nenhum operador ativo agora." /> : operators.map((session) => (
            <div key={session.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600"><UserRound className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{session.operator?.name || 'Operador'}</p>
                  <p className="text-xs text-muted-foreground">{session.operator?.registration || 'Matrícula validada'}</p>
                  <p className="mt-2 text-xs"><strong>{session.cell_name_snapshot || 'Sem célula'}</strong>{session.machine_name_snapshot ? ` · ${session.machine_name_snapshot}` : ''}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Último sinal {formatElapsed(session.last_seen_at)} atrás</p>
                </div>
              </div>
            </div>
          ))}
        </aside>
      </section>

      {history && <HistoryModal data={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, tone }) {
  const tones = { emerald: 'bg-emerald-500/10 text-emerald-600', blue: 'bg-blue-500/10 text-blue-600', rose: 'bg-rose-500/10 text-rose-600', violet: 'bg-violet-500/10 text-violet-600' };
  return <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm"><span className={`inline-flex rounded-xl p-2 ${tones[tone]}`}><Icon className="h-4 w-4" /></span><p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>;
}

function ReplacementOrderCard({ order, busy, canManage, onApprove, onRelease, onCancel, onForceComplete, onPrint, onHistory }) {
  const route = order.replacement_piece?.route_steps || [];
  const completed = new Set((order.replacement_piece?.completed_steps || []).map(normalizeStage));
  const canApprove = ['requested', 'under_review', 'Reposição solicitada'].includes(order.status);
  const canRelease = ['approved'].includes(order.status);
  const canClose = OPEN_STATUSES.has(order.status);
  return (
    <article className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-black">{pieceCode(order.replacement_piece)}</span>
            <Badge variant="outline" className={statusTone(order.status)}>{REPLACEMENT_STATUS_LABELS[order.status] || order.status}</Badge>
            <Badge variant="outline" className="capitalize">{order.priority || 'normal'}</Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> {formatElapsed(order.created_at)}</span>
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <Detail label="Peça original" value={`${pieceCode(order.original_piece)} · ${order.original_piece?.piece_name || ''}`} />
            <Detail label="Peça substituta" value={order.replacement_piece?.piece_name} />
            <Detail label="Lote / pedido" value={`${order.production_lot?.lot_code || '—'} · ${orderCode(order)}`} />
            <Detail label="Cliente" value={customerName(order)} />
            <Detail label="Ambiente" value={order.replacement_piece?.environment} />
            <Detail label="Material / cor" value={[order.replacement_piece?.material, order.replacement_piece?.color].filter(Boolean).join(' · ')} />
            <Detail label="Dimensões" value={[order.replacement_piece?.length, order.replacement_piece?.width, order.replacement_piece?.height].filter((value) => value != null).join(' × ')} />
            <Detail label="Motivo da reprovação" value={order.reason} tone="text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold text-muted-foreground"><Route className="h-4 w-4" /> Rota da peça substituta</p>
            <div className="flex flex-wrap gap-1.5">{route.length ? route.map((step) => <span key={step} className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${completed.has(normalizeStage(step)) ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600' : normalizeStage(step) === normalizeStage(order.replacement_piece?.current_stage) ? 'border-amber-500/30 bg-amber-500/10 text-amber-600' : 'border-border text-muted-foreground'}`}>{step}</span>) : <span className="text-xs text-muted-foreground">Rota ainda não definida.</span>}</div>
          </div>
        </div>
        <div className="flex min-w-[210px] flex-wrap gap-2 xl:max-w-[250px] xl:justify-end">
          <Button size="sm" variant="outline" onClick={onHistory} disabled={busy}><History className="mr-2 h-4 w-4" /> Histórico</Button>
          <Button size="sm" variant="outline" onClick={onPrint} disabled={busy || !order.replacement_piece}><Printer className="mr-2 h-4 w-4" /> Etiqueta</Button>
          {canManage && canApprove && <Button size="sm" onClick={onApprove} disabled={busy}><ShieldCheck className="mr-2 h-4 w-4" /> Aprovar</Button>}
          {canManage && canRelease && <Button size="sm" onClick={onRelease} disabled={busy}><Truck className="mr-2 h-4 w-4" /> Liberar</Button>}
          {canManage && canClose && <Button size="sm" variant="outline" onClick={onForceComplete} disabled={busy}><CheckCircle2 className="mr-2 h-4 w-4" /> Concluir auditado</Button>}
          {canManage && canClose && <Button size="sm" variant="destructive" onClick={onCancel} disabled={busy}><XCircle className="mr-2 h-4 w-4" /> Cancelar</Button>}
        </div>
      </div>
    </article>
  );
}

function Detail({ label, value, tone = '' }) {
  return <div className="rounded-xl bg-secondary/25 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-0.5 truncate font-semibold ${tone}`}>{value || '—'}</p></div>;
}

function EmptyState({ icon: Icon, text, spin = false }) {
  return <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"><Icon className={`mx-auto mb-2 h-5 w-5 ${spin ? 'animate-spin' : ''}`} />{text}</div>;
}

function HistoryModal({ data, onClose }) {
  const events = [
    ...data.audits.map((item) => ({ ...item, kind: 'Auditoria', date: item.created_at, title: item.action })),
    ...data.prints.map((item) => ({ ...item, kind: 'Etiqueta', date: item.printed_at, title: item.reprint_reason ? 'Reimpressão' : 'Impressão' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Histórico da reposição">
      <section className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border p-4"><div><h2 className="font-black">Histórico da reposição</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{pieceCode(data.order.replacement_piece)}</p></div><Button size="icon" variant="ghost" onClick={onClose} aria-label="Fechar histórico"><X className="h-4 w-4" /></Button></header>
        <div className="max-h-[68vh] space-y-3 overflow-y-auto p-4">{events.length === 0 ? <EmptyState icon={FileClock} text="Nenhum evento auditado encontrado." /> : events.map((event) => <div key={`${event.kind}-${event.id}`} className="flex gap-3 rounded-2xl border border-border/70 p-3"><span className="mt-0.5 rounded-xl bg-secondary p-2"><FileClock className="h-4 w-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold">{event.title}</p><Badge variant="outline">{event.kind}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(event.date)} · {event.user_name || event.printer_name || 'Sistema'}</p>{event.metadata && <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-secondary/40 p-2 text-[10px]">{JSON.stringify(event.metadata, null, 2)}</pre>}</div></div>)}</div>
      </section>
    </div>
  );
}

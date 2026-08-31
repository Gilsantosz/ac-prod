import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  GitCommit,
  History,
  Layers,
  Play,
  Printer,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  REPLACEMENT_PRIORITY_LABELS,
  REPLACEMENT_STATUS_LABELS,
  formatStageName,
} from '@/lib/replacementService';

const CLOSED_STATUSES = new Set(['completed', 'cancelled', 'Finalizada', 'Cancelada']);

function normalizeList(values = []) {
  return values.map((value) => formatStageName(value).toLocaleLowerCase('pt-BR'));
}

export default function ReplacementOrderCard({
  order,
  onApprove,
  onRelease,
  onComplete,
  onCancel,
  userPermissions = {},
  isSelected = false,
  onToggleSelect = () => {},
  onOpenLabelModal = () => {},
  onOpenPdfReport = () => {},
  onOpenHistoryModal = () => {},
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = REPLACEMENT_STATUS_LABELS[order.status] || {
    label: order.status,
    color: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  };
  const priorityConfig = REPLACEMENT_PRIORITY_LABELS[order.priority] || {
    label: order.priority || 'Normal',
    color: 'text-slate-600 dark:text-slate-400',
  };

  const canApprove = ['requested', 'under_review', 'Reposição solicitada'].includes(order.status)
    && (userPermissions.approve_replacements || userPermissions.admin);
  const canRelease = order.status === 'approved'
    && (userPermissions.manage_replacements || userPermissions.admin);
  const canForceComplete = !CLOSED_STATUSES.has(order.status)
    && (
      userPermissions.force_complete_replacements
      || userPermissions.approve_replacements
      || userPermissions.admin
    );
  const canCancel = !CLOSED_STATUSES.has(order.status)
    && (userPermissions.manage_replacements || userPermissions.admin);

  const createdAt = new Date(order.created_at);
  const ageHours = Math.max(Math.floor((Date.now() - createdAt.getTime()) / 3_600_000), 0);
  const clientLot = order.resolved_client_lot
    || order.lot_code
    || order.original_piece?.lot_code
    || order.original_piece?.lot?.lot_code
    || 'LOTE N/A';
  const generalLot = order.resolved_general_lot
    || order.general_lot_code
    || order.original_piece?.general_lot_code
    || order.original_piece?.lot?.general_lot_code
    || null;
  const orderNumber = order.order_number || order.original_piece?.order_number || '';
  const customerName = order.customer_name || order.original_piece?.customer_name || '';
  const environmentName = order.environment_name
    || order.original_piece?.environment
    || order.original_piece?.environment_name
    || 'Geral / Produção';

  const storedStage = String(order.rejection_stage || '').trim();
  const rawRejectionStage = storedStage
    && !['n/a', 'concluída', 'concluida', 'completed', 'created'].includes(storedStage.toLocaleLowerCase('pt-BR'))
    ? storedStage
    : order.original_piece?.current_stage || 'Corte';
  const rejectionStage = formatStageName(rawRejectionStage);
  const originCell = order.origin_cell_name && order.origin_cell_name !== 'Célula de Origem'
    ? order.origin_cell_name
    : `Célula de ${rejectionStage}`;
  const operatorName = order.operator_name || order.original_piece?.operator_name || 'Operador da coleta';

  const originalPieceUid = order.original_piece?.piece_uid
    || order.original_piece?.traceability_code
    || order.original_piece?.piece_code
    || order.original_piece_id
    || (order.replacement_code
      ? `PÇA-${order.replacement_code.replace('REP-', '')}`
      : `PÇA-${String(order.id || '').substring(0, 8)}`);
  const originalPieceName = order.original_piece?.piece_name
    || order.original_piece?.description
    || order.original_piece?.module_name
    || 'Peça de produção';

  const routeSteps = Array.isArray(order.route_steps) ? order.route_steps : [];
  const firstRouteStep = routeSteps[0] || order.original_piece?.route_steps?.[0] || 'Corte';
  const destinationStage = formatStageName(order.replacement_piece?.current_stage || firstRouteStep);
  const orderCompleted = ['completed', 'Finalizada'].includes(order.status) || order.replacement_completed === true;
  const completedLabels = normalizeList(orderCompleted
    ? routeSteps
    : [
      ...(order.replacement_piece?.completed_steps || []),
      ...(order.completed_steps || []),
    ]);
  let highestCompletedIndex = -1;
  routeSteps.forEach((step, index) => {
    if (completedLabels.includes(formatStageName(step).toLocaleLowerCase('pt-BR'))) {
      highestCompletedIndex = Math.max(highestCompletedIndex, index);
    }
  });

  return (
    <article className={`space-y-4 rounded-3xl border bg-card p-4 shadow-sm transition-all hover:shadow-md md:p-5 ${
      isSelected ? 'border-amber-500 ring-2 ring-amber-500/15' : 'border-border/80'
    }`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            className="mt-1 h-4 w-4 rounded-md border-border text-amber-500 focus:ring-amber-500"
          />
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-black text-foreground">
                {order.replacement_code || `ORD-${String(order.id || '').substring(0, 8)}`}
              </span>
              <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusConfig.color}`}>
                {statusConfig.label}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Criada há {ageHours}h · {Number.isNaN(createdAt.getTime())
                ? 'data indisponível'
                : `${createdAt.toLocaleDateString('pt-BR')} às ${createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-xs ${priorityConfig.color}`}>Prioridade: <strong>{priorityConfig.label}</strong></span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((current) => !current)}
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground"
            aria-label={expanded ? 'Ocultar detalhes' : 'Exibir detalhes'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <div className="grid gap-3 text-xs md:grid-cols-3">
        <SummaryBlock icon={ShieldAlert} iconClass="text-rose-500" title="Motivo / defeito">
          <p className="font-bold text-foreground">{order.reason || 'Não informado'}</p>
          {order.defect_name && <p className="text-[11px] text-muted-foreground">Catálogo: {order.defect_name}</p>}
        </SummaryBlock>
        <SummaryBlock icon={Box} iconClass="text-blue-500" title="Lotes e pedido">
          {generalLot && <p><span className="text-muted-foreground">Lote geral:</span> <strong className="font-mono text-blue-600 dark:text-blue-400">{generalLot}</strong></p>}
          <p><span className="text-muted-foreground">Lote cliente:</span> <strong className="font-mono">{clientLot}</strong></p>
          <p className="text-[11px] text-muted-foreground">{orderNumber ? `Pedido: ${orderNumber}` : 'Pedido não informado'}{customerName ? ` · ${customerName}` : ''}</p>
        </SummaryBlock>
        <SummaryBlock icon={Clock} iconClass="text-indigo-500" title="Origem da reprovação">
          <p className="font-bold text-foreground">{originCell}</p>
          <p className="text-[11px] text-muted-foreground">Etapa reprovada: <strong className="text-rose-600 dark:text-rose-400">{rejectionStage}</strong></p>
        </SummaryBlock>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Peça original reprovada</p>
          <p className="break-all font-mono text-sm font-black text-foreground">{originalPieceUid}</p>
          <p className="font-semibold text-muted-foreground">{originalPieceName}</p>
        </div>
        <ArrowRight className="hidden h-5 w-5 shrink-0 text-amber-500 sm:block" />
        <div className="min-w-0 space-y-1 sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Peça substituta e destino</p>
          <p className="break-all font-mono text-sm font-black text-foreground">
            {order.replacement_piece?.piece_uid
              ? <span className="text-emerald-600 dark:text-emerald-400">{order.replacement_piece.piece_uid}</span>
              : <span className="italic text-muted-foreground">Aguardando aprovação</span>}
          </p>
          <p className="flex items-center gap-1 text-muted-foreground sm:justify-end">
            Vai para:
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              {destinationStage}
            </Badge>
          </p>
        </div>
      </section>

      {routeSteps.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border/40 bg-secondary/20 p-3 text-xs">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
            <span className="flex items-center gap-1.5"><GitCommit className="h-3.5 w-3.5 text-blue-500" /> Rota produtiva da reposição</span>
            <span className="text-[10px]">A substituta reinicia na primeira etapa</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {routeSteps.map((step, index) => {
              const label = formatStageName(step);
              const completed = orderCompleted || index <= highestCompletedIndex;
              const current = !completed && index === highestCompletedIndex + 1;
              const style = completed
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                : current
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600 ring-1 ring-cyan-500/20'
                  : 'border-border bg-background/50 text-muted-foreground';
              return (
                <Fragment key={`${step}-${index}`}>
                  {index > 0 && <span className="text-[10px] text-muted-foreground">➔</span>}
                  <Badge variant="outline" className={`px-2.5 py-1 text-[11px] font-bold ${style}`}>
                    <span className="mr-1">{completed ? '✓' : current ? '●' : '○'}</span>{label}
                  </Badge>
                </Fragment>
              );
            })}
          </div>
        </section>
      )}

      {expanded && (
        <section className="grid gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <p><span className="font-semibold text-foreground">Solicitante:</span> {operatorName}</p>
          <p><span className="font-semibold text-foreground">Ambiente:</span> {environmentName}</p>
          <p><span className="font-semibold text-foreground">Aprovada em:</span> {order.approved_at ? new Date(order.approved_at).toLocaleString('pt-BR') : 'Pendente'}</p>
          <p><span className="font-semibold text-foreground">Concluída em:</span> {order.completed_at ? new Date(order.completed_at).toLocaleString('pt-BR') : 'Em andamento'}</p>
          {order.notes && <p className="sm:col-span-2 lg:col-span-4"><span className="font-semibold text-foreground">Observações:</span> {order.notes}</p>}
        </section>
      )}

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-3">
        {originalPieceUid && (
          <Button asChild type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs font-bold">
            <Link to="/rastreabilidade?tab=kanban"><Layers className="mr-1.5 h-3.5 w-3.5 text-[#2d9c4a]" /> Rastreabilidade</Link>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl border-amber-500/40 text-xs font-bold text-amber-600 hover:bg-amber-500/10 dark:text-amber-400">
              <Printer className="mr-1.5 h-3.5 w-3.5" /> Imprimir <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 rounded-2xl p-1.5 text-xs">
            <DropdownMenuItem onClick={() => onOpenPdfReport(order)} className="cursor-pointer rounded-xl py-2"><FileText className="mr-2 h-4 w-4 text-blue-500" /> Visualizar relatório</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenPdfReport(order)} className="cursor-pointer rounded-xl py-2"><Download className="mr-2 h-4 w-4 text-emerald-500" /> Baixar relatório PDF</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenLabelModal(order)} className="cursor-pointer rounded-xl py-2 font-bold"><Printer className="mr-2 h-4 w-4 text-amber-500" /> Imprimir etiqueta</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenLabelModal(order)} className="cursor-pointer rounded-xl py-2"><RotateCcw className="mr-2 h-4 w-4 text-indigo-500" /> Reimprimir etiqueta</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenHistoryModal(order)} className="cursor-pointer rounded-xl py-2 text-muted-foreground"><History className="mr-2 h-4 w-4" /> Histórico de impressão</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {canApprove && (
          <Button type="button" size="sm" onClick={() => onApprove(order)} className="h-9 rounded-xl bg-blue-600 text-xs font-bold text-white hover:bg-blue-700">
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Aprovar Reposição
          </Button>
        )}
        {canRelease && (
          <Button type="button" size="sm" onClick={() => onRelease(order)} className="h-9 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700">
            <Play className="mr-1.5 h-3.5 w-3.5" /> Liberar fabricação
          </Button>
        )}
        {canForceComplete && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onComplete(order)}
            className="h-9 rounded-xl border-rose-500/30 text-xs font-bold text-rose-600 hover:bg-rose-500/10"
            title="Conclusão excepcional com justificativa e auditoria"
          >
            Concluir Forçada
          </Button>
        )}
        {canCancel && (
          <Button type="button" variant="outline" size="sm" onClick={() => onCancel(order)} className="h-9 rounded-xl border-rose-500/40 text-xs font-bold text-rose-600 hover:bg-rose-500/10">
            Cancelar
          </Button>
        )}
      </footer>
    </article>
  );
}

function SummaryBlock({ icon: Icon, iconClass, title, children }) {
  return (
    <div className="space-y-1 rounded-2xl bg-secondary/30 p-3">
      <p className="flex items-center gap-1.5 font-semibold text-muted-foreground"><Icon className={`h-3.5 w-3.5 ${iconClass}`} /> {title}</p>
      {children}
    </div>
  );
}

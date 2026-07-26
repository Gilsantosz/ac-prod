import React, { useState, Fragment } from 'react';
import {
  RotateCcw, CheckCircle2, Play, Clock,
  ChevronDown, ChevronUp, Box, ShieldAlert, ArrowRight, GitCommit
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { REPLACEMENT_STATUS_LABELS, REPLACEMENT_PRIORITY_LABELS, formatStageName } from '@/lib/replacementService';

export default function ReplacementOrderCard({
  order,
  onApprove,
  onRelease,
  onComplete,
  onCancel,
  userPermissions = {}
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = REPLACEMENT_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-slate-500/10 text-slate-600' };
  const priorityConfig = REPLACEMENT_PRIORITY_LABELS[order.priority] || { label: order.priority, color: '' };

  const canApprove = (order.status === 'requested' || order.status === 'under_review') && (userPermissions.approve_replacements || userPermissions.admin);
  const canRelease = (order.status === 'approved') && (userPermissions.manage_replacements || userPermissions.admin);
  const canComplete = (order.status === 'in_production' || order.status === 'released') && (userPermissions.manage_replacements || userPermissions.admin);
  const canCancel = !['completed', 'cancelled'].includes(order.status) && (userPermissions.manage_replacements || userPermissions.admin);

  const createdAt = new Date(order.created_at);
  const ageHours = Math.floor((new Date() - createdAt) / (1000 * 60 * 60));

  const clientLot = order.resolved_client_lot || order.lot_code || order.original_piece?.lot_code || order.original_piece?.lot?.lot_code || 'LOTE N/A';
  const generalLot = order.resolved_general_lot || order.general_lot_code || order.original_piece?.general_lot_code || order.original_piece?.lot?.general_lot_code || null;
  const orderNumber = order.order_number || order.original_piece?.order_number || '';
  const customerName = order.customer_name || order.original_piece?.customer_name || '';
  const environmentName = order.environment_name || order.original_piece?.environment || order.original_piece?.environment_name || 'Geral / Produção';
  const storedStage = String(order.rejection_stage || '').trim();
  const rawRejectionStage = storedStage && !['n/a', 'concluída', 'concluida', 'completed', 'created'].includes(storedStage.toLowerCase())
    ? storedStage
    : (order.original_piece?.current_stage && !['created', 'completed', 'concluída', 'concluida'].includes(String(order.original_piece.current_stage).toLowerCase()) ? order.original_piece.current_stage : 'Corte');
  const rejectionStage = formatStageName(rawRejectionStage);

  const originCell = (order.origin_cell_name && order.origin_cell_name !== 'Célula de Origem') ? order.origin_cell_name : `Célula de ${rejectionStage}`;
  const operatorName = order.operator_name || order.original_piece?.operator_name || 'Operador da Coleta';

  const originalPieceUid = order.original_piece?.piece_uid 
    || order.original_piece?.traceability_code 
    || order.original_piece?.piece_code 
    || order.original_piece_id
    || (order.replacement_code ? `PÇA-${order.replacement_code.replace('REP-', '')}` : `PÇA-${order.id.substring(0, 8)}`);

  const originalPieceName = order.original_piece?.piece_name 
    || order.original_piece?.description 
    || order.original_piece?.module_name 
    || 'Peça de Produção';

  // Destino pós-aprovação (Para onde a peça vai após aprovação)
  const firstRouteStep = order.original_piece?.route_steps?.[0] || 'Corte (1ª Etapa)';
  const destinationStage = formatStageName(
    order.replacement_piece?.current_stage
      ? order.replacement_piece.current_stage
      : firstRouteStep
  );

  return (
    <div className="bg-card border border-border/80 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all space-y-3">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-mono font-extrabold text-foreground flex items-center gap-1.5">
              <span>{order.replacement_code || `ORD-${order.id.substring(0, 8)}`}</span>
              <Badge variant="outline" className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusConfig.color}`}>
                {statusConfig.label}
              </Badge>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Criado há {ageHours}h ({createdAt.toLocaleDateString('pt-BR')} às {createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-xs ${priorityConfig.color}`}>
            Prioridade: <strong>{priorityConfig.label}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {/* Motivo e Defeito */}
        <div className="bg-secondary/30 p-2.5 rounded-xl space-y-1">
          <p className="text-muted-foreground font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            Motivo / Defeito:
          </p>
          <p className="font-bold text-foreground">{order.reason || 'Não informado'}</p>
          {order.defect_name && (
            <p className="text-[11px] text-muted-foreground">Catálogo: {order.defect_name}</p>
          )}
        </div>

        {/* Lote Geral, Lote Cliente e Pedido */}
        <div className="bg-secondary/30 p-2.5 rounded-xl space-y-1">
          <p className="text-muted-foreground font-semibold flex items-center gap-1">
            <Box className="w-3.5 h-3.5 text-blue-500" />
            Lotes & Pedido:
          </p>
          <div className="space-y-0.5">
            {generalLot && (
              <p className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <span className="text-muted-foreground font-normal">Lote Geral:</span>
                <span>{generalLot}</span>
              </p>
            )}
            <p className="text-xs font-mono font-bold text-foreground flex items-center gap-1">
              <span className="text-muted-foreground font-normal">Lote Cliente:</span>
              <span>{clientLot}</span>
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground pt-0.5">
            {orderNumber ? `Pedido: ${orderNumber}` : ''} {customerName ? `• ${customerName}` : ''}
          </p>
        </div>

        {/* Célula e Etapa de Origem */}
        <div className="bg-secondary/30 p-2.5 rounded-xl space-y-1">
          <p className="text-muted-foreground font-semibold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-indigo-500" />
            Origem da Reprovação:
          </p>
          <p className="font-bold text-foreground">{originCell}</p>
          <p className="text-[11px] text-muted-foreground">Etapa reprovada: <strong className="text-rose-600 dark:text-rose-400">{rejectionStage}</strong></p>
        </div>
      </div>

      {/* Relação entre Peça Original, Substituta e Destino Pós-Aprovação */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] text-amber-700 dark:text-amber-300 font-bold uppercase tracking-wider">
            Peça Original (Reprovada em {rejectionStage})
          </p>
          <div className="flex flex-wrap items-center gap-1.5 font-mono">
            <span className="font-extrabold text-foreground text-xs">{originalPieceUid}</span>
            {order.original_piece?.piece_code && order.original_piece.piece_code !== originalPieceUid && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono font-bold border-amber-500/30">
                Cód: {order.original_piece.piece_code}
              </Badge>
            )}
            {order.original_piece?.traceability_code && order.original_piece.traceability_code !== originalPieceUid && order.original_piece.traceability_code !== order.original_piece?.piece_code && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-secondary/80 text-muted-foreground font-mono">
                Tag / Rastreio: {order.original_piece.traceability_code}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground font-semibold">{originalPieceName}</p>
          {(order.original_piece?.material || order.original_piece?.color || order.original_piece?.thickness) && (
            <p className="text-[10px] text-muted-foreground/80">
              {[
                order.original_piece.material,
                order.original_piece.color,
                order.original_piece.thickness ? `${order.original_piece.thickness}mm` : null,
                order.original_piece.length && order.original_piece.width ? `${order.original_piece.length}x${order.original_piece.width}mm` : null
              ].filter(Boolean).join(' • ')}
            </p>
          )}
        </div>

        <ArrowRight className="w-5 h-5 text-amber-500 shrink-0 hidden sm:block" />

        <div className="space-y-0.5 sm:text-right">
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold uppercase tracking-wider">Peça Substituta & Destino Pós-Aprovação</p>
          <p className="font-mono font-bold text-foreground">
            {order.replacement_piece?.piece_uid ? (
              <span className="text-emerald-600 dark:text-emerald-400">{order.replacement_piece.piece_uid}</span>
            ) : (
              <span className="text-muted-foreground italic">Aguardando aprovação</span>
            )}
          </p>
          <p className="text-muted-foreground flex items-center sm:justify-end gap-1">
            <span>Vai para:</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border-emerald-500/30">
              {destinationStage}
            </Badge>
          </p>
        </div>
      </div>

      {/* Sequenciamento da Rota Produtiva */}
      {order.route_steps && order.route_steps.length > 0 && (
        <div className="bg-secondary/20 border border-border/40 rounded-xl p-2.5 text-xs space-y-1.5">
          <p className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1">
            <GitCommit className="w-3.5 h-3.5 text-blue-500" />
            Sequenciamento da Rota Produtiva (Peça aprovada reinicia no {destinationStage}):
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {order.route_steps.map((step, idx) => {
              const formattedStep = formatStageName(step);
              const isRejectionStage = formattedStep.toLowerCase().includes(rejectionStage.toLowerCase()) || String(step).toLowerCase().includes(rejectionStage.toLowerCase());
              const isDestination = idx === 0;
              return (
                <Fragment key={idx}>
                  {idx > 0 && <span className="text-muted-foreground text-[10px]">➔</span>}
                  <Badge
                    variant="outline"
                    className={`text-[11px] px-2 py-0.5 font-bold ${
                      isRejectionStage
                        ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                        : isDestination
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                        : 'bg-secondary text-muted-foreground border-border/40'
                    }`}
                  >
                    {formattedStep}
                    {isRejectionStage && <span className="ml-1 text-[9px] font-normal">(Reprovada)</span>}
                    {isDestination && !isRejectionStage && <span className="ml-1 text-[9px] font-normal">(Novo Início)</span>}
                  </Badge>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Expansão com Detalhes Adicionais */}
      {expanded && (
        <div className="pt-2 border-t border-border/40 space-y-2 text-xs text-muted-foreground animate-in fade-in duration-200">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <p><span className="font-semibold">Solicitante:</span> {operatorName}</p>
            <p><span className="font-semibold">Ambiente:</span> {environmentName}</p>
            <p><span className="font-semibold">Aprovado em:</span> {order.approved_at ? new Date(order.approved_at).toLocaleDateString('pt-BR') : 'Pendente'}</p>
            <p><span className="font-semibold">Concluído em:</span> {order.completed_at ? new Date(order.completed_at).toLocaleDateString('pt-BR') : 'Em andamento'}</p>
          </div>
          {order.notes && (
            <div className="bg-secondary/40 p-2 rounded-lg border border-border/30 text-[11px]">
              <strong className="text-foreground">Observações:</strong> {order.notes}
            </div>
          )}
        </div>
      )}

      {/* Ações da Ordem conforme perfil */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/40">
        {canApprove && (
          <Button
            type="button"
            size="sm"
            onClick={() => onApprove(order)}
            className="h-9 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Aprovar Reposição
          </Button>
        )}

        {canRelease && (
          <Button
            type="button"
            size="sm"
            onClick={() => onRelease(order)}
            className="h-9 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            Liberar Fabricação
          </Button>
        )}

        {canComplete && (
          <Button
            type="button"
            size="sm"
            onClick={() => onComplete(order)}
            className="h-9 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Concluir Reposição
          </Button>
        )}

        {canCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onCancel(order)}
            className="h-9 text-xs font-bold border-rose-500/40 text-rose-600 hover:bg-rose-500/10 rounded-xl"
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}

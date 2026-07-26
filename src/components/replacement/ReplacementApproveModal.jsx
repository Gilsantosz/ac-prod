import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { approveReplacement } from '@/lib/replacementService';
import { toast } from 'sonner';

export default function ReplacementApproveModal({
  open = false,
  onOpenChange = null,
  order = null,
  onApproved = null
}) {
  const [priority, setPriority] = useState('high');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  if (!order) return null;

  const handleApprove = async () => {
    try {
      setLoading(true);
      const result = await approveReplacement(order.id, { priority, notes: notes.trim() });
      toast.success('Ordem de reposição aprovada! Peça substituta criada.');
      onApproved?.(result);
      onOpenChange?.(false);
    } catch (error) {
      console.error('Erro ao aprovar reposição:', error);
      toast.error(error.message || 'Falha ao aprovar reposição.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-blue-600 dark:text-blue-400">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            Aprovar Ordem de Reposição
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A aprovação irá gerar a peça substituta preservando o histórico e rota da peça original.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="bg-secondary/40 p-3 rounded-xl border border-border/40 space-y-1.5">
            <p className="font-bold text-foreground font-mono">Ordem: {order.replacement_code || order.id}</p>
            <p className="text-muted-foreground">
              Peça Original: <strong className="text-foreground font-mono">{order.original_piece?.traceability_code || order.original_piece?.piece_uid || 'N/A'}</strong>
              <span className="ml-1 font-semibold text-foreground">({order.original_piece?.piece_name || 'Peça de Produção'})</span>
            </p>
            <p className="text-muted-foreground">
              {order.resolved_general_lot && (
                <span className="mr-2">Lote Geral: <strong className="text-blue-600 dark:text-blue-400 font-mono">{order.resolved_general_lot}</strong></span>
              )}
              Lote Cliente: <strong className="text-foreground font-mono">{order.resolved_client_lot || order.lot_code || 'LOTE N/A'}</strong>
              {order.order_number || order.original_piece?.order_number ? ` • Pedido: #${order.order_number || order.original_piece?.order_number}` : ''}
              {order.customer_name || order.original_piece?.customer_name ? ` • ${order.customer_name || order.original_piece?.customer_name}` : ''}
            </p>
            <p className="text-muted-foreground">Ambiente: <strong className="text-foreground">{order.environment_name || order.original_piece?.environment || 'Geral'}</strong> • Solicitante: <strong className="text-foreground">{order.operator_name || 'Operador da Coleta'}</strong></p>
            <p className="text-muted-foreground">Origem da Reprovação: <strong className="text-rose-600 dark:text-rose-400">{order.rejection_stage || order.original_piece?.current_stage || 'N/A'}</strong> ({order.origin_cell_name || 'Célula de Origem'})</p>
            <p className="text-muted-foreground">Destino Pós-Aprovação: <strong className="text-emerald-600 dark:text-emerald-400">{order.replacement_piece?.current_stage || order.route_steps?.[0] || 'Corte (1ª Etapa)'}</strong></p>
            {order.route_steps && order.route_steps.length > 0 && (
              <p className="text-muted-foreground text-[11px]">
                Rota Produtiva: <span className="font-semibold text-foreground">{order.route_steps.join(' ➔ ')}</span>
              </p>
            )}
            <p className="text-muted-foreground pt-0.5">Motivo: <strong className="text-foreground">{order.reason}</strong></p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="approve-priority" className="font-bold text-muted-foreground">Prioridade de Produção</Label>
            <select
              id="approve-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="normal">Normal (Entra na fila padrão)</option>
              <option value="high">Alta (Prioridade no plano de corte/bordo)</option>
              <option value="critical">Crítica (Interrupção imediata / Urgente)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="approve-notes" className="font-bold text-muted-foreground">Observações da Aprovação</Label>
            <Textarea
              id="approve-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Liberado em lote especial, reutilizar retalho X..."
              rows={2}
              className="text-xs rounded-xl resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange?.(false)}
            disabled={loading}
            className="text-xs font-semibold rounded-xl"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleApprove}
            disabled={loading}
            className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            {loading ? 'Aprovando...' : 'Confirmar Aprovação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

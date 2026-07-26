import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Factory, Link2, Loader2, Route, ShieldCheck } from 'lucide-react';
import {
  approveReplacementWithCells,
  getReplacementApprovalContext,
} from '@/lib/replacementApprovalService';
import { toast } from 'sonner';

import { formatStageName } from '@/lib/replacementService';

function formatRoute(routeSteps = []) {
  return routeSteps.map((step) => formatStageName(step));
}

export default function ReplacementApproveModal({
  open = false,
  onOpenChange = null,
  orderId = null,
  onApproved = null
}) {
  const [priority, setPriority] = useState('high');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [context, setContext] = useState(null);
  const [selectedCellKeys, setSelectedCellKeys] = useState([]);

  useEffect(() => {
    if (!open || !orderId) return;

    let active = true;
    setContext(null);
    setSelectedCellKeys([]);
    setNotes('');
    setLoadingContext(true);

    getReplacementApprovalContext(orderId)
      .then((result) => {
        if (!active) return;
        setContext(result);
        setPriority(result.order?.priority || 'high');
      })
      .catch((error) => {
        console.error('Erro ao carregar vínculo da reposição:', error);
        if (active) toast.error(error.message || 'Falha ao validar a peça reprovada.');
      })
      .finally(() => {
        if (active) setLoadingContext(false);
      });

    return () => { active = false; };
  }, [open, orderId]);

  const order = context?.order || null;
  const originalPiece = context?.originalPiece || null;
  const routeLabels = useMemo(() => formatRoute(context?.routeSteps || []), [context?.routeSteps]);
  const selectedCells = useMemo(
    () => (context?.cells || []).filter((cell) => selectedCellKeys.includes(cell.selection_key)),
    [context?.cells, selectedCellKeys],
  );

  const toggleCell = (selectionKey) => {
    setSelectedCellKeys((current) => current.includes(selectionKey)
      ? current.filter((key) => key !== selectionKey)
      : [...current, selectionKey]);
  };

  const handleApprove = async () => {
    if (!order || !originalPiece) {
      toast.error('A peça reprovada ainda não foi validada pelo banco.');
      return;
    }

    try {
      setLoading(true);
      const result = await approveReplacementWithCells(order.id, {
        priority,
        notes,
        selectedCells,
      });

      const automaticEntries = Number(result?.automatic_entries || 0);
      toast.success(
        automaticEntries > 0
          ? `Reposição aprovada com ${automaticEntries} baixa(s) por reposição.`
          : 'Reposição aprovada e devolvida à fila produtiva.',
      );
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
      <DialogContent className="sm:max-w-[660px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-blue-600 dark:text-blue-400">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            Aprovar Reposição e Retornar à Produção
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A ordem é recarregada pelo ID e vinculada diretamente à peça reprovada. Nenhuma numeração de outro lote é reutilizada.
          </DialogDescription>
        </DialogHeader>

        {loadingContext ? (
          <div className="py-14 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Validando ordem, peça e lote no banco...
          </div>
        ) : !context ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-700 dark:text-rose-300">
            Não foi possível confirmar a peça reprovada desta ordem. A aprovação foi bloqueada para evitar baixa no número errado.
          </div>
        ) : (
          <div className="space-y-4 py-2 text-xs">
            <div className="bg-secondary/40 p-3 rounded-xl border border-border/40 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-foreground font-mono">Ordem: {order.replacement_code || order.id}</p>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 gap-1">
                  <Link2 className="w-3 h-3" /> Vínculo confirmado
                </Badge>
              </div>

              <p className="text-muted-foreground">
                Peça reprovada: <strong className="text-rose-600 dark:text-rose-400 font-mono text-sm">{context.barcode}</strong>
                <span className="ml-1 font-semibold text-foreground">({originalPiece.piece_name || 'Peça de Produção'})</span>
              </p>
              <p className="text-[10px] text-muted-foreground font-mono break-all">
                original_piece_id: {order.original_piece_id}
              </p>
              <p className="text-muted-foreground">
                Lote Geral: <strong className="text-blue-600 dark:text-blue-400 font-mono">{order.general_lot_code || '—'}</strong>
                {' • '}Lote Cliente: <strong className="text-foreground font-mono">{order.lot_code || '—'}</strong>
                {' • '}Pedido: <strong className="text-foreground">{order.order_number || '—'}</strong>
              </p>
              <p className="text-muted-foreground">
                Cliente: <strong className="text-foreground">{order.customer_name || '—'}</strong>
                {' • '}Ambiente: <strong className="text-foreground">{order.environment_name || '—'}</strong>
              </p>
              <p className="text-muted-foreground">
                Origem da reprovação: <strong className="text-rose-600 dark:text-rose-400">{order.origin_cell_name || formatStageName(order.rejection_stage) || '—'}</strong>
              </p>
              <p className="text-muted-foreground flex items-start gap-1">
                <Route className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Rota: <strong className="text-foreground">{routeLabels.join(' ➔ ') || 'Não informada'}</strong>
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="font-extrabold text-foreground flex items-center gap-1.5">
                    <Factory className="w-4 h-4 text-blue-600" /> Células com baixa automática
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Marque apenas as células que devem receber entrada aprovada com o código {context.barcode}.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedCellKeys((context.cells || []).map((cell) => cell.selection_key))}
                    disabled={(context.cells || []).length === 0}
                    className="h-7 px-2 text-[10px] rounded-lg"
                  >
                    Selecionar todas
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCellKeys([])}
                    disabled={selectedCellKeys.length === 0}
                    className="h-7 px-2 text-[10px] rounded-lg"
                  >
                    Limpar
                  </Button>
                </div>
              </div>

              {(context.cells || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
                  Nenhuma célula ativa foi relacionada à rota. A peça voltará à primeira etapa pendente sem baixa automática.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {context.cells.map((cell) => {
                    const checked = selectedCellKeys.includes(cell.selection_key);
                    return (
                      <label
                        key={cell.selection_key}
                        className={`flex items-center gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-colors ${
                          checked
                            ? 'border-emerald-500/40 bg-emerald-500/10'
                            : 'border-border/50 bg-background hover:bg-secondary/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCell(cell.selection_key)}
                          className="h-4 w-4 accent-emerald-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold text-foreground">{cell.cell_name}</span>
                          <span className="block text-[10px] text-muted-foreground">Etapa: {formatStageName(cell.step_code || cell.step_name) || cell.step_name || cell.step_code}</span>
                        </span>
                        {cell.is_rejection_stage && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-rose-500/30 text-rose-600">Reprovada</Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="rounded-lg bg-background/70 border border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                {selectedCells.length > 0
                  ? `${selectedCells.length} célula(s) receberão histórico e apontamento como “Baixa por reposição”.`
                  : 'Nenhuma baixa automática selecionada; a peça apenas retornará à fila produtiva.'}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="approve-priority" className="font-bold text-muted-foreground">Prioridade de Produção</Label>
              <select
                id="approve-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="normal">Normal (entra na fila padrão)</option>
                <option value="high">Alta (prioridade no plano produtivo)</option>
                <option value="critical">Crítica (urgente)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="approve-notes" className="font-bold text-muted-foreground">Observações da Aprovação</Label>
              <Textarea
                id="approve-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex.: células liberadas automaticamente e condição da reposição."
                rows={2}
                className="text-xs rounded-xl resize-none"
              />
            </div>
          </div>
        )}

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
            disabled={loading || loadingContext || !context}
            className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {loading ? 'Aprovando...' : 'Aprovar e Retornar à Fila'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

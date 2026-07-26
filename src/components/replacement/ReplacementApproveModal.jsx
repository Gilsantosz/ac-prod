import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Factory, Loader2, Route, ShieldCheck } from 'lucide-react';
import {
  approveReplacementWithCells,
  getReplacementApprovalCells,
} from '@/lib/replacementApprovalService';
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
  const [loadingCells, setLoadingCells] = useState(false);
  const [eligibleCells, setEligibleCells] = useState([]);
  const [selectedCellKeys, setSelectedCellKeys] = useState([]);
  const [approvalContext, setApprovalContext] = useState(null);

  useEffect(() => {
    if (!open || !order?.id) return;

    let active = true;
    setPriority(order.priority || 'high');
    setNotes('');
    setEligibleCells([]);
    setApprovalContext(null);
    setSelectedCellKeys([]);
    setLoadingCells(true);

    getReplacementApprovalCells(order.id)
      .then((result) => {
        if (!active) return;
        setEligibleCells(result.cells || []);
        setApprovalContext(result);
      })
      .catch((error) => {
        console.error('Erro ao carregar células elegíveis:', error);
        if (active) toast.error(error.message || 'Falha ao carregar as células da rota.');
      })
      .finally(() => {
        if (active) setLoadingCells(false);
      });

    return () => { active = false; };
  }, [open, order?.id, order?.priority]);

  const selectedCells = useMemo(
    () => eligibleCells.filter((cell) => selectedCellKeys.includes(cell.selection_key)),
    [eligibleCells, selectedCellKeys],
  );

  if (!order) return null;

  const toggleCell = (selectionKey) => {
    setSelectedCellKeys((current) => current.includes(selectionKey)
      ? current.filter((key) => key !== selectionKey)
      : [...current, selectionKey]);
  };

  const handleApprove = async () => {
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
          ? `Reposição aprovada e ${automaticEntries} baixa(s) automática(s) registrada(s).`
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

  const barcode = approvalContext?.barcode
    || order.replacement_barcode
    || order.original_piece?.traceability_code
    || order.original_piece?.piece_uid
    || 'N/A';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-blue-600 dark:text-blue-400">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            Aprovar Reposição e Retornar à Produção
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A peça substituta será ativada na fila com o código de barras original. As células marcadas receberão baixa automática e auditável.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          <div className="bg-secondary/40 p-3 rounded-xl border border-border/40 space-y-1.5">
            <p className="font-bold text-foreground font-mono">Ordem: {order.replacement_code || order.id}</p>
            <p className="text-muted-foreground">
              Código de barras ativo: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{barcode}</strong>
            </p>
            <p className="text-muted-foreground">
              Peça: <strong className="text-foreground">{order.original_piece?.piece_name || 'Peça de Produção'}</strong>
              {' · '}Lote: <strong className="text-foreground font-mono">{order.resolved_client_lot || order.lot_code || 'LOTE N/A'}</strong>
            </p>
            <p className="text-muted-foreground">
              Rota: <strong className="text-foreground">{(approvalContext?.routeSteps || order.route_steps || []).join(' ➔ ') || 'Não informada'}</strong>
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label className="font-extrabold text-foreground flex items-center gap-1.5">
                  <Route className="w-4 h-4 text-blue-600" />
                  Células com baixa automática
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Marque somente as células que devem constar como aprovadas por reposição. As demais continuarão pendentes na fila.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedCellKeys(eligibleCells.map((cell) => cell.selection_key))}
                  disabled={loadingCells || eligibleCells.length === 0}
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

            {loadingCells ? (
              <div className="py-5 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando rota e células...
              </div>
            ) : eligibleCells.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
                Nenhuma célula ativa foi relacionada à rota. A peça será devolvida ao início da fila sem baixas automáticas.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {eligibleCells.map((cell) => {
                  const checked = selectedCellKeys.includes(cell.selection_key);
                  return (
                    <label
                      key={`${cell.cell_id}-${cell.step_code}`}
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
                      <Factory className={`w-4 h-4 ${checked ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-foreground truncate">{cell.cell_name}</span>
                        <span className="block text-[10px] text-muted-foreground font-mono">Etapa: {cell.step_code}</span>
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
                ? `${selectedCells.length} célula(s) receberão uma entrada automática com o código ${barcode}, identificada no histórico como “Baixa por reposição”.`
                : 'Nenhuma baixa automática selecionada. A peça entrará na primeira etapa pendente da rota.'}
            </div>
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
              <option value="high">Alta (Prioridade no plano de produção)</option>
              <option value="critical">Crítica (Urgente)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="approve-notes" className="font-bold text-muted-foreground">Observações da Aprovação</Label>
            <Textarea
              id="approve-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: células liberadas automaticamente e condição da reposição."
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
            disabled={loading || loadingCells}
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

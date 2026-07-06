import { useState } from 'react';
import { AlertTriangle, AlertOctagon, HelpCircle, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const REJECTION_REASONS = [
  'MDF riscado',
  'Peça lascada',
  'Erro de corte',
  'Erro de medida',
  'Erro de furação',
  'Erro de CNC',
  'Borda errada',
  'Borda descolada',
  'Peça quebrada',
  'Peça perdida',
  'Falha de acabamento',
  'Outro'
];

export default function CollectionRejectPieceModal({
  open,
  onOpenChange,
  piece,
  onSubmit,
  loading = false
}) {
  const [reason, setReason] = useState(REJECTION_REASONS[0]);
  const [notes, setNotes] = useState('');
  const [action, setAction] = useState('reject_only'); // reject_only, block, rework

  const handleConfirm = () => {
    if (!reason) return;
    onSubmit({
      reason,
      notes,
      action
    });
    // Reseta form
    setNotes('');
    setAction('reject_only');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 bg-card border border-border/60 rounded-2xl shadow-xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-base font-extrabold flex items-center gap-2 text-rose-600">
            <AlertOctagon className="w-5 h-5 shrink-0" />
            Reprovar Peça de Produção
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A peça será marcada como reprovada no posto de coleta atual. Escolha o motivo e a ação corretiva apropriada.
          </DialogDescription>
        </DialogHeader>

        {piece && (
          <div className="bg-secondary/40 p-3 rounded-xl border border-border/40 text-xs space-y-1">
            <p className="font-bold text-foreground font-mono">UID: {piece.piece_uid || piece.traceability_code}</p>
            <p className="text-muted-foreground">Nome: <span className="text-foreground font-semibold">{piece.piece_name || 'N/A'}</span></p>
            <p className="text-muted-foreground">Lote: <span className="text-foreground font-semibold">{piece.lot_code || 'LOTE-N/A'}</span></p>
          </div>
        )}

        <div className="space-y-4 my-4 text-xs">
          {/* Motivo Obrigatório */}
          <div className="space-y-1.5">
            <Label htmlFor="rejection-reason" className="font-bold text-muted-foreground">Motivo do Refugo *</Label>
            <select
              id="rejection-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {REJECTION_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Ação Corretiva */}
          <div className="space-y-1.5">
            <Label className="font-bold text-muted-foreground block">Ação Corretiva Recomendada</Label>
            <div className="grid grid-cols-1 gap-2">
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${action === 'reject_only' ? 'border-rose-500 bg-rose-500/5 text-rose-700 dark:text-rose-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="corrective-action"
                  value="reject_only"
                  checked={action === 'reject_only'}
                  onChange={() => setAction('reject_only')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs">Apenas reprovar a peça</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Registra a reprovação no posto sem interromper o restante do lote.</p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${action === 'block' ? 'border-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="corrective-action"
                  value="block"
                  checked={action === 'block'}
                  onChange={() => setAction('block')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs">Reprovar e bloquear Lote</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Bloqueia o lote produtivo para análise do controle de qualidade.</p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${action === 'rework' ? 'border-purple-500 bg-purple-500/5 text-purple-700 dark:text-purple-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="corrective-action"
                  value="rework"
                  checked={action === 'rework'}
                  onChange={() => setAction('rework')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs">Reprovar e enviar para Retrabalho</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Gera automaticamente uma nova ordem de produção para substituir a peça.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Observação Opcional */}
          <div className="space-y-1.5">
            <Label htmlFor="rejection-notes" className="font-bold text-muted-foreground">Observações / Detalhes</Label>
            <textarea
              id="rejection-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descreva detalhes específicos do defeito..."
              className="w-full min-h-[70px] rounded-xl border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-xl border-border/60 font-bold"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold"
          >
            Confirmar Rejeição
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

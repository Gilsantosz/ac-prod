import { useEffect, useState } from 'react';
import { AlertOctagon, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const REASONS = [
  'Peça danificada', 'Medida incorreta', 'Falha de acabamento', 'Falha de colagem',
  'Falha de furação', 'Falha de marcenaria', 'Falta de material', 'Erro de etiqueta',
  'Leitura inválida', 'Outros',
];

export default function RejectionOccurrenceDialog({ open, onOpenChange, context, onSubmit, loading }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [defectType, setDefectType] = useState('Qualidade');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [releaseForRework, setReleaseForRework] = useState(true);

  useEffect(() => {
    if (!open) return;
    setReason(REASONS[0]);
    setDefectType('Qualidade');
    setQuantity(1);
    setNotes('');
    setReleaseForRework(true);
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    await onSubmit({ reason, defectType, quantity, notes, releaseForRework });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertOctagon className="w-5 h-5 text-red-600" /> Registrar Ocorrência / Reprovar Peça</DialogTitle>
          <DialogDescription>A reprovação registra o defeito, mantém o histórico da peça e pode liberar uma nova coleta como retrabalho.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm bg-secondary/50 border border-border rounded-md p-3">
            <Info label="Lote" value={context?.lot?.lot_code} />
            <Info label="Peça" value={context?.item?.product_name || context?.item?.item_code} />
            <Info label="Tag" value={context?.reading?.tag_value} mono />
            <Info label="Etapa" value={context?.route?.step_name || context?.item?.current_step} />
            <Info label="Célula" value={context?.reading?.cell_name || context?.route?.cell_name} />
            <Info label="Operador" value={context?.reading?.operator} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="rejection-reason">Motivo</Label><select id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">{REASONS.map((item) => <option key={item}>{item}</option>)}</select></div>
            <div className="space-y-1.5"><Label htmlFor="rejection-defect">Tipo de defeito</Label><Input id="rejection-defect" value={defectType} onChange={(event) => setDefectType(event.target.value)} required /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="rejection-quantity">Quantidade</Label><Input id="rejection-quantity" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></div>
          <label className="flex items-start gap-3 rounded-md border border-border bg-secondary/30 p-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={releaseForRework}
              onChange={(event) => setReleaseForRework(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[#2d9c4a]"
            />
            <span>
              <span className="font-semibold flex items-center gap-1.5"><RotateCcw className="w-4 h-4 text-amber-600" /> Liberar peça para retrabalho e recoleta</span>
              <span className="block text-xs text-muted-foreground mt-0.5">A aprovação futura entra nos KPIs marcada como retrabalho.</span>
            </span>
          </label>
          <div className="space-y-1.5"><Label htmlFor="rejection-notes">Observação</Label><Textarea id="rejection-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Descreva o defeito ou condição encontrada..." /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={loading || !context?.item?.id} className="gap-2">{loading && <Loader2 className="animate-spin" />} Reprovar peça</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value, mono }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`font-medium truncate ${mono ? 'font-mono' : ''}`}>{value || '—'}</p></div>;
}

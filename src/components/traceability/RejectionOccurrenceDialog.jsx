import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getReworkReasons } from '@/lib/reworkService';

export default function RejectionOccurrenceDialog({ open, onOpenChange, context, onSubmit, loading }) {
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');
  const [releaseForRework, setReleaseForRework] = useState(true);

  // Buscar motivos do banco
  const { data: reasons = [] } = useQuery({
    queryKey: ['rework-reasons'],
    queryFn: getReworkReasons,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setNotes('');
    setReleaseForRework(true);
  }, [open]);

  useEffect(() => {
    if (reasons.length > 0) {
      setReasonCode(reasons[0].code);
    }
  }, [reasons]);

  const submit = async (event) => {
    event.preventDefault();
    await onSubmit({
      reasonCode,
      notes,
      releaseForRework
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertOctagon className="w-5 h-5 shrink-0" />
            <span>Registrar Ocorrência / Retrabalho</span>
          </DialogTitle>
          <DialogDescription>
            A reprovação registra o defeito, bloqueia a peça atual e gera uma nova peça substituta rastreável (-R).
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs bg-secondary/30 border border-border rounded-xl p-3">
            <Info label="Lote" value={context?.lot?.lot_code} />
            <Info label="Peça" value={context?.item?.product_name || context?.item?.item_code} />
            <Info label="Código de Rastreio" value={context?.item?.item_code} mono />
            <Info label="Etapa Atual" value={context?.route?.step_name || context?.item?.current_step} />
            <Info label="Posto / Célula" value={context?.reading?.cell_name || context?.route?.cell_name} />
            <Info label="Operador" value={context?.reading?.operator} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rejection-reason">Motivo da Avaria / Rejeição</Label>
            <select
              id="rejection-reason"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
            >
              {reasons.map((item) => (
                <option key={item.id} value={item.code}>{item.description}</option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border bg-secondary/10 p-3 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={releaseForRework}
              onChange={(event) => setReleaseForRework(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#2d9c4a]"
            />
            <div>
              <span className="font-semibold flex items-center gap-1.5 text-amber-600">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Bloquear peça original e liberar peça substituta (-R)</span>
              </span>
              <span className="block text-muted-foreground mt-0.5">
                Uma cópia desta peça com código modificado será liberada imediatamente no PCP para recoleta e roteiro.
              </span>
            </div>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="rejection-notes">Observação detalhada</Label>
            <Textarea
              id="rejection-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Descreva o defeito visual ou operacional encontrado..."
              className="rounded-lg min-h-[80px]"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={loading || !context?.item?.id} className="gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Confirmar Reprovação</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`font-semibold truncate ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}

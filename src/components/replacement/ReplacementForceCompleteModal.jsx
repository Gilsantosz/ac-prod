import { useEffect, useState } from 'react';
import { AlertTriangle, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { forceCompleteReplacement } from '@/lib/replacementService';
import { toast } from 'sonner';

export default function ReplacementForceCompleteModal({ order, open, onOpenChange, onSuccess }) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!open) {
      setReason('');
      setErrorMsg(null);
      setIsSubmitting(false);
    }
  }, [open]);

  if (!order) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg(null);

    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setErrorMsg('A justificativa é obrigatória para a conclusão forçada.');
      return;
    }

    setIsSubmitting(true);
    try {
      await forceCompleteReplacement(order.id, { reason: normalizedReason });
      toast.success('Conclusão forçada registrada e auditada com sucesso.');
      onOpenChange?.(false);
      onSuccess?.();
    } catch (error) {
      console.error('Erro na conclusão forçada:', error);
      setErrorMsg(error.message || 'Falha ao concluir a reposição de forma forçada.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl border-border/80 p-6 shadow-2xl">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle className="text-lg font-black text-rose-600 dark:text-rose-400">
            Conclusão forçada de reposição
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            A ordem <strong>{order.replacement_code || order.id}</strong> será encerrada sem exigir as leituras das etapas restantes. A justificativa, o usuário e o horário ficarão registrados na auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
            Use esta ação apenas quando a produção já tiver sido confirmada por outro meio ou quando houver uma regularização operacional autorizada.
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="force-complete-reason" className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <ClipboardCheck className="h-4 w-4 text-rose-500" /> Justificativa obrigatória
            </label>
            <Textarea
              id="force-complete-reason"
              placeholder="Descreva de forma objetiva por que a ordem pode ser encerrada sem as coletas restantes."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              autoFocus
              required
              className="resize-none rounded-xl text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Nenhuma senha adicional é solicitada; a autorização é validada pelo papel do usuário já autenticado.</p>
          </div>

          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} disabled={isSubmitting} className="rounded-xl">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="rounded-xl bg-rose-600 font-bold text-white hover:bg-rose-700"
            >
              {isSubmitting ? 'Concluindo...' : 'Confirmar conclusão forçada'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

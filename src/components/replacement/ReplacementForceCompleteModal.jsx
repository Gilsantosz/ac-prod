import { useState } from 'react';
import { AlertTriangle, Lock, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { forceCompleteReplacement } from '@/lib/replacementService';
import { toast } from 'sonner';

export default function ReplacementForceCompleteModal({ order, open, onOpenChange, onSuccess }) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!order) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!reason.trim()) {
      setErrorMsg('A justificativa é obrigatória para a conclusão forçada.');
      return;
    }
    if (!password.trim()) {
      setErrorMsg('Informe sua senha de administrador para autorizar a ação.');
      return;
    }

    setIsSubmitting(true);
    try {
      await forceCompleteReplacement(order.id, { reason: reason.trim() });
      toast.success('Conclusão forçada registrada e auditada com sucesso.');
      onOpenChange(false);
      setReason('');
      setPassword('');
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Erro na conclusão forçada:', err);
      setErrorMsg(err.message || 'Falha ao forçar conclusão.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            Conclusão Forçada de Reposição (Apenas Admin)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Esta ação encerrará manualmente a ordem <strong>{order.replacement_code || order.id}</strong> sem a necessidade das leituras nas etapas restantes. Toda ação será registrada na auditoria do sistema.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {errorMsg && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 p-2.5 rounded-xl text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-bold text-muted-foreground">Justificativa Explicativa *</label>
            <Textarea
              placeholder="Descreva o motivo excepcional para a conclusão forçada (ex: perda de etiqueta, aprovação manual em marcenaria)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              className="text-xs rounded-xl"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-muted-foreground">Senha de Administrador *</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-10 rounded-xl"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !reason.trim() || !password.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl"
            >
              {isSubmitting ? 'Processando...' : 'Confirmar Conclusão Forçada'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

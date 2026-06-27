import { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, 
  DialogDescription, DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ShieldAlert } from 'lucide-react';

function formatHour(hour) {
  if (!hour) return '—';
  return String(hour).includes(':') ? hour : `${hour}:00`;
}

export default function EntryCorrectionDialog({
  open = false,
  onOpenChange = null,
  entry = null,
  user = {},
  onSubmit = null,
  loading = false
}) {
  const [actionType, setActionType] = useState('correct');
  const [reason, setReason] = useState('');

  const userRole = user.role || 'operator';
  const isAdmin = userRole === 'admin';
  const isManager = userRole === 'manager';
  const canDirectlyModify = isAdmin || isManager;

  // Atualizar tipo de ação sugerido dependendo de quem abre
  useEffect(() => {
    if (entry) {
      if (canDirectlyModify) {
        setActionType('correct');
      } else {
        // Operador comum solicita revisão
        setActionType('request_review');
      }
      setReason('');
    }
  }, [entry, open, canDirectlyModify]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reason.trim() || !onSubmit) return;

    onSubmit({
      entryId: entry.id,
      actionType,
      reason: reason.trim(),
      correctedBy: user.name || user.email || 'Operador',
      currentDateTime: new Date().toISOString()
    });
  };

  if (!entry) return null;
  const displayHour = formatHour(entry.hour);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <ShieldAlert className="w-5 h-5 text-sky-500 shrink-0" />
            Correção e Auditoria de Lançamento
          </DialogTitle>
          <DialogDescription className="text-xs">
            Corrigir, estornar ou cancelar lançamentos exige preenchimento de justificativa de auditoria.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          {/* Informações resumidas do registro */}
          <div className="bg-secondary/40 border border-border/50 rounded-xl p-3 text-xs font-mono">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
              <p className="min-w-0">Lote: <strong className="text-foreground break-all">{entry.lot_code || 'SEM_LOTE'}</strong></p>
              <p className="min-w-0">OP: <strong className="text-foreground break-all">{entry.order_number || 'MANUAL'}</strong></p>
              <p className="min-w-0">Data: <strong className="text-foreground break-words">{entry.date}</strong></p>
              <p className="min-w-0">Hora: <strong className="text-foreground break-words">{displayHour}</strong></p>
              <p className="min-w-0">Produzido: <strong className="text-emerald-600">+{entry.produced}</strong></p>
              <p className="min-w-0">Refugo: <strong className="text-red-500">-{entry.scrap || 0}</strong></p>
              <p className="min-w-0 sm:col-span-2">Parada: <strong className="text-amber-600">{entry.downtime || 0}m</strong></p>
            </div>
          </div>

          {/* Tipo de Ação */}
          <div className="grid gap-2 min-w-0">
            <Label htmlFor="correction-action-type" className="flex min-h-5 items-center text-xs font-bold leading-none text-muted-foreground">Tipo de Ação</Label>
            <select
              id="correction-action-type"
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium leading-none text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              required
            >
              {canDirectlyModify ? (
                <>
                  <option value="correct">Corrigir / Ajustar valores</option>
                  <option value="reverse">Estornar / Reverter lançamento</option>
                  <option value="cancel">Cancelar lançamento definitivamente</option>
                </>
              ) : (
                <option value="request_review">Solicitar revisão do lançamento (Líder/Gestor)</option>
              )}
            </select>
          </div>

          {/* Justificativa */}
          <div className="grid gap-2 min-w-0">
            <Label htmlFor="correction-reason" className="flex min-h-5 items-center text-xs font-bold leading-none text-muted-foreground">Justificativa / Motivo da Alteração</Label>
            <Textarea
              id="correction-reason"
              placeholder="Descreva o motivo desta correção operacional em detalhes..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="text-sm resize-none rounded-md"
              required
            />
          </div>

          {/* Informações do Auditor */}
          <div className="text-xs text-muted-foreground bg-secondary/20 p-2.5 rounded-lg">
            Responsável: <strong className="text-foreground">{user.name || user.email || '—'}</strong>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button 
              type="button" 
              variant="ghost" 
              size="sm"
              onClick={() => onOpenChange?.(false)}
              disabled={loading}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button 
              type="submit" 
              size="sm"
              disabled={loading || !reason.trim()}
              className="text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white border-0 shadow-sm"
            >
              {loading ? 'Processando...' : canDirectlyModify ? 'Aplicar Correção' : 'Enviar Solicitação'}
            </Button>
          </DialogFooter>

        </form>
      </DialogContent>
    </Dialog>
  );
}

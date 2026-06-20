import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function LowEfficiencyAlertModal({ open, alerts, onDismiss }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-foreground">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <span>Eficiência crítica detectada</span>
          </DialogTitle>
          <DialogDescription>
            Células abaixo do limite por 3 horas ou mais seguidas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            As células abaixo estão com eficiência inferior ao limite por 3 horas ou mais seguidas. Recomenda-se ação imediata.
          </p>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.cell} className="rounded-xl border border-border/70 bg-background/60 p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.cell}</span>
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive font-bold tabular-nums">{a.currentEff}%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {a.consecutive}h consecutivas abaixo de {a.threshold}% · horas: {a.hours.join(', ')}
                </p>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="border-t border-border/60 pt-4">
          <Button onClick={onDismiss}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

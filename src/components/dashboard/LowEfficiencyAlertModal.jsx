import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function LowEfficiencyAlertModal({ open, alerts, onDismiss }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Eficiência crítica detectada
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            As células abaixo estão com eficiência inferior ao limite por 3 horas ou mais seguidas. Recomenda-se ação imediata.
          </p>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.cell} className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.cell}</span>
                  <span className="text-destructive font-bold tabular-nums">{a.currentEff}%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {a.consecutive}h consecutivas abaixo de {a.threshold}% · horas: {a.hours.join(', ')}
                </p>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
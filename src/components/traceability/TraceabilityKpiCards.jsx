import { Ban, CheckCircle2, ScanLine, XCircle } from 'lucide-react';

export default function TraceabilityKpiCards({ kpis = {} }) {
  const unit = kpis.metric_unit_label || kpis.unitLabel || '';
  const items = [
    { key: 'total', label: unit ? `Total (${unit})` : 'Leituras hoje', icon: ScanLine, color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/25' },
    { key: 'approved', label: unit ? `Aprovadas (${unit})` : 'Aprovadas', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/25' },
    { key: 'rejected', label: unit ? `Reprovadas (${unit})` : 'Reprovadas', icon: XCircle, color: 'text-red-600 bg-red-50 dark:bg-red-950/25' },
    { key: 'blocked', label: 'Bloqueadas', icon: Ban, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/25' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(({ key, label, icon: Icon, color }) => (
        <div key={key} className="bg-card border border-border rounded-md p-4 flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${color}`}><Icon className="w-5 h-5" /></div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">{kpis[key] || 0}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

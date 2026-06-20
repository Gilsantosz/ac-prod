import { Box, CalendarClock, Package, UserRound } from 'lucide-react';

export default function LotProgressCard({ lot, item, tagValue }) {
  if (!lot || !item) {
    return (
      <div className="border border-dashed border-border rounded-md p-8 text-center text-muted-foreground">
        Leia uma identificação para exibir lote e peça.
      </div>
    );
  }

  const progress = Math.max(0, Math.min(100, Number(lot.progress_percent) || 0));
  return (
    <div className="bg-card border border-border rounded-md p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase font-semibold text-muted-foreground [letter-spacing:0]">Lote localizado</p>
          <h3 className="text-lg font-bold text-foreground mt-1">{lot.lot_code}</h3>
        </div>
        <span className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">{lot.current_status || lot.status}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info icon={Package} label="Pedido/OP" value={lot.order_number || '—'} />
        <Info icon={UserRound} label="Cliente" value={lot.customer_name || '—'} />
        <Info icon={Box} label="Peça" value={item.product_name || item.item_code} />
        <Info icon={CalendarClock} label="Tag" value={tagValue || '—'} mono />
      </div>

      <div>
        <div className="flex justify-between text-xs mb-1.5"><span className="text-muted-foreground">Progresso do lote</span><strong>{progress.toLocaleString('pt-BR')}%</strong></div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-[#2d9c4a] transition-[width]" style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex gap-2 min-w-0">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`font-medium truncate ${mono ? 'font-mono' : ''}`}>{value}</p></div>
    </div>
  );
}

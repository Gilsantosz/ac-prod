import { Ban, CheckCircle2, Clock3, Copy, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS = {
  approved: { icon: CheckCircle2, label: 'Aprovada', color: 'text-emerald-600' },
  rejected: { icon: XCircle, label: 'Reprovada', color: 'text-red-600' },
  duplicated: { icon: Copy, label: 'Duplicada', color: 'text-amber-600' },
  blocked: { icon: Ban, label: 'Bloqueada', color: 'text-red-600' },
  pending_review: { icon: Clock3, label: 'Em análise', color: 'text-sky-600' },
};

export default function LastReadingsList({ readings = [], loading }) {
  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border"><h3 className="font-semibold">Últimas leituras</h3></div>
      <div className="max-h-[360px] overflow-y-auto divide-y divide-border">
        {loading && <p className="p-5 text-sm text-muted-foreground">Atualizando leituras...</p>}
        {!loading && !readings.length && <p className="p-5 text-sm text-muted-foreground">Nenhuma leitura registrada.</p>}
        {readings.map((reading) => {
          const config = STATUS[reading.status] || STATUS.pending_review;
          const Icon = config.icon;
          return (
            <div key={reading.id} className="px-4 py-3 flex items-center gap-3">
              <Icon className={cn('w-5 h-5 shrink-0', config.color)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold font-mono truncate">{reading.tag_value}</p>
                <p className="text-xs text-muted-foreground truncate">{reading.step_name || '—'} · {reading.cell_name || '—'} · {reading.operator || '—'}</p>
              </div>
              <div className="text-right shrink-0"><p className={cn('text-xs font-semibold', config.color)}>{config.label}</p><p className="text-[11px] text-muted-foreground">{new Date(reading.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

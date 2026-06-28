import { Ban, CheckCircle2, Clock3, Copy, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUS = {
  approved:       { icon: CheckCircle2, label: 'Aprovada',   color: 'text-emerald-600' },
  rejected:       { icon: XCircle,      label: 'Reprovada',  color: 'text-red-600' },
  duplicated:     { icon: Copy,         label: 'Duplicada',  color: 'text-amber-600' },
  blocked:        { icon: Ban,          label: 'Bloqueada',  color: 'text-red-600' },
  pending_review: { icon: Clock3,       label: 'Em análise', color: 'text-sky-600' },
};

/**
 * LastReadingsList
 *
 * Lista das últimas leituras com botão de ocorrência por leitura.
 * @param {function} onOccurrence — (reading) => void — opcional
 */
export default function LastReadingsList({ readings = [], loading, onOccurrence }) {
  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold">Últimas leituras</h3>
        {readings.length > 0 && (
          <span className="text-xs text-muted-foreground">{readings.length} registros</span>
        )}
      </div>
      <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
        {loading && <p className="p-5 text-sm text-muted-foreground">Atualizando leituras...</p>}
        {!loading && !readings.length && <p className="p-5 text-sm text-muted-foreground">Nenhuma leitura registrada.</p>}
        {readings.map((reading) => (
          <ReadingRow
            key={reading.id}
            reading={reading}
            onOccurrence={onOccurrence}
          />
        ))}
      </div>
    </div>
  );
}

function ReadingRow({ reading, onOccurrence }) {
  const config = STATUS[reading.status] || STATUS.pending_review;
  const Icon = config.icon;
  const hasOccurrence = !!reading.occurrence_id;

  return (
    <div className="px-4 py-3 flex items-center gap-3 group">
      <Icon className={cn('w-5 h-5 shrink-0', config.color)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold font-mono truncate">{reading.tag_value}</p>
        <p className="text-xs text-muted-foreground truncate">
          {reading.step_name || '—'} · {reading.cell_name || '—'} · {reading.operator || '—'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Botão registrar ocorrência */}
        {onOccurrence && reading.status !== 'duplicated' && (
          <Button
            size="sm"
            variant={hasOccurrence ? 'secondary' : 'ghost'}
            className={cn(
              'h-7 px-2 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity',
              hasOccurrence && 'opacity-100 text-amber-600'
            )}
            title={hasOccurrence ? 'Ocorrência já registrada' : 'Registrar ocorrência nesta leitura'}
            onClick={() => onOccurrence(reading)}
          >
            <AlertTriangle className="w-3 h-3" />
            {hasOccurrence ? 'Ocorrência' : 'Ocorrência'}
          </Button>
        )}
        <div className="text-right">
          <p className={cn('text-xs font-semibold', config.color)}>{config.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {new Date(reading.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

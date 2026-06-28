import { RefreshCw, Wifi, WifiOff, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * CollectionQueuePanel
 *
 * Exibe o estado atual da fila de coleta local (IndexedDB):
 * pendentes, processando, sincronizados e com erro.
 * Botão de reprocessamento para supervisores.
 */
export default function CollectionQueuePanel({ stats, flushing, onRetry, online = true }) {
  const hasIssues = stats.error > 0 || stats.pending > 0;

  if (!hasIssues && stats.total === 0) return null; // não exibir quando fila está limpa e vazia

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm',
      stats.error > 0
        ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
        : stats.pending > 0
          ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
          : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
    )}>

      {/* Status online/offline */}
      <div className="flex items-center gap-1.5 shrink-0">
        {online
          ? <Wifi className="w-4 h-4 text-emerald-600" />
          : <WifiOff className="w-4 h-4 text-amber-600" />
        }
        <span className={cn('text-xs font-semibold', online ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Contadores */}
      <div className="flex flex-wrap gap-3">
        {stats.pending > 0 && (
          <Pill icon={Clock} label="Pendentes" count={stats.pending} color="text-amber-700 dark:text-amber-400" />
        )}
        {stats.processing > 0 && (
          <Pill icon={RefreshCw} label="Enviando" count={stats.processing} color="text-sky-700 dark:text-sky-400" spin />
        )}
        {stats.synced > 0 && (
          <Pill icon={CheckCircle2} label="Sincronizados" count={stats.synced} color="text-emerald-700 dark:text-emerald-400" />
        )}
        {stats.error > 0 && (
          <Pill icon={AlertTriangle} label="Com erro" count={stats.error} color="text-red-700 dark:text-red-400" />
        )}
      </div>

      {/* Botão reprocessar */}
      {(stats.error > 0 || (stats.pending > 0 && online)) && (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto gap-1.5 text-xs shrink-0 h-8"
          disabled={flushing}
          onClick={onRetry}
        >
          <RefreshCw className={cn('w-3 h-3', flushing && 'animate-spin')} />
          {flushing ? 'Sincronizando...' : 'Reprocessar'}
        </Button>
      )}
    </div>
  );
}

function Pill({ icon: Icon, label, count, color, spin }) {
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', color)}>
      <Icon className={cn('w-3.5 h-3.5', spin && 'animate-spin')} />
      {count} {label}
    </span>
  );
}

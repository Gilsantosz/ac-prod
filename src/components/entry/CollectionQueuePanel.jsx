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
  const hasIssues = stats.error > 0 || stats.pending > 0 || stats.hasStalePending || stats.hasSlowEnqueue;

  if (!hasIssues && stats.total === 0) return null; // não exibir quando fila está limpa e vazia

  return (
    <div className="flex flex-col gap-2 bg-card border border-border rounded-xl p-4">
      <div className={cn(
        'flex flex-wrap items-center gap-3 text-sm'
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

      {stats.hasStalePending && (
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg mt-1 animate-pulse">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span><strong>Fila lenta:</strong> Coleta local travada ou sem sincronização com o banco há mais de 60 segundos.</span>
        </div>
      )}

      {stats.hasSlowEnqueue && (
        <div className="flex items-center gap-2 text-xs text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg mt-1">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span><strong>Alerta do SLA:</strong> Tempo de gravação local ultrapassou a meta de 800 ms.</span>
        </div>
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

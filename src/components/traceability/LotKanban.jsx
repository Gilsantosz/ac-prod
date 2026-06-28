import { useState } from 'react';
import { KANBAN_STAGES, STAGE_NEXT } from '@/hooks/useTraceability';
import LotCard from './LotCard';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotKanban({ trace }) {
  const [expandedStages, setExpandedStages] = useState(
    Object.fromEntries(KANBAN_STAGES.map(s => [s.code, true]))
  );

  const toggleStage = (code) =>
    setExpandedStages(p => ({ ...p, [code]: !p[code] }));



  if (trace.lots.isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="h-64 bg-card border border-border/40 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (trace.lots.isError) {
    return (
      <div className="border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/20 rounded-xl p-5 text-sm text-red-700 dark:text-red-300">
        Não foi possível carregar o Kanban de rastreabilidade. Atualize a página ou tente novamente.
      </div>
    );
  }

  if (!trace.lots.data.length) {
    return (
      <div className="text-center py-12 text-muted-foreground border border-dashed border-border/40 rounded-xl">
        <p className="font-medium text-foreground">Nenhum lote no Kanban</p>
        <p className="text-sm mt-1">Os lotes importados aparecerão aqui após o processamento da integração.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-max">
        {KANBAN_STAGES.map(stage => {
          const stageLots = trace.lotsByStage[stage.code] || [];
          if (stageLots.length === 0 && stage.code !== 'released') return null;

          return (
            <div key={stage.code} className="w-72 shrink-0 space-y-2">
              {/* Header da coluna */}
              <button
                onClick={() => toggleStage(stage.code)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-xl',
                  stage.bg, 'hover:opacity-80 transition-opacity'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('font-semibold text-sm', stage.color)}>
                    {stage.label}
                  </span>
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    stageLots.length > 0 ? stage.color : 'text-muted-foreground',
                    'bg-white/50 dark:bg-black/20'
                  )}>
                    {stageLots.length}
                  </span>
                </div>
                <ChevronRight className={cn(
                  'w-4 h-4', stage.color,
                  'transition-transform', expandedStages[stage.code] ? 'rotate-90' : ''
                )} />
              </button>

              {/* Lotes da coluna */}
              {expandedStages[stage.code] && (
                <div className="space-y-2">
                  {stageLots.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-xs border border-dashed border-border/40 rounded-xl">
                      Nenhum lote
                    </div>
                  )}
                  {stageLots.map(lot => (
                    <LotCard
                      key={lot.id}
                      lot={lot}
                      stage={stage}
                      onAdvance={() => {
                        const next = STAGE_NEXT[stage.code];
                        if (next) trace.advanceLot.mutate({ lot, targetStage: next });
                      }}
                      onBlock={(reason) => trace.blockLot.mutate({ lotId: lot.id, reason })}
                      onUnblock={(notes) => trace.unblockLot.mutate({ lotId: lot.id, notes })}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

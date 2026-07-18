import { useState } from 'react';
import { KANBAN_STAGES, STAGE_NEXT } from '@/hooks/useTraceability';
import LotCard from './LotCard';
import { ChevronRight, Layers, User, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotKanban({ trace }) {
  const [expandedStages, setExpandedStages] = useState(
    Object.fromEntries(KANBAN_STAGES.map(s => [s.code, true]))
  );
  const [groupMode, setGroupMode] = useState('cover'); // 'none' | 'cover' | 'batch'

  const toggleStage = (code) =>
    setExpandedStages(p => ({ ...p, [code]: !p[code] }));

  // Agrupa os lotes de um estágio baseado no modo selecionado
  const getGroupedLotsForStage = (stageLots) => {
    if (groupMode === 'none') {
      return stageLots.map(lot => ({ type: 'lot', data: lot }));
    }

    const groups = {};
    stageLots.forEach(lot => {
      let key, name;
      if (groupMode === 'cover') {
        if (lot.customer_cover_id) {
          key = lot.customer_cover_id;
          name = lot.customer_name || 'Sem nome';
        } else {
          key = `nocover-${lot.customer_name || 'vazio'}`;
          name = lot.customer_name || 'Cliente não informado';
        }
      } else if (groupMode === 'batch') {
        key = lot.pcp_import_batch_id || 'nobatch';
        name = lot.pcp_import_batch?.general_lot_code || lot.lot_code || 'Sem lote geral';
      }

      if (!groups[key]) {
        groups[key] = {
          key,
          name,
          lots: [],
        };
      }
      groups[key].lots.push(lot);
    });

    const result = [];
    Object.values(groups).forEach(group => {
      result.push({
        type: 'header',
        key: `header-${group.key}`,
        name: group.name,
        count: group.lots.length,
      });
      group.lots.forEach(lot => {
        result.push({
          type: 'lot',
          key: lot.id,
          data: lot,
        });
      });
    });

    return result;
  };

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
    <div className="space-y-4">
      {/* Controles de agrupamento */}
      <div className="flex items-center justify-between bg-card border border-border/60 rounded-2xl p-3 shadow-sm flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-muted-foreground">Agrupar por:</span>
          <div className="flex bg-secondary/35 rounded-lg p-0.5">
            <button
              onClick={() => setGroupMode('none')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
                groupMode === 'none' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Layers className="w-3.5 h-3.5" /> Lista
            </button>
            <button
              onClick={() => setGroupMode('cover')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
                groupMode === 'cover' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <User className="w-3.5 h-3.5 text-purple-500" /> Capa / Cliente
            </button>
            <button
              onClick={() => setGroupMode('batch')}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
                groupMode === 'batch' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Package className="w-3.5 h-3.5 text-blue-500" /> Lote Geral (Carga)
            </button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground font-medium">
          Total de <span className="text-foreground font-bold">{trace.lots.data.length}</span> lotes listados
        </div>
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-max">
          {KANBAN_STAGES.map(stage => {
            const stageLots = trace.lotsByStage[stage.code] || [];
            if (stageLots.length === 0 && stage.code !== 'released') return null;

            const stageLotsGrouped = getGroupedLotsForStage(stageLots);

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
                    {stageLotsGrouped.map(item => {
                      if (item.type === 'header') {
                        const isCover = groupMode === 'cover';
                        return (
                          <div
                            key={item.key}
                            className={cn(
                              "flex items-center justify-between px-3 py-1.5 rounded-lg border text-[11px] font-semibold mt-3 first:mt-0 shadow-sm",
                              isCover 
                                ? "bg-purple-500/5 border-purple-500/20 text-purple-700 dark:text-purple-300"
                                : "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-300"
                            )}
                          >
                            <div className="flex items-center gap-1.5 truncate max-w-[80%]">
                              <span className={cn(
                                "text-[9px] font-bold uppercase px-1 py-0.5 rounded",
                                isCover 
                                  ? "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300" 
                                  : "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300"
                              )}>
                                {isCover ? 'Capa' : 'Geral'}
                              </span>
                              <span className="truncate" title={item.name}>{item.name}</span>
                            </div>
                            <span className="text-[10px] font-bold opacity-80 shrink-0">
                              {item.count} {item.count === 1 ? 'lote' : 'lotes'}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <LotCard
                          key={item.data.id}
                          lot={item.data}
                          stage={stage}
                          onAdvance={() => {
                            const next = STAGE_NEXT[stage.code];
                            if (next) trace.advanceLot.mutate({ lot: item.data, targetStage: next });
                          }}
                          onBlock={(reason) => trace.blockLot.mutate({ lotId: item.data.id, reason })}
                          onUnblock={(notes) => trace.unblockLot.mutate({ lotId: item.data.id, notes })}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

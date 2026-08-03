import { useState, useRef, useEffect, useCallback } from 'react';
import { KANBAN_STAGES, STAGE_NEXT } from '@/hooks/useTraceability';
import LotCard from './LotCard';
import { ChevronRight, ChevronLeft, Layers, User, Package, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotKanban({ trace }) {
  const [expandedStages, setExpandedStages] = useState(
    Object.fromEntries(KANBAN_STAGES.map(s => [s.code, true]))
  );
  const [groupMode, setGroupMode] = useState('cover'); // 'none' | 'cover' | 'batch'

  const kanbanRef = useRef(null);
  const stickyScrollRef = useRef(null);
  const isSyncingRef = useRef(false);
  const [scrollWidth, setScrollWidth] = useState(0);

  const updateScrollWidth = useCallback(() => {
    if (kanbanRef.current) {
      setScrollWidth(kanbanRef.current.scrollWidth);
    }
  }, []);

  useEffect(() => {
    updateScrollWidth();
    const timer = setTimeout(updateScrollWidth, 150);
    window.addEventListener('resize', updateScrollWidth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateScrollWidth);
    };
  }, [trace.lots.data, groupMode, expandedStages, updateScrollWidth]);

  const handleMainScroll = () => {
    if (isSyncingRef.current) return;
    if (kanbanRef.current && stickyScrollRef.current) {
      isSyncingRef.current = true;
      stickyScrollRef.current.scrollLeft = kanbanRef.current.scrollLeft;
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    }
  };

  const handleStickyScroll = () => {
    if (isSyncingRef.current) return;
    if (kanbanRef.current && stickyScrollRef.current) {
      isSyncingRef.current = true;
      kanbanRef.current.scrollLeft = stickyScrollRef.current.scrollLeft;
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    }
  };

  const scrollByAmount = (amount) => {
    if (kanbanRef.current) {
      kanbanRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  const scrollToStage = (stageCode) => {
    const stageEl = document.getElementById(`kanban-stage-${stageCode}`);
    if (stageEl && kanbanRef.current) {
      stageEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  };

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
    <div className="space-y-4 relative">
      {/* Controles de agrupamento */}
      <div className="flex items-center justify-between bg-card border border-border/60 rounded-2xl p-3.5 shadow-sm flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-muted-foreground">Agrupar por:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGroupMode('none')}
              className={cn(
                "px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all flex items-center gap-2 select-none",
                groupMode === 'none'
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 shadow-sm"
                  : "bg-background text-muted-foreground border-border/60 hover:text-foreground hover:border-border"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", groupMode === 'none' ? "bg-emerald-500" : "bg-muted-foreground/30")} />
              <Layers className="w-3.5 h-3.5" /> Lista
            </button>

            <button
              onClick={() => setGroupMode('cover')}
              className={cn(
                "px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all flex items-center gap-2 select-none",
                groupMode === 'cover'
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 shadow-sm"
                  : "bg-background text-muted-foreground border-border/60 hover:text-foreground hover:border-border"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", groupMode === 'cover' ? "bg-emerald-500" : "bg-muted-foreground/30")} />
              <User className="w-3.5 h-3.5 text-purple-500" /> Capa / Cliente
            </button>

            <button
              onClick={() => setGroupMode('batch')}
              className={cn(
                "px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all flex items-center gap-2 select-none",
                groupMode === 'batch'
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 shadow-sm"
                  : "bg-background text-muted-foreground border-border/60 hover:text-foreground hover:border-border"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", groupMode === 'batch' ? "bg-emerald-500" : "bg-muted-foreground/30")} />
              <Package className="w-3.5 h-3.5 text-blue-500" /> Lote Geral (Carga)
            </button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground font-semibold">
          Total de <span className="text-foreground font-bold">{trace.lots.data.length}</span> lotes listados
        </div>
      </div>

      {/* Container principal do Kanban com scroll horizontal */}
      <div
        ref={kanbanRef}
        onScroll={handleMainScroll}
        className="overflow-x-auto pb-6 pt-1 custom-horizontal-scrollbar scroll-smooth"
      >
        <div className="flex gap-4 min-w-max">
          {KANBAN_STAGES.map(stage => {
            const stageLots = trace.lotsByStage[stage.code] || [];
            if (stageLots.length === 0 && stage.code !== 'released' && stage.code !== 'imported' && stage.code !== 'separation') return null;

            const stageLotsGrouped = getGroupedLotsForStage(stageLots);

            return (
              <div
                key={stage.code}
                id={`kanban-stage-${stage.code}`}
                className="w-80 shrink-0 space-y-3"
              >
                {/* Header da coluna */}
                <div
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2.5 rounded-2xl border shadow-sm',
                    stage.bg, 'border-border/40'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn('font-bold text-sm', stage.color)}>
                      {stage.label}
                    </span>
                    <span className={cn(
                      'text-xs font-extrabold px-2 py-0.5 rounded-full',
                      stageLots.length > 0 ? stage.color : 'text-muted-foreground',
                      'bg-background/80 shadow-xs'
                    )}>
                      {stageLots.length}
                    </span>
                  </div>
                  
                  <button
                    onClick={() => toggleStage(stage.code)}
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/50 transition-colors"
                    title={expandedStages[stage.code] ? "Recolher coluna" : "Expandir coluna"}
                  >
                    <ChevronRight className={cn(
                      'w-4 h-4', stage.color,
                      'transition-transform', expandedStages[stage.code] ? 'rotate-90' : ''
                    )} />
                  </button>
                </div>

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

      {/* ── Barra de Rolagem Horizontal FIXA no rodapé da tela ──────── */}
      <div className="sticky bottom-4 z-40 w-full bg-card/95 backdrop-blur-md border border-border/80 rounded-2xl p-3 shadow-2xl space-y-2 mt-4 transition-all">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-[80%]">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1 select-none">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" /> Atalhos de Etapa:
            </span>
            {KANBAN_STAGES.map(stage => {
              const stageLots = trace.lotsByStage[stage.code] || [];
              return (
                <button
                  key={`nav-${stage.code}`}
                  onClick={() => scrollToStage(stage.code)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-bold rounded-lg shrink-0 border transition-all flex items-center gap-1.5 select-none",
                    stage.bg, stage.color, "border-border/40 hover:scale-105 active:scale-95 shadow-xs"
                  )}
                >
                  <span>{stage.label}</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-background/80 font-extrabold">
                    {stageLots.length}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => scrollByAmount(-340)}
              className="p-2 rounded-xl bg-secondary/80 hover:bg-secondary text-foreground border border-border/60 transition-all active:scale-90 shadow-xs"
              title="Rolar para esquerda"
              aria-label="Rolar para esquerda"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => scrollByAmount(340)}
              className="p-2 rounded-xl bg-secondary/80 hover:bg-secondary text-foreground border border-border/60 transition-all active:scale-90 shadow-xs"
              title="Rolar para direita"
              aria-label="Rolar para direita"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Trilho de rolagem horizontal fixo e sincronizado */}
        <div
          ref={stickyScrollRef}
          onScroll={handleStickyScroll}
          className="w-full overflow-x-auto custom-horizontal-scrollbar py-1"
        >
          <div style={{ width: `${Math.max(scrollWidth, 1000)}px`, height: '2px' }} />
        </div>
      </div>
    </div>
  );
}


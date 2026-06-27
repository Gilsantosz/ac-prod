import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { KANBAN_STAGES } from '@/hooks/useTraceability';
import { cn } from '@/lib/utils';
import {
  GitBranch, Clock, User, Package,
  CheckCircle, XCircle, AlertCircle, ArrowRightLeft,
  Play, Square, RefreshCw,
} from 'lucide-react';

const EVENT_ICONS = {
  start:    { icon: Play,          color: 'text-blue-500',   bg: 'bg-blue-100 dark:bg-blue-900/30' },
  finish:   { icon: CheckCircle,   color: 'text-green-500',  bg: 'bg-green-100 dark:bg-green-900/30' },
  pause:    { icon: Square,        color: 'text-amber-500',  bg: 'bg-amber-100 dark:bg-amber-900/30' },
  block:    { icon: AlertCircle,   color: 'text-red-500',    bg: 'bg-red-100 dark:bg-red-900/30' },
  unblock:  { icon: CheckCircle,   color: 'text-emerald-500',bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  rework:   { icon: RefreshCw,     color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  scrap:    { icon: XCircle,       color: 'text-red-600',    bg: 'bg-red-100 dark:bg-red-900/30' },
  transfer: { icon: ArrowRightLeft,color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  note:     { icon: GitBranch,     color: 'text-slate-500',  bg: 'bg-slate-100 dark:bg-slate-800' },
};

export default function LotTimeline({ trace }) {
  const [selectedLotId, setSelectedLotId] = useState(null);

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['lot-events', selectedLotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lot_step_events')
        .select('*, profiles(name, role)')
        .eq('lot_id', selectedLotId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedLotId,
    initialData: [],
  });

  const selectedLot = trace.lots.data.find(l => l.id === selectedLotId);
  const stageInfo = (code) => KANBAN_STAGES.find(s => s.code === code);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lista de lotes ───────────────────────────────────── */}
      <div className="lg:col-span-1 space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Selecionar Lote
        </h3>
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {trace.lots.data.map(lot => {
            const s = stageInfo(lot.current_stage);
            return (
              <button
                key={lot.id}
                onClick={() => setSelectedLotId(lot.id)}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-xl border transition-all duration-150',
                  selectedLotId === lot.id
                    ? 'border-[#76FB91]/60 bg-[#76FB91]/5 shadow-sm'
                    : 'border-border/50 bg-card hover:border-border/80 hover:bg-secondary/30'
                )}
              >
                <p className="font-semibold text-sm text-foreground">{lot.lot_code}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {lot.production_orders?.customer_name}
                </p>
                <span className={cn('text-xs font-medium', s?.color)}>{s?.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Timeline ─────────────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-3">
        {!selectedLotId ? (
          <div className="text-center py-20 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <GitBranch className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium text-foreground">Selecione um lote para ver o histórico</p>
            <p className="text-sm mt-1">O histórico mostra todos os eventos e movimentações do lote</p>
          </div>
        ) : (
          <>
            {selectedLot && (
              <div className="bg-card border border-border/60 rounded-2xl p-4 mb-2">
                <p className="font-bold text-foreground">{selectedLot.lot_code}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedLot.production_orders?.customer_name} · {selectedLot.production_orders?.order_code}
                </p>
              </div>
            )}

            {eventsLoading ? (
              <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Carregando histórico…
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <GitBranch className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum evento registrado para este lote</p>
              </div>
            ) : (
              <div className="relative space-y-0 pl-6">
                {/* Linha vertical */}
                <div className="absolute left-3 top-2 bottom-2 w-px bg-border/60" />

                {events.map((event) => {
                  const config = EVENT_ICONS[event.event_type] || EVENT_ICONS.note;
                  const Icon = config.icon;
                  const stageName = stageInfo(event.step_code)?.label || event.step_code;

                  return (
                    <div key={event.id} className="relative flex gap-3 pb-4">
                      {/* Ícone do evento */}
                      <div className={cn(
                        'absolute -left-3 w-6 h-6 rounded-full flex items-center justify-center border-2 border-background shrink-0',
                        config.bg
                      )}>
                        <Icon className={cn('w-3 h-3', config.color)} />
                      </div>

                      {/* Conteúdo */}
                      <div className="bg-card border border-border/50 rounded-xl p-3 flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{stageName}</p>
                          <span className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
                            config.bg, config.color
                          )}>
                            {event.event_type}
                          </span>
                        </div>
                        {event.notes && (
                          <p className="text-xs text-muted-foreground">{event.notes}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(event.created_at).toLocaleString('pt-BR')}
                          </span>
                          {event.profiles?.name && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {event.profiles.name}
                            </span>
                          )}
                          {event.quantity > 0 && (
                            <span className="flex items-center gap-1">
                              <Package className="w-3 h-3" />
                              {event.quantity} pç
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

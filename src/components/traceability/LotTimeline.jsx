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

const READING_STATUS_CONFIG = {
  approved:       { label: 'Aprovada',   color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  rejected:       { label: 'Reprovada',  color: 'text-red-600',     bg: 'bg-red-50 dark:bg-red-900/20' },
  duplicated:     { label: 'Duplicada',  color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-900/20' },
  blocked:        { label: 'Bloqueada',  color: 'text-red-600',     bg: 'bg-red-50 dark:bg-red-900/20' },
  pending_review: { label: 'Em análise', color: 'text-sky-600',     bg: 'bg-sky-50 dark:bg-sky-900/20' },
};

export default function LotTimeline({ trace }) {
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [showAllReadings, setShowAllReadings] = useState(false);

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

  // Busca TODAS as leituras do lote diretamente — sem depender do join do useTraceability
  const { data: lotReadings = [], isLoading: readingsLoading } = useQuery({
    queryKey: ['lot-readings', selectedLotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_stage_readings')
        .select('*')
        .eq('lot_id', selectedLotId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedLotId,
    staleTime: 0,
    initialData: [],
  });

  const selectedLot = trace.lots.data.find(l => l.id === selectedLotId);
  const stageInfo = (code) => KANBAN_STAGES.find(s => s.code === code);
  const readingEvents = lotReadings.map((reading) => ({
    id: `reading-${reading.id}`,
    step_code: reading.step_name,
    event_type: reading.status === 'approved' ? 'finish' : reading.status === 'rejected' ? 'scrap' : 'note',
    notes: `${reading.status === 'approved' ? 'Baixa registrada' : 'Leitura registrada'} · ${reading.tag_value || 'sem tag'}`,
    quantity: Number(reading.quantity) || 1,
    created_at: reading.created_at,
    operator: reading.operator,
    source: 'reading',
  }));
  const combinedEvents = [...events, ...readingEvents]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Leituras a exibir no painel de coleta (limite 30 se não expandido)
  const visibleReadings = showAllReadings ? lotReadings : lotReadings.slice(0, 30);

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
                onClick={() => { setSelectedLotId(lot.id); setShowAllReadings(false); }}
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

      {/* ── Timeline + Painel de Coleta ───────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {!selectedLotId ? (
          <div className="text-center py-20 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <GitBranch className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium text-foreground">Selecione um lote para ver o histórico</p>
            <p className="text-sm mt-1">O histórico mostra todos os eventos e movimentações do lote</p>
          </div>
        ) : (
          <>
            {selectedLot && (
              <div className="bg-card border border-border/60 rounded-2xl p-4">
                <p className="font-bold text-foreground">{selectedLot.lot_code}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedLot.production_orders?.customer_name} · {selectedLot.production_orders?.order_code}
                </p>
              </div>
            )}

            {/* ── Painel completo de coleta ─────────────────── */}
            <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <h4 className="font-semibold text-sm">Histórico de Coleta</h4>
                  {lotReadings.length > 0 && (
                    <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                      {lotReadings.length} leituras
                    </span>
                  )}
                </div>
                {readingsLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>

              {readingsLoading ? (
                <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Carregando coletas…
                </div>
              ) : lotReadings.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground text-center">Nenhuma coleta registrada para este lote.</p>
              ) : (
                <div className="max-h-[45vh] overflow-y-auto divide-y divide-border/50">
                  {visibleReadings.map((r) => {
                    const sc = READING_STATUS_CONFIG[r.status] || READING_STATUS_CONFIG.pending_review;
                    return (
                      <div key={r.id} className="px-4 py-3 flex items-center gap-3 hover:bg-secondary/20 transition-colors">
                        <div className={cn('w-2 h-2 rounded-full shrink-0', r.status === 'approved' ? 'bg-emerald-500' : r.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500')} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-mono font-semibold truncate">{r.tag_value || '—'}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {r.step_name || '—'} · {r.cell_name || '—'} · {r.operator || '—'}
                            {r.machine_name ? ` · ${r.machine_name}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded-full', sc.bg, sc.color)}>
                            {sc.label}
                          </span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {new Date(r.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {!showAllReadings && lotReadings.length > 30 && (
                    <button
                      onClick={() => setShowAllReadings(true)}
                      className="w-full py-3 text-xs text-center text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
                    >
                      Exibir todas as {lotReadings.length} leituras ↓
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Timeline de Eventos ───────────────────────── */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">Linha do Tempo de Eventos</h4>
              {eventsLoading ? (
                <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Carregando eventos…
                </div>
              ) : combinedEvents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GitBranch className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nenhum evento de status registrado para este lote</p>
                </div>
              ) : (
                <div className="relative space-y-0 pl-6">
                  {/* Linha vertical */}
                  <div className="absolute left-3 top-2 bottom-2 w-px bg-border/60" />

                  {combinedEvents.map((event) => {
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
                            {(event.profiles?.name || event.operator) && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" />
                                {event.profiles?.name || event.operator}
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KANBAN_STAGES } from '@/hooks/useTraceability';
import { fetchTraceabilityBoardLots } from '@/lib/productionHistoryService';
import { Search, RefreshCw, Layers, CheckCircle2, MapPin, Route } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [timer, setTimer] = useState(null);

  const updateQuery = (value) => {
    setQuery(value);
    clearTimeout(timer);
    setTimer(setTimeout(() => setDebouncedQuery(value), 350));
  };

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['trace-search', debouncedQuery],
    queryFn: () => fetchTraceabilityBoardLots({ searchQuery: debouncedQuery, limit: 500 }),
    enabled: debouncedQuery.trim().length >= 2,
    initialData: [],
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Buscar por lote, pedido, cliente, peça, código de barras ou tag..."
          className="w-full pl-10 pr-4 h-10 rounded-xl border border-border/60 bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#76FB91]/40 focus:border-[#76FB91]/60"
        />
        {isLoading && (
          <RefreshCw className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {results.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {results.map((lot) => (
            <SearchResult key={lot.id} lot={lot} />
          ))}
        </div>
      )}

      {debouncedQuery.length >= 2 && !isLoading && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>Nenhum resultado encontrado para <strong>"{debouncedQuery}"</strong></p>
          <p className="text-xs mt-1">Tente buscar por lote, pedido, cliente, peça ou tag.</p>
        </div>
      )}

      {debouncedQuery.length < 2 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Digite pelo menos 2 caracteres para buscar.</p>
          <p className="text-xs mt-1">A busca usa lote, pedido, cliente, peça, código de barras e tag.</p>
        </div>
      )}
    </div>
  );
}

function SearchResult({ lot }) {
  const stage = KANBAN_STAGES.find((item) => item.code === lot.current_stage);
  const progress = lot.traceability_progress || {};
  const routeProgress = lot.route_progress || [];
  const order = lot.production_orders || {};
  const total = Number(progress.total || 0);
  const collected = Number(progress.completed || 0);
  const pending = Number(progress.pending || 0);
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', stage?.bg || 'bg-secondary/50')}>
          <Layers className={cn('w-4 h-4', stage?.color || 'text-muted-foreground')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-foreground break-words">{lot.lot_code}</p>
          <p className="text-xs text-muted-foreground break-words">
            {order.customer_trade_name || order.customer_name || 'Cliente não informado'} · {order.order_number || order.order_code || lot.order_number || 'Pedido não informado'}
          </p>
          <p className={cn('text-xs font-medium mt-1', stage?.color)}>{stage?.label || lot.current_stage}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Total" value={total} />
        <Metric label="Coletadas" value={collected} color="text-emerald-600" />
        <Metric label="Faltam" value={pending} color="text-amber-600" />
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{percent}% completo</span>
          <span>{collected}/{total}</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-[#2d9c4a]" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 min-w-0">
          <Route className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{lot.current_step || 'Sem etapa atual'}</span>
        </span>
        <span className="flex items-center gap-1 min-w-0">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{lot.current_cell || 'Sem célula definida'}</span>
        </span>
      </div>

      {routeProgress.length > 0 && (
        <div className="border-t border-border/60 pt-2 space-y-1">
          {routeProgress.map((step) => (
            <div key={step.id || `${step.step_order}-${step.step_name}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{step.step_name}</span>
              <span className={cn('font-semibold shrink-0', step.pending === 0 ? 'text-emerald-600' : step.collected > 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                {step.pending === 0 && <CheckCircle2 className="inline w-3 h-3 mr-1" />}
                {step.collected}/{step.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color = 'text-foreground' }) {
  return (
    <div className="rounded-lg bg-secondary/50 px-2 py-2">
      <p className={cn('text-base font-bold leading-none', color)}>{Number(value) || 0}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

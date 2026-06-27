import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { KANBAN_STAGES } from '@/hooks/useTraceability';
import { Search, RefreshCw, FileText, Layers, QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LotSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [timer, setTimer] = useState(null);

  const updateQuery = (val) => {
    setQuery(val);
    clearTimeout(timer);
    setTimer(setTimeout(() => setDebouncedQuery(val), 400));
  };

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['trace-search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return [];

      const [lots, pieces, orders] = await Promise.all([
        supabase
          .from('production_lots')
          .select('*, production_orders(order_code, customer_name, delivery_date)')
          .ilike('lot_code', `%${debouncedQuery}%`)
          .limit(10),
        supabase
          .from('piece_instances')
          .select('*, lot_items(piece_name, lot_id, production_lots(lot_code, current_stage))')
          .or(`qr_code.ilike.%${debouncedQuery}%,serial_code.ilike.%${debouncedQuery}%`)
          .limit(10),
        supabase
          .from('production_orders')
          .select('*, production_lots(id, lot_code, current_stage, status)')
          .or(`order_code.ilike.%${debouncedQuery}%,customer_name.ilike.%${debouncedQuery}%`)
          .limit(10),
      ]);

      return [
        ...(lots.data || []).map(l => ({ type: 'lot', data: l })),
        ...(pieces.data || []).map(p => ({ type: 'piece', data: p })),
        ...(orders.data || []).map(o => ({ type: 'order', data: o })),
      ];
    },
    enabled: debouncedQuery.length >= 2,
    initialData: [],
  });

  const stageInfo = (code) => KANBAN_STAGES.find(s => s.code === code);

  return (
    <div className="space-y-5 max-w-2xl">
      {/* ── Campo de busca ───────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={query}
          onChange={e => updateQuery(e.target.value)}
          placeholder="Buscar por lote, pedido, cliente, QR code, serial…"
          className="w-full pl-10 pr-4 h-10 rounded-xl border border-border/60 bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#76FB91]/40 focus:border-[#76FB91]/60"
        />
        {isLoading && (
          <RefreshCw className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* ── Resultados ──────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((result, idx) => {
            const { type, data } = result;

            if (type === 'lot') {
              const s = stageInfo(data.current_stage);
              return (
                <div key={idx} className="bg-card border border-border/60 rounded-xl p-4 flex items-start gap-3">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s?.bg)}>
                    <Layers className={cn('w-4 h-4', s?.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground">{data.lot_code}</p>
                    <p className="text-xs text-muted-foreground">
                      Lote · {data.production_orders?.customer_name} · {data.production_orders?.order_code}
                    </p>
                    <p className={cn('text-xs font-medium mt-1', s?.color)}>{s?.label}</p>
                  </div>
                </div>
              );
            }

            if (type === 'piece') {
              const lotData = data.lot_items?.production_lots;
              const s = stageInfo(lotData?.current_stage);
              return (
                <div key={idx} className="bg-card border border-border/60 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-secondary/40">
                    <QrCode className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground">{data.lot_items?.piece_name || data.qr_code}</p>
                    <p className="text-xs text-muted-foreground">
                      Peça · QR: {data.qr_code} · Lote: {lotData?.lot_code}
                    </p>
                    <p className={cn('text-xs font-medium mt-1', s?.color)}>{s?.label}</p>
                  </div>
                </div>
              );
            }

            if (type === 'order') {
              return (
                <div key={idx} className="bg-card border border-border/60 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-secondary/40">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground">{data.order_code}</p>
                    <p className="text-xs text-muted-foreground">
                      Pedido · {data.customer_name} · {data.production_lots?.length || 0} lotes
                    </p>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}

      {debouncedQuery.length >= 2 && !isLoading && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>Nenhum resultado encontrado para <strong>"{debouncedQuery}"</strong></p>
          <p className="text-xs mt-1">Tente buscar por lote, pedido, cliente ou QR code</p>
        </div>
      )}

      {debouncedQuery.length < 2 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Digite pelo menos 2 caracteres para buscar</p>
          <p className="text-xs mt-1">Busque por número do lote, código do pedido, cliente ou QR code da peça</p>
        </div>
      )}
    </div>
  );
}

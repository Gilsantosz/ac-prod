import { useEffect, useState } from 'react';
import { Box, Building2, CalendarClock, CheckCircle2, Package, User2, XCircle } from 'lucide-react';
import { fetchCollectionContextSummary } from '@/lib/productionHistoryService';

/**
 * CollectionContextSummary
 *
 * Exibe lote + pedido com contagens reais de aprovadas, reprovadas, faltantes
 * e barra de progresso. Atualiza sempre que lotId ou orderId muda.
 */
export default function CollectionContextSummary({ feedback }) {
  const lotId = feedback?.lot?.id || null;
  const orderId = feedback?.productionContext?.productionOrder?.id || null;
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lotId && !orderId) { setSummary(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchCollectionContextSummary(lotId, orderId)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lotId, orderId]);

  // Estado vazio
  if (!feedback?.lot && !summary) {
    return (
      <div className="border border-dashed border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
        Leia uma identificação para exibir lote e pedido.
      </div>
    );
  }

  const lot = summary?.lot || feedback?.lot || null;
  const order = summary?.order || feedback?.productionContext?.productionOrder || null;

  const planned = Number(lot?.planned_quantity || 0);
  const approved = Number(lot?.approved_quantity || 0);
  const rejected = Number(lot?.rejected_quantity || 0);
  const pending = Math.max(0, planned - approved);
  const progress = planned > 0 ? Math.min(100, Math.round((approved / planned) * 100)) : 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Lote localizado</p>
          <h3 className="text-lg font-bold text-foreground mt-0.5 font-mono">
            {lot?.lot_code || '—'}
          </h3>
        </div>
        <span className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400 text-xs font-semibold shrink-0">
          {lot?.current_status || '—'}
        </span>
      </div>

      {/* Infos textuais */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info icon={Package} label="Pedido / OP" value={order?.order_number || '—'} />
        <Info icon={User2} label="Cliente" value={order?.customer_trade_name || order?.customer_legal_name || '—'} />
        <Info icon={Box} label="Produto" value={lot?.product_name || lot?.product_code || '—'} />
        <Info icon={Building2} label="Etapa atual" value={lot?.current_step || '—'} />
        {order?.finalization_date && (
          <Info icon={CalendarClock} label="Entrega" value={new Date(order.finalization_date).toLocaleDateString('pt-BR')} />
        )}
        {order?.load_number && (
          <Info icon={Package} label="Carga" value={order.load_number} />
        )}
      </div>

      {/* Barra de progresso + contagens */}
      {planned > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Progresso do lote</span>
            <strong>{progress}%</strong>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2d9c4a] transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Counters */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Counter label="Aprovadas" value={approved} color="text-emerald-600" icon={CheckCircle2} />
            <Counter label="Reprovadas" value={rejected} color="text-red-600" icon={XCircle} />
            <Counter label="Faltantes" value={pending} color="text-amber-600" />
          </div>
        </div>
      )}

      {loading && (
        <p className="text-xs text-muted-foreground animate-pulse">Atualizando contagens...</p>
      )}
    </div>
  );
}

function Info({ icon: Icon, label, value }) {
  return (
    <div className="flex gap-2 min-w-0">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium truncate text-sm">{value}</p>
      </div>
    </div>
  );
}

function Counter({ label, value, color, icon: Icon }) {
  return (
    <div className={`text-center rounded-lg bg-secondary/60 py-2 px-1 ${color}`}>
      <p className="text-base font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}

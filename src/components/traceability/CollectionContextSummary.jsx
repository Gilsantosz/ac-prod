import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ClipboardList,
  Layers3,
  Loader2,
  MapPin,
  Package,
  Route,
  Truck,
  User2,
  XCircle,
} from 'lucide-react';
import { fetchCollectionContextSummary } from '@/lib/productionHistoryService';

export default function CollectionContextSummary({ feedback, refreshToken }) {
  const lotId = feedback?.lot?.id || feedback?.productionContext?.lot?.id || null;
  const orderId = feedback?.productionContext?.productionOrder?.id
    || feedback?.lot?.production_order_id
    || feedback?.lot?.order_id
    || null;
  const readingToken = feedback?.reading?.id || feedback?.client_event_id || null;
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lotId && !orderId) {
      setSummary(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetchCollectionContextSummary(lotId, orderId)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lotId, orderId, readingToken, refreshToken]);

  const lot = summary?.lot || feedback?.lot || feedback?.productionContext?.lot || null;
  const order = summary?.order || feedback?.productionContext?.productionOrder || null;
  const item = feedback?.item || feedback?.productionContext?.item || null;
  const lotProgress = summary?.lotProgress || buildFallbackProgress(lot);
  const orderProgress = summary?.orderProgress || buildFallbackProgress(order);
  const missingPieces = summary?.missingPieces || [];
  const orderMissingPieces = summary?.orderMissingPieces || [];
  const showOrderMissing = orderProgress.total > lotProgress.total || hasDifferentLots(orderMissingPieces, lot?.id);

  const infoItems = useMemo(() => [
    { icon: Package, label: 'Pedido / OP', value: orderNumber(order) },
    { icon: Truck, label: 'Carga', value: firstText(order?.load_number, feedback?.productionContext?.load_number) },
    { icon: ClipboardList, label: 'Lote', value: lot?.lot_code },
    { icon: Layers3, label: 'Peça lida', value: firstText(item?.item_code, item?.piece_code, item?.product_code) },
    { icon: User2, label: 'Cliente', value: firstText(order?.customer_trade_name, order?.customer_legal_name, order?.customer_name) },
    { icon: Box, label: 'Produto', value: firstText(item?.product_name, lot?.product_name, lot?.product_code) },
    { icon: Route, label: 'Etapa da leitura', value: firstText(feedback?.route?.step_name, item?.current_step, lot?.current_step, lot?.current_stage) },
    { icon: MapPin, label: 'Célula da leitura', value: firstText(feedback?.route?.cell_name, item?.current_cell, lot?.current_cell) },
  ], [feedback?.productionContext?.load_number, feedback?.route?.cell_name, feedback?.route?.step_name, item, lot, order]);

  if (!lot && !summary) {
    return (
      <div className="border border-dashed border-border rounded-md p-8 text-center text-muted-foreground text-sm">
        Leia uma identificação para exibir lote, pedido e peças faltantes.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase font-semibold tracking-wider text-muted-foreground">Coleta em andamento</p>
          <h3 className="text-lg font-bold text-foreground mt-0.5 break-words">
            {lot?.lot_code || orderNumber(order) || 'Contexto não identificado'}
          </h3>
        </div>
        <StatusBadge status={lot?.current_status || lot?.status || feedback?.status} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        {infoItems.map((info) => (
          <Info key={info.label} icon={info.icon} label={info.label} value={info.value} />
        ))}
      </div>

      <ProgressBlock title="Lote" progress={lotProgress} />
      <ProgressBlock title="Pedido" progress={orderProgress} />

      <MissingPieces
        title="Peças faltantes do lote"
        pieces={missingPieces}
        totalPending={lotProgress.pending}
        showLot={false}
      />

      {showOrderMissing && (
        <MissingPieces
          title="Onde estão as faltantes do pedido"
          pieces={orderMissingPieces}
          totalPending={orderProgress.pending}
          showLot
        />
      )}

      {summary?.warnings?.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 border-t border-border pt-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{summary.warnings[0]}</span>
        </div>
      )}

      {loading && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Atualizando rastreabilidade...
        </p>
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
        <p className="font-medium text-sm leading-snug break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

function ProgressBlock({ title, progress }) {
  const safe = progress || buildFallbackProgress();
  const percent = Math.max(0, Math.min(100, Number(safe.percent) || 0));
  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-muted-foreground">{title}</span>
        <strong className="text-foreground">{percent}% completo</strong>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-[#2d9c4a] transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Total" value={safe.total} />
        <Metric label="Coletadas" value={safe.completed} color="text-emerald-600" icon={CheckCircle2} />
        <Metric label="Faltam" value={safe.pending} color="text-amber-600" />
        <Metric label="Problema" value={safe.blocked} color="text-red-600" icon={XCircle} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Leituras aprovadas: {safe.approvedReadings || 0} · reprovadas: {safe.rejectedReadings || 0}
      </p>
    </div>
  );
}

function Metric({ label, value, color = 'text-foreground', icon: Icon }) {
  return (
    <div className={`rounded-md bg-secondary/60 px-2 py-2 min-w-0 ${color}`}>
      <div className="flex items-center justify-center gap-1">
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        <p className="text-base font-bold leading-none">{Number(value) || 0}</p>
      </div>
      <p className="text-[10px] text-muted-foreground text-center leading-tight mt-1">{label}</p>
    </div>
  );
}

function MissingPieces({ title, pieces, totalPending, showLot }) {
  const visible = pieces.slice(0, 8);
  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{title}</p>
        <span className="text-xs font-semibold text-amber-600">{Number(totalPending) || 0}</span>
      </div>
      {!visible.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma peça pendente encontrada.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {visible.map((piece) => (
            <div key={piece.id} className="rounded-md bg-secondary/45 px-3 py-2 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold break-all">{piece.item_code}</p>
                <StatusBadge status={piece.status} compact />
              </div>
              <p className="text-xs text-muted-foreground break-words">
                {showLot && piece.lot_code ? `${piece.lot_code} · ` : ''}{piece.product_name || 'Produto não informado'}
              </p>
              <div className="grid sm:grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1 min-w-0">
                  <Route className="w-3.5 h-3.5 shrink-0" />
                  <span className="break-words">{piece.current_step || 'Sem etapa definida'}</span>
                </span>
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="break-words">{piece.current_cell || 'Sem célula definida'}</span>
                </span>
              </div>
              {piece.tag_value && (
                <p className="text-[11px] text-muted-foreground font-mono break-all">Tag: {piece.tag_value}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {pieces.length > visible.length && (
        <p className="text-[11px] text-muted-foreground">Mostrando {visible.length} de {pieces.length} peças listadas.</p>
      )}
    </div>
  );
}

function StatusBadge({ status, compact = false }) {
  const label = statusLabel(status);
  const color = statusColor(status);
  return (
    <span className={`${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'} rounded-md font-semibold shrink-0 ${color}`}>
      {label}
    </span>
  );
}

function buildFallbackProgress(entity = {}) {
  const total = Number(entity?.planned_quantity || entity?.total || 0);
  const completed = Number(entity?.produced_quantity || entity?.approved_quantity || 0);
  const blocked = Number(entity?.rejected_quantity || entity?.scrap_count || 0);
  const pending = Math.max(0, total - completed);
  return {
    total,
    completed,
    pending,
    blocked,
    inProgress: Math.max(0, pending - blocked),
    approvedReadings: Number(entity?.approved_quantity || 0),
    rejectedReadings: Number(entity?.rejected_quantity || 0),
    percent: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0,
  };
}

function hasDifferentLots(pieces = [], currentLotId) {
  if (!currentLotId) return pieces.length > 0;
  return pieces.some((piece) => piece.lot_id && piece.lot_id !== currentLotId);
}

function orderNumber(order = {}) {
  return firstText(order?.order_number, order?.order_code, order?.system_order_number, order?.customer_order_number);
}

function firstText(...values) {
  return values.find((value) => String(value ?? '').trim()) || '';
}

function statusLabel(status) {
  const key = String(status || '').toLowerCase();
  const labels = {
    approved: 'Aprovada',
    completed: 'Concluída',
    in_progress: 'Em produção',
    pending: 'Pendente',
    blocked: 'Bloqueada',
    rejected: 'Reprovada',
    scrap: 'Refugo',
    rework: 'Retrabalho',
    duplicated: 'Duplicada',
    wrong_cell: 'Célula incorreta',
    wrong_step: 'Etapa incorreta',
    queued: 'Na fila',
    error: 'Erro',
  };
  return labels[key] || status || '—';
}

function statusColor(status) {
  const key = String(status || '').toLowerCase();
  if (['approved', 'completed'].includes(key)) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300';
  if (['blocked', 'rejected', 'scrap', 'error', 'wrong_cell', 'wrong_step'].includes(key)) return 'bg-red-50 text-red-700 dark:bg-red-950/25 dark:text-red-300';
  if (['duplicated', 'pending', 'queued', 'rework'].includes(key)) return 'bg-amber-50 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300';
  return 'bg-secondary text-muted-foreground';
}

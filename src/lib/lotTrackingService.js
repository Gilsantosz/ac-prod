import { supabase } from '@/lib/supabaseClient';

const EMPTY_TRACKING = Object.freeze({
  generated_at: null,
  prediction_target: 'ready_for_separation',
  model_window_days: 90,
  stage_models: [],
  general_lots: [],
});

export async function fetchGeneralLotTracking({ batchId = null, limit = 25 } = {}) {
  const { data, error } = await supabase.rpc('get_general_lot_tracking', {
    p_batch_id: batchId || null,
    p_limit: limit,
  });

  if (error) throw error;
  return normalizeTrackingPayload(data);
}

export function normalizeTrackingPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ...EMPTY_TRACKING };

  return {
    ...EMPTY_TRACKING,
    ...payload,
    stage_models: Array.isArray(payload.stage_models) ? payload.stage_models : [],
    general_lots: Array.isArray(payload.general_lots)
      ? payload.general_lots.map((lot) => ({
          ...lot,
          stages: Array.isArray(lot.stages) ? lot.stages : [],
          client_lots: Array.isArray(lot.client_lots)
            ? lot.client_lots.map((clientLot) => ({
                ...clientLot,
                stages: Array.isArray(clientLot.stages) ? clientLot.stages : [],
              }))
            : [],
        }))
      : [],
  };
}

export function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) {
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
}

export function formatForecastDate(value) {
  if (!value) return 'Sem previsão';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem previsão';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getConfidenceMeta(confidence) {
  const values = {
    high: { label: 'Alta confiança', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' },
    medium: { label: 'Confiança média', className: 'border-sky-500/20 bg-sky-500/10 text-sky-700' },
    low: { label: 'Confiança inicial', className: 'border-amber-500/20 bg-amber-500/10 text-amber-700' },
  };
  return values[confidence] || values.low;
}

export function getForecastStatusMeta(status) {
  const values = {
    on_track: { label: 'Em andamento', className: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' },
    attention: { label: 'Requer atenção', className: 'text-rose-700 bg-rose-500/10 border-rose-500/20' },
    delayed: { label: 'Atrasado', className: 'text-rose-700 bg-rose-500/10 border-rose-500/20' },
    not_started: { label: 'Não iniciado', className: 'text-slate-600 bg-slate-500/10 border-slate-500/20' },
  };
  return values[status] || values.not_started;
}

export function groupClientLotsByCustomer(clientLots = []) {
  return clientLots.reduce((groups, lot) => {
    const customerName = String(lot.customer_name || 'Cliente não identificado').trim();
    if (!groups[customerName]) groups[customerName] = [];
    groups[customerName].push(lot);
    return groups;
  }, {});
}


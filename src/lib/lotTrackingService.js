import { supabase } from '@/lib/supabaseClient';

const EMPTY_TRACKING = Object.freeze({
  generated_at: null,
  prediction_target: 'ready_for_separation',
  model_window_days: 90,
  stage_models: [],
  general_lots: [],
});

const FORECAST_STAGE_CATALOG = Object.freeze([
  { stage_code: 'cut', stage_label: 'Corte', stage_order: 1, default_minutes_per_piece: 2 },
  { stage_code: 'edge', stage_label: 'Borda', stage_order: 2, default_minutes_per_piece: 3 },
  { stage_code: 'drill', stage_label: 'Furação', stage_order: 3, default_minutes_per_piece: 4 },
  { stage_code: 'cnc', stage_label: 'Usinagem CNC', stage_order: 4, default_minutes_per_piece: 5 },
  { stage_code: 'joinery', stage_label: 'Marcenaria', stage_order: 5, default_minutes_per_piece: 20 },
]);

export function ensureTraceableForecastModels(stageModels = []) {
  const modelByCode = new Map(
    (Array.isArray(stageModels) ? stageModels : [])
      .filter((model) => model?.stage_code)
      .map((model) => [model.stage_code, model])
  );

  return FORECAST_STAGE_CATALOG.map((stage) => {
    const current = modelByCode.get(stage.stage_code);
    if (current) {
      return {
        ...stage,
        ...current,
        stage_label: stage.stage_label,
        stage_order: stage.stage_order,
      };
    }

    return {
      ...stage,
      sample_count: 0,
      observed_days: 0,
      minutes_per_piece: stage.default_minutes_per_piece,
      p80_minutes_per_piece: stage.default_minutes_per_piece * 1.25,
      confidence: 'low',
      model_source: 'baseline',
    };
  });
}

export async function fetchGeneralLotTracking({ batchId = null, limit = 25 } = {}) {
  const trackingPromise = supabase.rpc('get_general_lot_tracking', {
    p_batch_id: batchId || null,
    p_limit: limit,
  });
  const routePromise = batchId
    ? supabase.rpc('get_lot_route_stage_progress', { p_batch_id: batchId })
    : Promise.resolve({ data: null, error: null });
  const completionPromise = batchId
    ? supabase.rpc('get_lot_route_completion_metrics', { p_batch_id: batchId })
    : Promise.resolve({ data: null, error: null });

  const [
    { data, error },
    { data: routeProgress, error: routeError },
    { data: completionMetrics, error: completionError },
  ] = await Promise.all([trackingPromise, routePromise, completionPromise]);

  if (error) throw error;
  if (routeError && !['PGRST202', '42883'].includes(routeError.code)) throw routeError;
  if (completionError && !['PGRST202', '42883'].includes(completionError.code)) throw completionError;

  return mergeRouteStageProgress(
    normalizeTrackingPayload(data),
    routeProgress,
    completionMetrics
  );
}

function enrichStagesWithForecast(stages, models) {
  const modelByStage = new Map(models.map((model) => [model.stage_code, model]));

  return stages.map((stage) => {
    const model = modelByStage.get(stage.stage_code);
    const remainingPieces = Number(
      stage.remaining_pieces
      ?? Math.max(0, Number(stage.required_pieces || 0) - Number(stage.completed_pieces || 0))
    );
    return {
      ...stage,
      remaining_pieces: remainingPieces,
      estimated_remaining_minutes: Number(
        stage.estimated_remaining_minutes
        ?? remainingPieces * Number(model?.minutes_per_piece || 0)
      ),
      p80_remaining_minutes: Number(
        stage.p80_remaining_minutes
        ?? remainingPieces * Number(model?.p80_minutes_per_piece || model?.minutes_per_piece || 0)
      ),
      confidence: stage.confidence || model?.confidence || 'low',
      model_source: stage.model_source || model?.model_source || 'baseline',
    };
  });
}

function mergeCompletionSummary(target, stages, summary, models) {
  const traceableStages = stages.filter((stage) =>
    Number(stage.required_pieces || 0) > 0
    && stage.traceable_collection_required !== false
  );
  const estimatedRemainingMinutes = traceableStages.reduce(
    (total, stage) => total + Number(stage.estimated_remaining_minutes || 0),
    0
  );
  const p80RemainingMinutes = traceableStages.reduce(
    (total, stage) => total + Number(stage.p80_remaining_minutes || 0),
    0
  );
  const bottleneck = [...traceableStages]
    .sort((a, b) =>
      Number(b.estimated_remaining_minutes || 0) - Number(a.estimated_remaining_minutes || 0)
    )[0];
  const completed = traceableStages.every((stage) => Number(stage.remaining_pieces || 0) === 0);

  return {
    ...target,
    ...(summary || {}),
    stages,
    estimated_remaining_minutes: estimatedRemainingMinutes,
    p80_remaining_minutes: p80RemainingMinutes,
    predicted_ready_at: new Date(Date.now() + estimatedRemainingMinutes * 60_000).toISOString(),
    bottleneck_stage: completed ? 'Concluído' : (bottleneck?.stage_label || 'Sem rota'),
    forecast_confidence: traceableStages.reduce((lowest, stage) => {
      const rank = { low: 1, medium: 2, high: 3 };
      return rank[stage.confidence] < rank[lowest] ? stage.confidence : lowest;
    }, 'high'),
    forecast_status: Number(target.blocked_pieces || 0)
      + Number(target.rework_pieces || 0)
      + Number(target.replacement_pieces || 0) > 0
      ? 'attention'
      : Number(summary?.completed_operations || 0) === 0
        ? 'not_started'
        : 'on_track',
    ready_for_separation: summary?.ready_for_separation ?? completed,
    model_window_days: target.model_window_days,
    stage_models: models,
  };
}

export function mergeRouteStageProgress(tracking, routeProgress, completionMetrics = null) {
  if (!routeProgress || typeof routeProgress !== 'object') return tracking;

  const batchStages = Array.isArray(routeProgress.batch_stages)
    ? routeProgress.batch_stages
    : [];
  const lotStages = routeProgress.lot_stages && typeof routeProgress.lot_stages === 'object'
    ? routeProgress.lot_stages
    : {};
  const batchSummary = completionMetrics?.batch_summary || null;
  const lotSummaries = completionMetrics?.lot_summaries
    && typeof completionMetrics.lot_summaries === 'object'
    ? completionMetrics.lot_summaries
    : {};
  const models = ensureTraceableForecastModels(tracking.stage_models);

  return {
    ...tracking,
    stage_models: models,
    general_lots: tracking.general_lots.map((generalLot) => {
      const isTargetBatch = generalLot.batch_id === routeProgress.batch_id;
      const nextBatchStages = enrichStagesWithForecast(
        isTargetBatch && batchStages.length ? batchStages : generalLot.stages,
        models
      );
      const nextClientLots = generalLot.client_lots.map((clientLot) => {
        const nextLotStages = enrichStagesWithForecast(
          Array.isArray(lotStages[clientLot.lot_id])
            ? lotStages[clientLot.lot_id]
            : clientLot.stages,
          models
        );
        return mergeCompletionSummary(
          clientLot,
          nextLotStages,
          lotSummaries[clientLot.lot_id],
          models
        );
      });

      return {
        ...mergeCompletionSummary(
          generalLot,
          nextBatchStages,
          isTargetBatch ? batchSummary : null,
          models
        ),
        client_lots: nextClientLots,
      };
    }),
  };
}

export function normalizeTrackingPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ...EMPTY_TRACKING };

  return {
    ...EMPTY_TRACKING,
    ...payload,
    stage_models: ensureTraceableForecastModels(payload.stage_models),
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

export function calculateLotBalance(lot) {
  const activeStages = lot.stages?.filter((stage) =>
    stage.required_pieces > 0 && stage.traceable_collection_required !== false
  ) || [];
  if (activeStages.length <= 1) return 100;
  const progresses = activeStages.map(s => s.progress_percent || 0);
  const maxProg = Math.max(...progresses);
  const minProg = Math.min(...progresses);
  return Math.round(100 - (maxProg - minProg));
}

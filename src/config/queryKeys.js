/**
 * AC.Prod MES — Constantes Canônicas de Query Keys do TanStack Query.
 */
export const MES_QUERY_KEYS = {
  collectionSnapshot: ['collection-snapshot'],
  productionDashboard: ['production-dashboard'],
  production: ['production'],
  replacementOrders: ['replacement-orders'],
  replacementMetrics: ['replacement-metrics'],
  replacementKpis: ['replacement-kpis'],
  qualityMetrics: ['quality-metrics'],
  qualityNonconformities: ['quality-nonconformities'],
  qualityDefects: ['quality-defects'],
  downtimeReasons: ['downtime-reasons'],
  activeAlerts: ['mes-alerts', 'active'],
  allAlertsList: ['all-alerts-list'],
  unresolvedAlertsList: ['unresolved-alerts-list'],
  occurrences: ['occurrences'],
  lotIntegrity: ['lot-integrity'],
  pieceDetail: ['piece-detail'],
  traceabilityReadings: ['traceability-readings'],
  dailySummary: ['daily-summary'],
  mesHubKpis: ['mes-hub-kpis'],
  collectionKpis: ['collection-kpis'],
  cellDetailedStats: ['cell-detailed-stats'],
  generalLotTracking: ['general-lot-tracking'],
  lotTrackingDashboard: ['lot-tracking-dashboard'],
  cellKpis: ['cellKpis'],
  realtimeCounters: ['realtimeCounters'],
  productionLots: ['production-lots'],
  productionLotsAlt: ['productionLots'],
  stageReadings: ['stageReadings'],
  collectionEvents: ['collectionEvents'],
  collectionHistory: ['collection-history'],
  oeeStats: ['oeeStats'],
  downtimeStats: ['downtimeStats'],
};

const invalidationState = new WeakMap();
const MES_QUERY_ROOTS = new Set(
  Object.values(MES_QUERY_KEYS).map((queryKey) => queryKey[0]),
);
const INVALIDATION_WINDOW_MS = 750;

function runInvalidation(queryClient, state) {
  state.lastRunAt = Date.now();
  state.timer = null;
  queryClient.invalidateQueries({
    predicate: (query) => MES_QUERY_ROOTS.has(query.queryKey?.[0]),
    refetchType: 'active',
  });
}

/**
 * Coalesce rajadas de Realtime. Uma peça pode atualizar eventos, leitura e
 * estado da peça quase simultaneamente; a UI faz no máximo uma invalidação
 * ampla por janela de 750 ms, em vez de dezenas de RPCs concorrentes.
 */
export function invalidateAllMesQueries(queryClient) {
  if (!queryClient) return;

  let state = invalidationState.get(queryClient);
  if (!state) {
    state = { lastRunAt: 0, timer: null };
    invalidationState.set(queryClient, state);
  }

  const elapsed = Date.now() - state.lastRunAt;
  if (elapsed >= INVALIDATION_WINDOW_MS && !state.timer) {
    runInvalidation(queryClient, state);
    return;
  }

  if (!state.timer) {
    state.timer = setTimeout(
      () => runInvalidation(queryClient, state),
      Math.max(0, INVALIDATION_WINDOW_MS - elapsed),
    );
  }
}

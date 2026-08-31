/**
 * AC.Prod MES — chaves canônicas do TanStack Query.
 *
 * Invalidações Realtime são consolidadas em uma janela curta para impedir que
 * uma única coleta gere dezenas de refetches concorrentes.
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

const DEFAULT_INVALIDATION_DELAY_MS = 750;
const pendingInvalidations = new WeakMap();

function runInvalidation(queryClient) {
  Object.values(MES_QUERY_KEYS).forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey });
  });
}

/**
 * Consolida múltiplos eventos Realtime em uma única rodada de invalidação.
 */
export function invalidateAllMesQueries(queryClient, options = {}) {
  if (!queryClient) return null;

  const existing = pendingInvalidations.get(queryClient);
  if (existing) return existing;

  const delayMs = Math.max(
    0,
    Number(options.delayMs) || DEFAULT_INVALIDATION_DELAY_MS,
  );
  const timeout = setTimeout(() => {
    pendingInvalidations.delete(queryClient);
    runInvalidation(queryClient);
  }, delayMs);

  pendingInvalidations.set(queryClient, timeout);
  return timeout;
}

/**
 * Usado por ações manuais que precisam refletir imediatamente no front.
 */
export function flushPendingMesInvalidation(queryClient) {
  if (!queryClient) return;
  const existing = pendingInvalidations.get(queryClient);
  if (existing) {
    clearTimeout(existing);
    pendingInvalidations.delete(queryClient);
  }
  runInvalidation(queryClient);
}

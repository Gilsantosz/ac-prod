/**
 * AC.Prod MES — Constantes Canônicas de Query Keys do TanStack Query
 * Unifica e sincroniza as chaves de cache em todas as telas do sistema.
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

/**
 * Invalida todas as consultas MES após operações transacionais, como
 * reprovação, estorno, leitura de peça ou alteração de lote.
 */
export function invalidateAllMesQueries(queryClient) {
  if (!queryClient) return;

  Object.values(MES_QUERY_KEYS).forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey });
  });
}


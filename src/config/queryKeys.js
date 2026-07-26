/**
 * AC.Prod MES — Constantes Canônicas de Query Keys do TanStack Query
 * Unifica e sincroniza as chaves de cache em todas as telas do sistema.
 */

export const MES_QUERY_KEYS = {
  collectionSnapshot: ['collection-snapshot'],
  productionDashboard: ['production-dashboard'],
  replacementOrders: ['replacement-orders'],
  replacementMetrics: ['replacement-metrics'],
  qualityMetrics: ['quality-metrics'],
  qualityNonconformities: ['quality-nonconformities'],
  qualityDefects: ['quality-defects'],
  downtimeReasons: ['downtime-reasons'],
  activeAlerts: ['mes-alerts', 'active'],
  occurrences: ['occurrences'],
  lotIntegrity: ['lot-integrity'],
  pieceDetail: ['piece-detail'],
  traceabilityReadings: ['traceability-readings'],
  dailySummary: ['daily-summary'],
};

/**
 * Invalida todas as consultas MES após operações transacionais, como
 * reprovação, estorno, abertura ou conclusão de uma reposição.
 */
export function invalidateAllMesQueries(queryClient) {
  if (!queryClient) return;

  Object.values(MES_QUERY_KEYS).forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey });
  });
}

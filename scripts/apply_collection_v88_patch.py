from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    print(f"updated {path}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 occurrence, found {count}")
    return text.replace(old, new, 1)


def replace_exact_count(
    text: str,
    old: str,
    new: str,
    expected: int,
    label: str,
) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(
            f"{label}: expected {expected} occurrence(s), found {count}",
        )
    return text.replace(old, new)


def replace_between(
    text: str,
    start: str,
    end: str,
    replacement: str,
    label: str,
) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


def patch_collection_service() -> None:
    path = "src/lib/collectionService.js"
    text = read(path)

    text = replace_between(
        text,
        "async function resolveCellId(cellId, cellName) {",
        "/**\n * Busca o histórico de coletas usando a RPC otimizada do Supabase.\n */",
        "",
        "remove redundant cell lookup",
    )
    text = replace_exact_count(
        text,
        "const resolvedCellId = await resolveCellId(cellId, trimmedName);",
        "const resolvedCellId = cellId || null;",
        2,
        "remove resolveCellId calls",
    )

    subscription = """export function subscribeToCollectionHistory({
  cellName,
  cellId,
  callback,
  onStatus,
  channelSuffix = '',
}) {
  const trimmedName = cellName?.trim();
  const uniqueId = Math.random().toString(36).substring(2, 7);
  const suffix = channelSuffix ? `-${channelSuffix}-${uniqueId}` : `-${uniqueId}`;
  const channelName = `collection-history-${trimmedName || cellId || 'all'}${suffix}`;

  const finalEventConfig = {
    event: 'INSERT',
    schema: 'public',
    table: 'production_collection_events',
  };
  if (trimmedName) finalEventConfig.filter = `cell_name=eq.${trimmedName}`;

  try {
    return supabase
      .channel(channelName)
      .on('postgres_changes', finalEventConfig, callback)
      .subscribe((status) => onStatus?.(status));
  } catch (err) {
    console.error('Erro ao subscrever ao canal realtime:', err);
    onStatus?.('CHANNEL_ERROR');
    return null;
  }
}

"""
    text = replace_between(
        text,
        "export function subscribeToCollectionHistory(",
        "export function unsubscribeFromCollectionHistory(channel)",
        subscription,
        "replace realtime subscription",
    )

    text = replace_once(
        text,
        "const isUuid = target.length === 36 && target.includes('-');",
        "const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target);",
        "strict UUID detection",
    )
    text = replace_once(
        text,
        ".or(`piece_uid.eq.${target},traceability_code.eq.${target},piece_code.eq.${target},id.eq.${target}`)",
        ".or([\n          `piece_uid.eq.${target}`,\n          `traceability_code.eq.${target}`,\n          `piece_code.eq.${target}`,\n          ...(isUuid ? [`id.eq.${target}`] : []),\n        ].join(','))",
        "avoid barcode cast to UUID",
    )

    write(path, text)


def patch_traceability_page() -> None:
    path = "src/pages/TraceabilityCollection.jsx"
    text = read(path)

    old_refresh = """  const refreshData = useCallback(() => {
    invalidateAllMesQueries(queryClient);
    queryClient.invalidateQueries({ queryKey: ['stageReadings', cellName, machine?.id] });
    setRefreshReadsSignal(prev => prev + 1);
  }, [queryClient, cellName, machine]);
"""
    new_refresh = """  const refreshKpis = useCallback(() => {
    invalidateAllMesQueries(queryClient);
    queryClient.invalidateQueries({
      queryKey: ['stageReadings', cellName, machine?.id],
    });
  }, [queryClient, cellName, machine?.id]);

  const refreshData = useCallback(() => {
    refreshKpis();
    setRefreshReadsSignal((value) => value + 1);
  }, [refreshKpis]);
"""
    text = replace_once(
        text,
        old_refresh,
        new_refresh,
        "split KPI and history refresh",
    )

    old_realtime = """  // Realtime subscription to refresh KPIs and readings on any collection events
  useEffect(() => {
    if (!cellName) return;
    console.log('Subscribing to realtime collection events for parent KPIs in cell:', cellName);
    const channel = subscribeToCollectionHistory({
      cellName,
      channelSuffix: 'parent',
      callback: (payload) => {
        console.log('Realtime collection event received in parent:', payload);
        refreshData();
      }
    });
    return () => {
      console.log('Unsubscribing from realtime collection events for parent cell:', cellName);
      unsubscribeFromCollectionHistory(channel);
    };
  }, [cellName, refreshData]);
"""
    new_realtime = """  // Uma decisão final gera apenas uma atualização consolidada dos KPIs.
  // O painel de histórico possui sua própria assinatura e não é forçado por aqui.
  useEffect(() => {
    if (!cellName) return undefined;

    const channel = subscribeToCollectionHistory({
      cellName,
      channelSuffix: 'parent',
      callback: () => refreshKpis(),
    });

    return () => {
      unsubscribeFromCollectionHistory(channel);
    };
  }, [cellName, refreshKpis]);
"""
    text = replace_once(
        text,
        old_realtime,
        new_realtime,
        "coalesce parent realtime refresh",
    )

    old_result = """        const result = await processNow(clientEventId);
        updateFeedback({ ...result, client_event_id: clientEventId });
        
        if (result?.success) {
"""
    new_result = """        const result = await processNow(clientEventId);
        updateFeedback({ ...result, client_event_id: clientEventId });

        if (result?.pending || result?.status === 'queued') {
          toast.info(
            result.message || 'Leitura recebida e aguardando validação.',
            { id: 'collection-local-accepted' },
          );
          return result;
        }

        if (result?.success) {
"""
    text = replace_once(
        text,
        old_result,
        new_result,
        "do not treat local ACK as approval",
    )

    write(path, text)


def patch_recent_reads() -> None:
    path = "src/components/collection/CollectionRecentReadsPanel.jsx"
    text = read(path)

    text = replace_once(
        text,
        "const [period, setPeriod] = useState('7days'); // 24h, 7days, month, all",
        "const [period, setPeriod] = useState('24h'); // 24h, 7days, month, all",
        "default history period",
    )
    text = replace_once(
        text,
        "const [shiftScope, setShiftScope] = useState('all'); // all, current",
        "const [shiftScope, setShiftScope] = useState('current'); // all, current",
        "default current shift",
    )

    old_fetch = """  const fetchReadings = useCallback(async (showLoading = true) => {
    if (!cellName) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const { dateFrom, dateTo } = getDateRange(period);
      const activeStatus = statusFilter === 'all' ? null : statusFilter;

      console.log('CollectionRecentReadsPanel Fetching:', {
        cellName,
        workstationId: workstationId || null,
        operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
        shift: shiftScope === 'current' ? (shift || null) : null,
        status: activeStatus,
        limit,
        dateFrom,
        dateTo
      });

      // Executa a busca e a contagem em paralelo
      const [data, count] = await Promise.all([
        getCollectionHistory({
          cellName,
          workstationId: workstationId || null,
          operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
          shift: shiftScope === 'current' ? (shift || null) : null,
          status: activeStatus,
          limit,
          offset: 0,
          dateFrom,
          dateTo
        }),
        getCollectionHistoryCount({
          cellName,
          workstationId: workstationId || null,
          operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
          shift: shiftScope === 'current' ? (shift || null) : null,
          status: activeStatus,
          dateFrom,
          dateTo
        })
      ]);

      console.log('CollectionRecentReadsPanel Result:', { dataLength: data?.length, count });

      setReadings(data);
      setTotalCount(count);
    } catch (e) {
      console.error('CollectionRecentReadsPanel Error:', e);
      setError('Falha ao carregar o histórico de coletas do banco.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [cellName, workstationId, operatorId, operatorScope, shift, shiftScope, period, statusFilter, limit]);
"""
    new_fetch = """  const fetchReadings = useCallback(async (
    showLoading = true,
    refreshCount = true,
  ) => {
    if (!cellName) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const { dateFrom, dateTo } = getDateRange(period);
      const activeStatus = statusFilter === 'all' ? null : statusFilter;
      const filters = {
        cellName,
        workstationId: workstationId || null,
        operatorId: operatorScope === 'mine' ? (operatorId || null) : null,
        shift: shiftScope === 'current' ? (shift || null) : null,
        status: activeStatus,
        limit,
        offset: 0,
        dateFrom,
        dateTo,
      };

      if (refreshCount) {
        const [data, count] = await Promise.all([
          getCollectionHistory(filters),
          getCollectionHistoryCount(filters),
        ]);
        setReadings(data);
        setTotalCount(count);
      } else {
        const data = await getCollectionHistory(filters);
        setReadings(data);
      }
    } catch (e) {
      console.error('CollectionRecentReadsPanel Error:', e);
      setError('Falha ao carregar o histórico de coletas do banco.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [
    cellName,
    workstationId,
    operatorId,
    operatorScope,
    shift,
    shiftScope,
    period,
    statusFilter,
    limit,
  ]);
"""
    text = replace_once(
        text,
        old_fetch,
        new_fetch,
        "separate history and count refresh",
    )

    text = replace_once(
        text,
        "realtimeRefreshRef.current = setTimeout(() => fetchReadings(false), 350);",
        "realtimeRefreshRef.current = setTimeout(() => {\n          fetchReadings(false, false);\n        }, 1_000);",
        "debounce realtime history",
    )

    write(path, text)


def patch_query_keys() -> None:
    path = "src/config/queryKeys.js"
    text = """/**
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
"""
    write(path, text)


def patch_queue_panel() -> None:
    path = "src/components/entry/CollectionQueuePanel.jsx"
    text = read(path)
    text = replace_once(
        text,
        'label="Enviando"',
        'label="Processando"',
        "queue processing label",
    )
    text = replace_once(
        text,
        'label="Sincronizados"',
        'label="Concluídos"',
        "queue completed label",
    )
    write(path, text)


def patch_deploy_workflow() -> None:
    path = ".github/workflows/deploy.yml"
    text = read(path)
    text = replace_once(
        text,
        'REQUIRED_MICRO_BATCH_MIGRATION_VERSION: "20260831170836"',
        'REQUIRED_ASYNC_MIGRATION_VERSION: "v8.8"',
        "deploy async migration env",
    )
    text = replace_once(
        text,
        'REQUIRED_MICRO_BATCH_RELEASE_VERSION: "20260831_acprod_collection_micro_batch_v8_6"',
        'REQUIRED_ASYNC_RELEASE_VERSION: "20260831_acprod_collection_async_sync_v8_8"',
        "deploy async release env",
    )
    text = text.replace(
        'Consultar marcador do micro-batching v8.6',
        'Consultar marcador do sincronismo assíncrono v8.8',
    )
    text = text.replace(
        'get_public_collection_micro_batch_release',
        'get_public_collection_async_release',
    )
    text = text.replace(
        "REQUIRED_MICRO_BATCH_MIGRATION_VERSION",
        "REQUIRED_ASYNC_MIGRATION_VERSION",
    )
    text = text.replace(
        "REQUIRED_MICRO_BATCH_RELEASE_VERSION",
        "REQUIRED_ASYNC_RELEASE_VERSION",
    )
    text = text.replace(
        "marcador do micro-batching retornou formato inválido.",
        "marcador assíncrono retornou formato inválido.",
    )
    text = text.replace(
        "micro-batching Supabase incompatível.",
        "sincronismo assíncrono Supabase incompatível.",
    )
    old_flags = """          required_flags = (
              'collection_micro_batch_ingress_table',
              'collection_micro_batch_trigger',
              'collection_micro_batch_reuses_transactional_rpc',
              'collection_micro_batch_retry_contract',
              'collection_micro_batch_rls',
              'collection_micro_batch_explicit_grants',
              'collection_manual_tags_excluded_from_fast8_gate',
          )
"""
    new_flags = """          required_flags = (
              'collection_async_inbox_columns',
              'collection_async_ingress_is_lightweight',
              'collection_async_private_credentials',
              'collection_async_worker_rpcs',
              'collection_async_session_lock_removed',
              'collection_async_realtime',
              'collection_async_wakeup_trigger',
              'collection_async_fallback_cron',
              'collection_async_vault_secrets',
              'collection_async_worker_concurrency_bounded',
              'collection_event_payload_sanitizer',
              'collection_dashboard_state_cache',
              'collection_shift_kpis_direct_stage_index',
          )
"""
    text = replace_once(text, old_flags, new_flags, "deploy v8.8 flags")
    text = text.replace(
        'MICRO_BATCH_RELEASE_OK migration=',
        'ASYNC_RELEASE_OK migration=',
    )
    text = text.replace(
        '"micro_batch_migration_version": "${REQUIRED_ASYNC_MIGRATION_VERSION}"',
        '"async_migration_version": "${REQUIRED_ASYNC_MIGRATION_VERSION}"',
    )
    text = text.replace(
        '"micro_batch_release_version": "${REQUIRED_ASYNC_RELEASE_VERSION}"',
        '"async_release_version": "${REQUIRED_ASYNC_RELEASE_VERSION}"',
    )
    write(path, text)


def main() -> None:
    patch_collection_service()
    patch_traceability_page()
    patch_recent_reads()
    patch_query_keys()
    patch_queue_panel()
    patch_deploy_workflow()


if __name__ == "__main__":
    main()

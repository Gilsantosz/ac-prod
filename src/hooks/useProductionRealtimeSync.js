import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

// Somente tabelas que realmente precisam refletir movimentações produtivas em tempo real.
// Cadastros, alertas, perfis, automações e históricos administrativos usam consultas sob demanda.
const TABLE_TO_QUERY_KEYS = {
  cells: [
    ['cells'],
    ['cells-admin-list'],
    ['cells-goals-summary'],
    ['cellKpis'],
    ['productionDailyGoals'],
    ['production-effective-goals'],
    ['dailyGoals'],
    ['daily-summary-history-goals'],
  ],
  production_machines: [
    ['machines-admin-list'],
    ['production-machines-admin'],
    ['production-machines'],
    ['cells-goals-summary'],
    ['cellKpis'],
  ],
  production_entries: [
    ['production'],
    ['productionEntries'],
    ['recent-entries'],
    ['daily-summary-history'],
    ['test-entries-list'],
    ['mes-hub-kpis'],
    ['cellKpis'],
    ['oeeStats'],
    ['downtimeStats'],
  ],
  production_daily_goals: [
    ['productionDailyGoals'],
    ['production-daily-goals'],
    ['production-effective-goals'],
    ['cells-goals-summary'],
    ['dailyGoals'],
    ['daily-summary-history-goals'],
    ['cellKpis'],
    ['goals-list'],
  ],
  production_stage_policies: [
    ['production-stage-policies'],
  ],
  production_realtime_counters: [
    ['realtimeCounters'],
    ['collection-kpis'],
    ['cell-detailed-stats'],
    ['cellKpis'],
    ['mes-hub-kpis'],
  ],
  production_collection_events: [
    ['collectionEvents'],
    ['collection-history'],
    ['collection-kpis'],
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
    ['mes-hub-kpis'],
    ['cellKpis'],
  ],
  production_stage_readings: [
    ['stageReadings'],
    ['production-lots'],
    ['collection-history'],
    ['collection-kpis'],
    ['cell-detailed-stats'],
    ['traceability-report-readings'],
    ['test-readings-list'],
    ['test-lot-details'],
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
    ['mes-hub-kpis'],
    ['cellKpis'],
    ['all-alerts-list'],
    ['oeeStats'],
    ['downtimeStats'],
    ['pcp-batches'],
    ['quality-metrics'],
  ],
  production_orders: [
    ['production-orders'],
    ['production-lots'],
    ['mes-hub-kpis'],
    ['pcp-batches'],
  ],
  production_lots: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['test-lots-list'],
    ['test-lot-details'],
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
    ['mes-hub-kpis'],
    ['cellKpis'],
    ['pcp-batches'],
  ],
  production_pieces: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['collection-kpis'],
    ['pcp-batches'],
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
    ['mes-hub-kpis'],
    ['cellKpis'],
  ],
  production_lot_items: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['test-lot-details'],
    ['pcp-batches'],
  ],
  lot_step_events: [
    ['lot-events'],
    ['joinery-events'],
    ['production-lots'],
    ['pcp-batches'],
  ],
  occurrences: [
    ['occurrences'],
    ['all-alerts-list'],
    ['unresolved-alerts-list'],
    ['mes-hub-kpis'],
    ['downtimeStats'],
    ['oeeStats'],
  ],
  packing_volumes: [
    ['packages'],
    ['production-lots'],
    ['trace-search'],
  ],
  packing_volume_items: [
    ['packages'],
    ['production-lots'],
    ['trace-search'],
  ],
  production_cell_lot_states: [
    ['collection-kpis'],
    ['production-lots'],
    ['cell-lot-state'],
    ['cell-detailed-stats'],
    ['mes-hub-kpis'],
    ['cellKpis'],
  ],
  production_cell_active_contexts: [
    ['collection-kpis'],
    ['production-lots'],
    ['cell-active-context'],
    ['cell-detailed-stats'],
    ['mes-hub-kpis'],
    ['cellKpis'],
  ],
  shipments: [['shipments']],
  shipment_items: [['shipments']],
  replacement_orders: [
    ['replacements'],
    ['replacement-orders'],
    ['rejected-pieces'],
    ['production-lots'],
  ],
  rejected_pieces: [
    ['replacements'],
    ['replacement-orders'],
    ['rejected-pieces'],
    ['production-lots'],
  ],
  quality_defects: [
    ['quality-defects'],
    ['quality-occurrences'],
  ],
  quality_occurrences: [
    ['quality-defects'],
    ['quality-occurrences'],
  ],
  quality_nonconformities: [
    ['quality-metrics'],
    ['quality-nonconformities'],
    ['replacement-orders'],
  ],
  quality_actions: [
    ['quality-metrics'],
    ['quality-nonconformities'],
  ],
  quality_defect_catalog: [
    ['quality-metrics'],
    ['quality-defects'],
  ],
};

const REALTIME_TABLES = Object.keys(TABLE_TO_QUERY_KEYS);

function cleanChannelPart(value) {
  return String(value || 'all').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/**
 * Sincronização reativa do fluxo produtivo.
 *
 * Escuta alterações de tabelas chave do MES e invalida os caches de KPIs
 * dos dashboards em tempo real. Inclui fallback de atualização automática.
 */
export function useProductionRealtimeSync(options = {}) {
  const {
    enabled = true,
    cellName,
    machineId,
    debounceMs = 300,
    channelName = 'production-realtime-sync',
  } = options;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;

    const debounceTimers = new Map();

    const triggerInvalidate = (queryKey) => {
      const keyStr = JSON.stringify(queryKey);
      if (debounceTimers.has(keyStr)) {
        clearTimeout(debounceTimers.get(keyStr));
      }
      const timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
        debounceTimers.delete(keyStr);
      }, debounceMs);
      debounceTimers.set(keyStr, timer);
    };

    const invalidateOperationalBootstrap = () => {
      [
        ['production'],
        ['realtimeCounters'],
        ['collection-kpis'],
        ['cellKpis'],
        ['cells'],
        ['production-stage-policies'],
      ].forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey, refetchType: 'active' });
      });
    };

    // Dashboard.jsx usa initialData=[] para evitar layout vazio. Quando essa query
    // é criada pela primeira vez, o React Query pode considerar o array inicial
    // fresco por alguns segundos e adiar o primeiro GET. Ao detectar a montagem
    // de um observador do Painel com cache vazio/idle, invalida exatamente essa
    // query uma única vez na montagem para buscar o estado autoritativo do banco.
    // Isso cobre inclusive navegação para o Painel depois de o Realtime já estar
    // conectado, sem reintroduzir polling agressivo em todos os clientes.
    const unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
      const queryKey = event?.query?.queryKey;
      if (
        event?.type !== 'observerAdded'
        || !Array.isArray(queryKey)
        || queryKey[0] !== 'production'
        || queryKey[1] !== 'dashboard'
      ) {
        return;
      }

      const state = event.query.state;
      if (Array.isArray(state?.data) && state.data.length === 0 && state.fetchStatus === 'idle') {
        triggerInvalidate(queryKey);
      }
    });

    const handlePayload = (payload) => {
      const table = payload.table;
      const queryKeys = TABLE_TO_QUERY_KEYS[table];
      if (!queryKeys) return;

      const newRow = payload.new || {};
      const oldRow = payload.old || {};

      const eventCell = newRow.cell_name || newRow.cell || oldRow.cell_name || oldRow.cell;
      if (cellName && eventCell && String(eventCell).toLowerCase() !== String(cellName).toLowerCase()) {
        return;
      }

      const eventMachine = newRow.machine_id || oldRow.machine_id;
      if (machineId && eventMachine && String(eventMachine) !== String(machineId)) {
        return;
      }

      if (table === 'production_entries') {
        const eventDate = newRow.date || oldRow.date;
        const previousDate = oldRow.date;
        const updateDateCache = (cacheDate) => queryClient.setQueryData(['production', cacheDate], (current) => {
          if (!Array.isArray(current)) return current;
          const rowId = newRow.id || oldRow.id;
          if (!rowId) return current;
          if (payload.eventType === 'DELETE' || (newRow.date && newRow.date !== cacheDate)) {
            return current.filter((row) => row.id !== rowId);
          }
          const normalized = { ...newRow, created_date: newRow.created_at };
          const existingIndex = current.findIndex((row) => row.id === rowId);
          if (existingIndex < 0) return [normalized, ...current];
          const next = [...current];
          next[existingIndex] = { ...next[existingIndex], ...normalized };
          return next;
        });

        if (eventDate) {
          updateDateCache(eventDate);
          triggerInvalidate(['production', eventDate]);
        }
        if (previousDate && previousDate !== eventDate) {
          updateDateCache(previousDate);
          triggerInvalidate(['production', previousDate]);
        }
      }

      queryKeys.forEach((queryKey) => {
        triggerInvalidate(queryKey);
      });
    };

    const realtimeChannelName = [
      channelName,
      cleanChannelPart(cellName),
      cleanChannelPart(machineId),
      Math.random().toString(36).substring(2, 9),
    ].join(':');

    let channel = null;
    let fallbackInterval = null;

    try {
      channel = supabase.channel(realtimeChannelName);

      REALTIME_TABLES.forEach((table) => {
        channel = channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
          },
          handlePayload,
        );
      });

      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Production Realtime] Canal websocket temporariamente indisponível. Ativando fallback de atualização periódica.');
          if (!fallbackInterval) {
            fallbackInterval = setInterval(() => {
              queryClient.invalidateQueries({ queryKey: ['production'] });
              queryClient.invalidateQueries({ queryKey: ['production-lots'] });
              queryClient.invalidateQueries({ queryKey: ['occurrences'] });
              queryClient.invalidateQueries({ queryKey: ['collection-kpis'] });
              queryClient.invalidateQueries({ queryKey: ['cellKpis'] });
              queryClient.invalidateQueries({ queryKey: ['cells'] });
              queryClient.invalidateQueries({ queryKey: ['production-stage-policies'] });
            }, 15000);
          }
        } else if (status === 'SUBSCRIBED') {
          if (fallbackInterval) {
            clearInterval(fallbackInterval);
            fallbackInterval = null;
          }
          // Um cache com initialData pode nascer "fresco" antes do primeiro GET.
          // Ao confirmar o websocket, força somente queries ativas a buscarem o
          // estado autoritativo do banco, eliminando KPIs zerados no bootstrap.
          invalidateOperationalBootstrap();
        }
      });
    } catch (err) {
      console.warn('[Production Realtime] Erro ao registrar canal realtime:', err);
      if (!fallbackInterval) {
        fallbackInterval = setInterval(() => {
          queryClient.invalidateQueries({ queryKey: ['production'] });
          queryClient.invalidateQueries({ queryKey: ['production-lots'] });
          queryClient.invalidateQueries({ queryKey: ['occurrences'] });
          queryClient.invalidateQueries({ queryKey: ['collection-kpis'] });
          queryClient.invalidateQueries({ queryKey: ['cellKpis'] });
          queryClient.invalidateQueries({ queryKey: ['cells'] });
          queryClient.invalidateQueries({ queryKey: ['production-stage-policies'] });
        }, 15000);
      }
    }

    return () => {
      unsubscribeQueryCache();
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          /* noop */
        }
      }
      debounceTimers.forEach(clearTimeout);
    };
  }, [queryClient, enabled, cellName, machineId, debounceMs, channelName]);
}

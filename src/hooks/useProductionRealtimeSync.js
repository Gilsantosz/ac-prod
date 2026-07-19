import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

const TABLE_TO_QUERY_KEYS = {
  production_entries: [
    ['production'],
    ['productionEntries'],
    ['test-entries-list'],
  ],
  daily_goals: [['dailyGoals']],
  production_daily_goals: [
    ['productionDailyGoals'],
    ['dailyGoals'],
    ['production-daily-goals'],
    ['cells-goals-summary'],
    ['collection-kpis'],
  ],
  occurrences: [['occurrences']],
  cells: [
    ['cells'],
    ['cells-admin-list'],
    ['cells-goals-summary'],
  ],
  production_machines: [
    ['production-machines'],
    ['production-machines-admin'],
    ['machines-admin-list'],
    ['cells-goals-summary'],
  ],
  production_realtime_counters: [
    ['realtimeCounters'],
    ['collection-kpis'],
    ['cell-detailed-stats'],
  ],
  production_collection_events: [
    ['collectionEvents'],
    ['collection-history'],
    ['collection-kpis'],
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
  ],
  production_orders: [
    ['production-orders'],
    ['production-lots'],
  ],
  production_lots: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['test-lots-list'],
    ['test-lot-details'],
  ],
  production_pieces: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['collection-kpis'],
    ['pcp-batches'],
  ],
  promob_import_batches: [
    ['production-lots'],
    ['trace-search'],
    ['collection-kpis'],
    ['pcp-batches'],
  ],
  production_lot_items: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['test-lot-details'],
  ],
  production_routes: [
    ['production-route'],
    ['production-lots'],
  ],
  production_tags: [
    ['production-lots'],
    ['test-lot-details'],
  ],
  lot_step_events: [
    ['lot-events'],
    ['joinery-events'],
    ['production-lots'],
  ],
  packages: [['packages']],
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
  shipments: [['shipments']],
  shipment_items: [['shipments']],
  customer_covers: [
    ['customer-covers'],
    ['customerCovers'],
    ['production-lots'],
    ['trace-search'],
  ],
  customer_cover_events: [
    ['customer-cover-events'],
    ['customerCoverEvents'],
    ['lot-events'],
    ['production-lots'],
  ],
  operators: [['operators']],
  profiles: [
    ['users'],
    ['users', 'me'],
  ],
  automation_rules: [['automationRules']],
  alert_logs: [
    ['unresolvedAlerts'],
    ['unresolved-alerts-list'],
    ['all-alerts-list'],
    ['mes-hub-kpis'],
  ],
};

const REALTIME_TABLES = Object.keys(TABLE_TO_QUERY_KEYS);

function cleanChannelPart(value) {
  return String(value || 'all').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/**
 * Hook de sincronização reativa otimizado para o fluxo de produção de alta velocidade.
 * Filtra eventos por célula/máquina e aplica debounce para evitar storms de renderização na UI.
 */
export function useProductionRealtimeSync(options = {}) {
  const { enabled = true, cellName, machineId, debounceMs = 300, channelName = 'production-realtime-sync' } = options;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

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

    const handlePayload = (payload) => {
      const table = payload.table;
      const queryKeys = TABLE_TO_QUERY_KEYS[table];
      if (!queryKeys) return;

      const newRow = payload.new || {};
      const oldRow = payload.old || {};

      // Filtragem opcional por célula.
      const eventCell = newRow.cell_name || newRow.cell || oldRow.cell_name || oldRow.cell;
      if (cellName && eventCell && String(eventCell).toLowerCase() !== String(cellName).toLowerCase()) {
        return;
      }

      // Filtragem opcional por máquina/posto.
      const eventMachine = newRow.machine_id || oldRow.machine_id;
      if (machineId && eventMachine && String(eventMachine) !== String(machineId)) {
        return;
      }

      // O dashboard mantém uma janela paginada sem limite fixo de 5.000 linhas.
      // Para cada nova coleta, atualiza essa janela em memória em vez de baixar
      // novamente todo o mês em todos os monitores conectados.
      if (table === 'production_entries') {
        queryClient.setQueriesData({ queryKey: ['production'] }, (current) => {
          if (!Array.isArray(current)) return current;
          const rowId = newRow.id || oldRow.id;
          if (!rowId) return current;
          if (payload.eventType === 'DELETE') {
            return current.filter(row => row.id !== rowId);
          }
          const normalized = { ...newRow, created_date: newRow.created_at };
          const existingIndex = current.findIndex(row => row.id === rowId);
          if (existingIndex < 0) return [normalized, ...current];
          const next = [...current];
          next[existingIndex] = { ...next[existingIndex], ...normalized };
          return next;
        });
      }

      queryKeys.forEach((queryKey) => {
        if (table === 'production_entries' && queryKey[0] === 'production') return;
        triggerInvalidate(queryKey);
      });
    };

    const realtimeChannelName = [
      channelName,
      cleanChannelPart(cellName),
      cleanChannelPart(machineId),
    ].join(':');

    let channel = supabase.channel(realtimeChannelName);

    REALTIME_TABLES.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
        },
        handlePayload
      );
    });

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('[Production Realtime] Falha no canal realtime. As telas seguem com recarga por consulta.');
      }
    });

    return () => {
      supabase.removeChannel(channel);
      debounceTimers.forEach(clearTimeout);
    };
  }, [queryClient, enabled, cellName, machineId, debounceMs, channelName]);
}

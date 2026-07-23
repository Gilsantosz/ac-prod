import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

// Somente tabelas que realmente precisam refletir movimentações produtivas em tempo real.
// Cadastros, alertas, perfis, automações e históricos administrativos usam consultas sob demanda.
const TABLE_TO_QUERY_KEYS = {
  production_entries: [
    ['production'],
    ['productionEntries'],
    ['test-entries-list'],
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
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
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
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
  ],
  production_pieces: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['collection-kpis'],
    ['pcp-batches'],
    ['general-lot-tracking'],
    ['lot-tracking-dashboard'],
  ],
  production_lot_items: [
    ['production-lots'],
    ['productionLots'],
    ['trace-search'],
    ['test-lot-details'],
  ],
  lot_step_events: [
    ['lot-events'],
    ['joinery-events'],
    ['production-lots'],
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
  shipments: [['shipments']],
  shipment_items: [['shipments']],
};

const REALTIME_TABLES = Object.keys(TABLE_TO_QUERY_KEYS);

function cleanChannelPart(value) {
  return String(value || 'all').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/**
 * Sincronização reativa do fluxo produtivo.
 *
 * A assinatura global foi reduzida às tabelas operacionais de alta relevância.
 * Alertas e cadastros não entram neste canal para impedir tempestades de
 * mensagens e refetch em todos os navegadores conectados.
 */
export function useProductionRealtimeSync(options = {}) {
  const {
    enabled = true,
    cellName,
    machineId,
    debounceMs = 750,
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
        queryClient.setQueriesData({ queryKey: ['production'] }, (current) => {
          if (!Array.isArray(current)) return current;
          const rowId = newRow.id || oldRow.id;
          if (!rowId) return current;
          if (payload.eventType === 'DELETE') {
            return current.filter((row) => row.id !== rowId);
          }
          const normalized = { ...newRow, created_date: newRow.created_at };
          const existingIndex = current.findIndex((row) => row.id === rowId);
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
        handlePayload,
      );
    });

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('[Production Realtime] Falha no canal. As telas seguem com recarga por consulta.');
      }
    });

    return () => {
      supabase.removeChannel(channel);
      debounceTimers.forEach(clearTimeout);
    };
  }, [queryClient, enabled, cellName, machineId, debounceMs, channelName]);
}

import { supabase } from '@/lib/supabaseClient';
import * as core from '@/lib/collectionServiceCore';

export * from '@/lib/collectionServiceCore';

// Contratos RPC preservados pelo core: get_collection_dashboard_snapshot_v2
// e get_operator_shift_kpis_v2. O wrapper apenas coalesce chamadas idênticas.

const collectionKpiCache = new Map();
const operatorKpiCache = new Map();
const COLLECTION_KPI_TTL_MS = 1_500;
const OPERATOR_KPI_TTL_MS = 1_500;
const REALTIME_COALESCE_MS = 250;

function stableKey(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(value[key])}`)
    .join(',')}}`;
}

async function memoized(cache, key, ttlMs, loader) {
  const now = Date.now();
  const existing = cache.get(key);

  if (existing?.promise) return existing.promise;
  if (existing && now - existing.createdAt < ttlMs) return existing.value;

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      cache.set(key, { value, createdAt: Date.now(), promise: null });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, {
    value: existing?.value,
    createdAt: existing?.createdAt || 0,
    promise,
  });
  return promise;
}

/**
 * Coalesce requests iguais disparadas por Realtime/TanStack Query. O resultado
 * permanece canônico no PostgreSQL; o cache curto só evita tempestades de RPC.
 */
export function getCollectionKpis(params = {}) {
  return memoized(
    collectionKpiCache,
    stableKey(params),
    COLLECTION_KPI_TTL_MS,
    () => core.getCollectionKpis(params),
  );
}

export function getOperatorShiftKpisV2(operatorId, referenceTime = new Date()) {
  const referenceBucket = Math.floor(
    new Date(referenceTime).getTime() / OPERATOR_KPI_TTL_MS,
  );
  const key = `${operatorId || 'none'}:${referenceBucket}`;
  return memoized(
    operatorKpiCache,
    key,
    OPERATOR_KPI_TTL_MS,
    () => core.getOperatorShiftKpisV2(operatorId, referenceTime),
  );
}

function attachCleanup(channel, cleanup) {
  try {
    Object.defineProperty(channel, '__acprodCleanup', {
      value: cleanup,
      configurable: true,
    });
  } catch {
    // O canal continua removível mesmo se o runtime impedir a propriedade.
  }
  return channel;
}

/**
 * Uma leitura canônica gera alterações em várias tabelas. Para o painel pai,
 * escutar production_collection_events é suficiente e evita três refetches por
 * peça. Eventos são agrupados por 250 ms antes de invalidar a UI.
 */
export function subscribeToCollectionHistory({
  cellName,
  cellId,
  callback,
  onStatus,
  channelSuffix = '',
  includeStageReadings = false,
  includePieceUpdates = false,
}) {
  const trimmedName = cellName?.trim();
  const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const suffix = channelSuffix ? `-${channelSuffix}` : '';
  const channelName = `collection-history-v88-${trimmedName || cellId || 'all'}${suffix}-${uniqueId}`;
  let timer = null;
  let latestPayload = null;

  const schedule = (payload) => {
    latestPayload = payload;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const nextPayload = latestPayload;
      latestPayload = null;
      callback?.(nextPayload);
    }, REALTIME_COALESCE_MS);
  };

  const collectionConfig = {
    event: '*',
    schema: 'public',
    table: 'production_collection_events',
  };
  if (trimmedName) collectionConfig.filter = `cell_name=eq.${trimmedName}`;

  let channel = supabase
    .channel(channelName)
    .on('postgres_changes', collectionConfig, schedule);

  if (includeStageReadings) {
    const readingsConfig = {
      event: '*',
      schema: 'public',
      table: 'production_stage_readings',
    };
    if (trimmedName) readingsConfig.filter = `cell_name=eq.${trimmedName}`;
    channel = channel.on('postgres_changes', readingsConfig, schedule);
  }

  if (includePieceUpdates) {
    channel = channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'production_pieces' },
      schedule,
    );
  }

  channel = channel.subscribe((status) => onStatus?.(status));
  return attachCleanup(channel, () => {
    if (timer) clearTimeout(timer);
    timer = null;
    latestPayload = null;
  });
}

export function unsubscribeFromCollectionHistory(channel) {
  if (!channel) return Promise.resolve();
  try {
    channel.__acprodCleanup?.();
  } catch {
    // Sem impacto operacional.
  }
  return supabase.removeChannel(channel).catch(() => undefined);
}

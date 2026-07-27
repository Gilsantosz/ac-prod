import { useProductionRealtimeSync } from './useProductionRealtimeSync';

/**
 * Hook global de sincronização em tempo real.
 * Escuta eventos do Supabase e invalida caches de dados de produção.
 */
export function useRealtimeSync(enabled = true, options = {}) {
  useProductionRealtimeSync({
    enabled,
    ...options,
  });
}

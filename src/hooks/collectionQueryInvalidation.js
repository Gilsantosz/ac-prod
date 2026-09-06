// Uma janela compartilhada por QueryClient reúne Broadcast, Postgres Changes
// e confirmações locais. Debounce reiniciado por leitura nunca termina sob
// carga contínua; esta janela tem prazo fixo e não cancela GETs em andamento.
export const COLLECTION_QUERY_REFRESH_INTERVAL_MS = 750;

const invalidators = new WeakMap();

function matchesFilter(query, filter) {
  if (filter.queryKey) {
    const prefix = query.queryKey?.slice(0, filter.queryKey.length);
    if (JSON.stringify(prefix) !== JSON.stringify(filter.queryKey)) return false;
  }
  return !filter.predicate || filter.predicate(query);
}

export function createCollectionQueryInvalidator(queryClient, intervalMs = COLLECTION_QUERY_REFRESH_INTERVAL_MS) {
  const pending = new Map();
  let timer = null;
  let running = false;
  let stopped = false;

  const schedule = () => {
    if (stopped || running || timer !== null || !pending.size) return;
    timer = setTimeout(flush, intervalMs);
  };

  const flush = async () => {
    timer = null;
    if (stopped || running || !pending.size) return;
    running = true;
    const filters = [...pending.values()];
    pending.clear();
    const predicate = (query) => filters.some((filter) => matchesFilter(query, filter));
    try {
      const queries = queryClient.getQueryCache?.().getAll?.();
      if (queries) {
        const ready = new Set();
        for (const query of queries.filter(predicate)) {
          if (query.state?.fetchStatus === 'fetching') {
            // Um GET iniciado antes do evento pode devolver fotografia antiga.
            // Mantemos um trailing refresh só desta query, sem bloquear KPIs
            // atrás de um relatório ou histórico lento de outra consulta.
            pending.set(JSON.stringify(query.queryKey), { queryKey: query.queryKey });
          } else {
            ready.add(query.queryHash);
          }
        }
        if (ready.size) {
          void Promise.resolve(queryClient.invalidateQueries(
            { predicate: (query) => ready.has(query.queryHash), refetchType: 'active' },
            { cancelRefetch: false },
          )).catch((error) => {
            console.warn('[Collection Realtime] Falha ao atualizar indicadores:', error);
          });
        }
      } else {
        await queryClient.invalidateQueries(
          { predicate, refetchType: 'active' },
          { cancelRefetch: false },
        );
      }
    } catch (error) {
      // A falha pertence à query (que mantém seu erro/última fotografia); não
      // transforma a invalidação visual em rejeição da coleta durável.
      console.warn('[Collection Realtime] Falha ao atualizar indicadores:', error);
    } finally {
      running = false;
      schedule();
    }
  };

  return {
    enqueue(filter, scopeKey = JSON.stringify(filter.queryKey)) {
      if (stopped) return;
      pending.set(scopeKey, filter);
      schedule();
    },
    stop() {
      stopped = true;
      pending.clear();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export function scheduleCollectionQueryInvalidation(queryClient, filter, scopeKey) {
  if (!queryClient?.invalidateQueries) return;
  let invalidator = invalidators.get(queryClient);
  if (!invalidator) {
    invalidator = createCollectionQueryInvalidator(queryClient);
    invalidators.set(queryClient, invalidator);
  }
  invalidator.enqueue(filter, scopeKey);
}

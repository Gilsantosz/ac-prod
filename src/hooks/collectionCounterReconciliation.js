// Uma corrida rara entre snapshot e ACK não deve virar GET por leitura.
// Cada chave compartilha duas oportunidades fixas, sem reiniciar os prazos.
const schedulers = new WeakMap();

export function resolveCollectionSnapshotAfterLocalUpdates({
  queryClient, queryKey, startedGeneration, currentGeneration, snapshot,
}) {
  if (startedGeneration !== currentGeneration) {
    // Um GET iniciado antes da confirmação nunca pode apagar essa confirmação
    // ao devolver uma fotografia antiga. A consulta limitada confirma a base.
    return {
      ...(queryClient.getQueryData(queryKey) || snapshot),
      counter_reconciliation_required: true,
    };
  }
  return { ...snapshot, _collection_snapshot_completed_at: Date.now() };
}

export function scheduleCollectionCounterReconciliation(queryClient, queryKey) {
  if (!queryClient?.invalidateQueries || !queryClient?.getQueryData) return;
  let byKey = schedulers.get(queryClient);
  if (!byKey) {
    byKey = new Map();
    schedulers.set(queryClient, byKey);
  }
  const identity = JSON.stringify(queryKey);
  if (byKey.has(identity)) return;
  const entry = { running: false, expired: false };
  byKey.set(identity, entry);

  const reconcile = async (lastAttempt) => {
    if (lastAttempt) entry.expired = true;
    if (entry.running) return;
    const data = queryClient.getQueryData(queryKey);
    const fetching = queryClient.getQueryState?.(queryKey)?.fetchStatus === 'fetching';
    if (!data?.counter_reconciliation_required || fetching) {
      if (entry.expired) byKey.delete(identity);
      return;
    }
    entry.running = true;
    try {
      await queryClient.invalidateQueries(
        { queryKey, exact: true, refetchType: 'active' },
        { cancelRefetch: false },
      );
    } catch (error) {
      console.warn('[Collection] Reconciliação dos indicadores indisponível:', error);
    } finally {
      entry.running = false;
      if (entry.expired) byKey.delete(identity);
    }
  };

  setTimeout(() => { void reconcile(false); }, 3_000);
  setTimeout(() => { void reconcile(true); }, 8_000);
}

import { supabase } from '@/lib/supabaseClient';
import { normalizeCollectionIngressRow } from '@/lib/collectionBatchService';

const FINAL_SERVER_STATUSES = new Set(['sincronizada', 'erro']);

export function isFinalCollectionIngress(envelope) {
  return FINAL_SERVER_STATUSES.has(envelope?.status_sincronizacao);
}

/**
 * Escuta as decisões finais do inbox assíncrono. A RLS da tabela garante que
 * cada usuário autenticado recebe apenas as próprias coletas.
 */
export function subscribeToCollectionInbox(onEnvelope) {
  if (typeof onEnvelope !== 'function') {
    throw new TypeError('onEnvelope deve ser uma função.');
  }

  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  const channel = supabase
    .channel(`collection-inbox-${suffix}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'coletas_producao',
      },
      (payload) => {
        if (!payload?.new?.client_event_id) return;
        onEnvelope(normalizeCollectionIngressRow(payload.new));
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

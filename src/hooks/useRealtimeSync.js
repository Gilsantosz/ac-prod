import { useEffect } from 'react';

/**
 * Compatibilidade temporária.
 *
 * A sincronização global antiga assinava todo o schema `public` e duplicava
 * o canal mais específico de `useProductionRealtimeSync`. Isso multiplicava
 * mensagens Realtime e invalidações do React Query em cada navegador.
 *
 * O hook permanece exportado para evitar quebra nos componentes existentes,
 * mas não cria mais uma segunda assinatura global.
 */
export function useRealtimeSync(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    return undefined;
  }, [enabled]);
}

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

// Mapeia o nome das tabelas físicas do Supabase para as chaves do React Query
const TABLE_TO_QUERY_KEY = {
  production_entries: ['production'],
  daily_goals: ['dailyGoals'],
  occurrences: ['occurrences'],
  operators: ['operators'],
  cells: ['cells'],
  automation_rules: ['automationRules'],
  profiles: ['users', 'me'],
};

/**
 * Hook customizado para sincronização de dados em tempo real.
 * Escuta qualquer inserção, atualização ou exclusão nas tabelas do banco
 * e atualiza o estado local do React Query imediatamente.
 * 
 * @param {boolean} enabled - Define se a escuta do canal está ativa
 */
export function useRealtimeSync(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // Subscreve ao canal Postgres Changes para receber atualizações do schema public
    const channel = supabase
      .channel('db-realtime-sync')
      .on(
        'postgres_changes',
        {
          event: '*', // Escuta INSERT, UPDATE e DELETE
          schema: 'public',
        },
        (payload) => {
          const table = payload.table;
          const queryKey = TABLE_TO_QUERY_KEY[table];

          if (queryKey) {
            console.log(`[Realtime Sync] Alteração detectada em '${table}', invalidando cache:`, queryKey);
            
            // Invalida a chave da query correspondente
            // Isso força o React Query a fazer um refetch inteligente em background,
            // atualizando a interface gráfica (UI) sem travar ou forçar F5.
            queryClient.invalidateQueries({ queryKey });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime Sync] Conectado com sucesso ao canal de eventos em tempo real.');
        }
      });

    return () => {
      // Desconecta e limpa o canal ao desmontar ou deslogar
      supabase.removeChannel(channel);
      console.log('[Realtime Sync] Canal de eventos encerrado.');
    };
  }, [queryClient, enabled]);
}

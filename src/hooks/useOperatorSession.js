import { useState, useEffect, useCallback } from 'react';
import {
  getOperatorSession,
  loginOperator,
  clearOperatorSession,
  heartbeatOperatorSession,
  setOperatorSessionContext,
} from '@/lib/operatorSessionService';

/**
 * Hook de sessão operacional.
 * Gerencia login, logout, expiração e estado reativo da estação.
 */
export function useOperatorSession() {
  const [session, setSession] = useState(() => getOperatorSession());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Verificar expiração a cada 30s
  useEffect(() => {
    const check = () => {
      const current = getOperatorSession();
      if (!current && session) {
        setSession(null); // sessão expirou
      }
    };
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [session]);

  // Sincronizar com mudanças globais de sessão
  useEffect(() => {
    const handleSessionChange = () => {
      setSession(getOperatorSession());
    };
    window.addEventListener('operator-session-changed', handleSessionChange);
    return () => {
      window.removeEventListener('operator-session-changed', handleSessionChange);
    };
  }, []);

  // Envia heartbeat/refresh a cada 5 minutos
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => heartbeatOperatorSession(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [session]);

  const login = useCallback(async (loginName, registration) => {
    setLoading(true);
    setError(null);
    try {
      const sess = await loginOperator(loginName, registration);
      setSession(sess);
      return sess;
    } catch (err) {
      setError(err.message || 'Falha no login operacional.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await clearOperatorSession();
      setSession(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const setContext = useCallback(async (cellId, machineId = null, stationName = 'Estação Coleta') => {
    setLoading(true);
    setError(null);
    try {
      const sess = await setOperatorSessionContext(cellId, machineId, stationName);
      setSession(sess);
      return sess;
    } catch (err) {
      setError(err.message || 'Falha ao selecionar contexto de posto.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    session,
    isLoggedIn: !!session,
    loading,
    error,
    login,
    logout,
    setContext,
    // Atalhos úteis mapeados da sessão
    operatorName: session?.name || '',
    operatorId: session?.id || null,
    loginName: session?.login_name || '',
    registration: session?.registration || '',
    primaryCellId: session?.primary_cell || null,
    primaryMachineId: session?.primary_machine || null,
    cells: session?.cells || [],
    machines: session?.machines || [],
    shift: session?.shift || '',
    token: session?.token || null,
    
    // Contexto selecionado para a baixa
    selectedCellId: session?.selected_cell_id || null,
    selectedCellName: session?.selected_cell_name || '',
    selectedMachineId: session?.selected_machine_id || null,
    selectedMachineName: session?.selected_machine_name || '',
    selectedStationName: session?.selected_station_name || '',
  };
}

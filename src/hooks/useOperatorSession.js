import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getOperatorSession,
  loginOperator,
  clearOperatorSession,
  refreshOperatorSessionTTL,
} from '@/lib/operatorSessionService';

/**
 * Hook de sessão operacional.
 * Gerencia login, logout, expiração e estado reativo.
 */
export function useOperatorSession() {
  const [session, setSession] = useState(() => getOperatorSession());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const refreshRef = useRef(null);

  // Verificar expiração a cada 60s
  useEffect(() => {
    const check = () => {
      const current = getOperatorSession();
      if (!current && session) {
        setSession(null); // sessão expirou
      }
    };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [session]);

  // Renovar TTL a cada 5 minutos de uso
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => refreshOperatorSessionTTL(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [session]);

  const login = useCallback(async (name, registration) => {
    setLoading(true);
    setError(null);
    try {
      const sess = await loginOperator(name, registration);
      setSession(sess);
      return sess;
    } catch (err) {
      setError(err.message || 'Falha no login operacional.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearOperatorSession();
    setSession(null);
    setError(null);
  }, []);

  return {
    session,
    isLoggedIn: !!session,
    loading,
    error,
    login,
    logout,
    // Atalhos úteis
    operatorName: session?.name || '',
    operatorId: session?.id || null,
    primaryCell: session?.primary_cell || '',
    cells: session?.cells || [],
    shift: session?.shift || '',
    registration: session?.registration || '',
  };
}

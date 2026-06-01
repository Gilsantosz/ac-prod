import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { base44 } from '@/lib/localDb';

const AuthContext = createContext();

// Helper: garante que redirecionamentos incluem o basename /ac-prod
const redirectTo = (path) => {
  const base = import.meta.env.BASE_URL || '/ac-prod/';
  const cleanBase = base.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  window.location.replace(`${cleanBase}${cleanPath}`);
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // ─── Busca o perfil completo do usuário (com role, cell, permissions) ────────
  const fetchProfile = useCallback(async (supabaseUser) => {
    if (!supabaseUser) return null;
    try {
      const profile = await base44.auth.me();
      return profile;
    } catch {
      // Perfil ainda não existe — usa metadados básicos do Auth
      return {
        id: supabaseUser.id,
        email: supabaseUser.email,
        name: supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || '',
        role: supabaseUser.user_metadata?.role || 'operator',
        cell: supabaseUser.user_metadata?.cell || '',
        permissions: {
          view_dashboards: true,
          register_production: true,
          manage_occurrences: true,
          manage_cells: false,
          manage_operators: false,
          view_reports: false,
          manage_automations: false,
          manage_users: false,
        },
        dashboard_layout: null,
      };
    }
  }, []);

  // ─── Inicialização da sessão via onAuthStateChange (padrão Supabase v2) ──────
  // No Supabase v2, onAuthStateChange dispara INITIAL_SESSION imediatamente
  // após o registro do listener. É a maneira confiável de detectar sessão existente.
  useEffect(() => {
    let resolved = false;

    // Segurança: força saída do estado de loading após 6 segundos
    // (evita tela branca infinita em casos de rede instável ou token corrompido)
    const hardTimeout = setTimeout(() => {
      if (!resolved) {
        console.warn('[AC.Prod] Auth timeout — forçando estado não autenticado');
        resolved = true;
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    }, 6000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (event === 'INITIAL_SESSION') {
          // Primeiro evento sempre disparado — define o estado inicial real
          if (session?.user) {
            const profile = await fetchProfile(session.user);
            setUser(profile);
            setIsAuthenticated(true);
            setAuthError(null);
          } else {
            setUser(null);
            setIsAuthenticated(false);
          }
        } else if (event === 'SIGNED_IN' && session?.user) {
          const profile = await fetchProfile(session.user);
          setUser(profile);
          setIsAuthenticated(true);
          setAuthError(null);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setIsAuthenticated(false);
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Refresh silencioso — mantém sessão ativa
        } else if (event === 'USER_UPDATED' && session?.user) {
          const profile = await fetchProfile(session.user);
          setUser(profile);
        }
      } catch (err) {
        console.error('[AC.Prod] Erro no AuthStateChange:', err);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        if (!resolved || event === 'INITIAL_SESSION') {
          resolved = true;
          clearTimeout(hardTimeout);
          setIsLoadingAuth(false);
          setAuthChecked(true);
        }
      }
    });

    return () => {
      clearTimeout(hardTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // ─── checkUserAuth — compatibilidade com ProtectedRoute ──────────────────────
  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const profile = await fetchProfile(session.user);
        setUser(profile);
        setIsAuthenticated(true);
        setAuthError(null);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('[AC.Prod] checkUserAuth error:', error);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, [fetchProfile]);

  // ─── Login ────────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      const profile = await base44.auth.loginViaEmailPassword(email, password);
      setUser(profile);
      setIsAuthenticated(true);
      setAuthChecked(true);
      return profile;
    } catch (error) {
      setAuthError({
        type: 'invalid_credentials',
        message: error.message || 'Credenciais inválidas',
      });
      throw error;
    } finally {
      setIsLoadingAuth(false);
    }
  };

  // ─── Register ─────────────────────────────────────────────────────────────────
  const register = async ({ email, password, name }) => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);
      const result = await base44.auth.register({ email, password, name });
      return result;
    } catch (error) {
      setAuthError({
        type: 'registration_failed',
        message: error.message || 'Falha ao registrar',
      });
      throw error;
    } finally {
      setIsLoadingAuth(false);
    }
  };

  // ─── Logout ───────────────────────────────────────────────────────────────────
  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    setAuthChecked(true);
    await base44.auth.logout();
    if (shouldRedirect) {
      redirectTo('/login');
    }
  };

  const navigateToLogin = () => {
    redirectTo('/login');
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      authChecked,
      login,
      register,
      logout,
      navigateToLogin,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

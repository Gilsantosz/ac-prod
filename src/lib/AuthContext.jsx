import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { base44 } from '@/lib/localDb';

const AuthContext = createContext();

// ─── Helper: navega respeitando o basename /ac-prod/ ────────────────────────
const redirectTo = (path) => {
  const base = (import.meta.env.BASE_URL || '/ac-prod/').replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  window.location.replace(`${base}${cleanPath}`);
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // ─── Busca o perfil completo (com role e permissions da tabela profiles) ────
  const fetchProfile = useCallback(async (supabaseUser) => {
    if (!supabaseUser) return null;
    try {
      const profile = await base44.auth.me();
      return profile;
    } catch {
      // Perfil não existe ou erro de rede — usa metadados do Auth como fallback
      const meta = supabaseUser.user_metadata || {};
      return {
        id: supabaseUser.id,
        email: supabaseUser.email,
        name: meta.name || supabaseUser.email?.split('@')[0] || '',
        role: meta.role || 'operator',
        cell: meta.cell || '',
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

  // ─── Inicialização do estado de autenticação ─────────────────────────────────
  // Estratégia: getSession() como fonte primária (lê localStorage, instantâneo
  // para sessões válidas). onAuthStateChange() como listener de mudanças reativas.
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        // getSession() lê do localStorage. Se houver token expirado, tenta refresh
        // via rede (pode demorar). Limitamos a 4 segundos para evitar spinner eterno.
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 4000)
          ),
        ]);

        if (!isMounted) return;

        const session = sessionResult?.data?.session;

        if (session?.user) {
          const profile = await fetchProfile(session.user);
          if (!isMounted) return;
          setUser(profile);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('[AC.Prod] Erro ao inicializar sessão:', err);
        if (isMounted) {
          setUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (isMounted) {
          setIsLoadingAuth(false);
          setAuthChecked(true);
        }
      }
    };

    initAuth();

    // Listener reativo para mudanças APÓS a inicialização:
    // SIGNED_IN → usuário fez login (após a tela de login)
    // SIGNED_OUT → usuário saiu
    // TOKEN_REFRESHED → refresh silencioso de token
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        try {
          const profile = await fetchProfile(session.user);
          if (!isMounted) return;
          setUser(profile);
          setIsAuthenticated(true);
          setAuthError(null);
        } catch (err) {
          console.error('[AC.Prod] Erro ao carregar perfil após login:', err);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsAuthenticated(false);
      } else if (event === 'USER_UPDATED' && session?.user) {
        try {
          const profile = await fetchProfile(session.user);
          if (isMounted) setUser(profile);
        } catch { /* silencioso */ }
      }
      // TOKEN_REFRESHED: gerenciado automaticamente pelo cliente Supabase
    });

    return () => {
      isMounted = false;
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
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
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
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
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
    try {
      await supabase.auth.signOut();
    } catch { /* silencioso — sessão local já foi limpa */ }
    if (shouldRedirect) {
      redirectTo('/login');
    }
  };

  const navigateToLogin = () => redirectTo('/login');

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

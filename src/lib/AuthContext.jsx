import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { base44 } from '@/lib/localDb';

const AuthContext = createContext();

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
      // Se o perfil não existe ainda, retorna dados básicos do Auth
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

  // ─── Listener reativo de sessão Supabase ─────────────────────────────────────
  useEffect(() => {
    setIsLoadingAuth(true);

    // Verifica sessão existente de forma ultra-robusta
    supabase.auth.getSession().then(async ({ data }) => {
      try {
        const session = data?.session;
        if (session?.user) {
          const profile = await fetchProfile(session.user);
          setUser(profile);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('Erro ao buscar perfil inicial:', err);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    }).catch(err => {
      console.error('Erro ao buscar sessão inicial:', err);
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    });

    // Escuta mudanças de sessão (login, logout, refresh de token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (event === 'SIGNED_IN' && session?.user) {
          const profile = await fetchProfile(session.user);
          setUser(profile);
          setIsAuthenticated(true);
          setAuthError(null);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setIsAuthenticated(false);
        } else if (event === 'TOKEN_REFRESHED' && session?.user) {
          // Silently refresh — mantém o usuário logado
        }
      } catch (err) {
        console.error('Erro no tratador onAuthStateChange:', err);
      } finally {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // ─── checkUserAuth para compatibilidade com componentes existentes ────────────
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
      window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
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

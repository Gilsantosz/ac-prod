import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { clearPersistedAuthSession, persistAuthSession, restoreAuthSession, supabase } from '@/lib/supabaseClient';
import { base44 } from '@/lib/localDb';
import { navTo } from '@/lib/navigation';
import { getDefaultPermissions } from '@/config/appRoutes';

const AuthContext = createContext();
const AUTH_STEP_TIMEOUT_MS = 3000;
const AUTH_INIT_TIMEOUT_MS = 5000;

const withTimeout = (promise, timeoutMs, fallback) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
]);

const redirectTo = (path) => {
  navTo(path);
};

const profileAccessError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const isAccessDeniedError = (error) => ['USER_NOT_REGISTERED', 'USER_INACTIVE'].includes(error?.code);


const resolveSessionUser = async (session) => {
  if (!session?.user) return { user: null, shouldSignOut: false };

  const userResult = await withTimeout(
    supabase.auth.getUser(),
    AUTH_STEP_TIMEOUT_MS,
    { data: { user: null }, error: { message: 'Timeout' } },
  );

  if (userResult?.data?.user && !userResult?.error) {
    return { user: userResult.data.user, shouldSignOut: false };
  }

  if (userResult?.error?.message === 'Timeout') {
    console.warn('[Leo Flow] Validação remota da sessão demorou; usando sessão local.');
    return { user: session.user, shouldSignOut: false };
  }

  return { user: null, shouldSignOut: true };
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
      // Busca o perfil com timeout de 4 segundos para evitar travamento em redes lentas
      const { data: profile, error } = await withTimeout(
        supabase
          .from('profiles')
          .select('*')
          .eq('id', supabaseUser.id)
          .maybeSingle(),
        AUTH_STEP_TIMEOUT_MS,
        { data: null, error: { message: 'Timeout', code: 'TIMEOUT' } },
      );

      if (error?.code === 'TIMEOUT') {
        throw profileAccessError('PROFILE_UNAVAILABLE', 'Não foi possível validar seu acesso agora. Tente novamente.');
      }
      if (error) throw error;
      if (!profile) {
        throw profileAccessError('USER_NOT_REGISTERED', 'Este e-mail ainda não foi cadastrado pelo administrador.');
      }
      if (profile.active === false) {
        throw profileAccessError('USER_INACTIVE', 'Esta conta está desativada. Procure o administrador.');
      }

      const userRole = profile.role;
      return {
        id: supabaseUser.id,
        email: profile.email || supabaseUser.email,
        name: profile.name,
        role: userRole,
        cell: profile.cell || '',
        permissions: profile.permissions || getDefaultPermissions(userRole),
        dashboard_layout: profile.dashboard_layout || null,
        managed_cells: profile.managed_cells || [],
        report_delivery_enabled: profile.report_delivery_enabled === true,
        receives_daily_report: profile.receives_daily_report === true,
        active: true,
      };

    } catch (err) {
      console.error('[Leo Flow] Erro no catch de fetchProfile:', err);
      throw err;
    }
  }, []);

  const rejectUnauthorizedSession = useCallback(async (error) => {
    clearPersistedAuthSession();
    setUser(null);
    setIsAuthenticated(false);
    setAuthError({
      type: isAccessDeniedError(error) ? 'user_not_registered' : 'auth_required',
      message: error?.message || 'Não foi possível validar o acesso.',
    });
    await withTimeout(supabase.auth.signOut(), AUTH_STEP_TIMEOUT_MS, null);
  }, []);

  // ─── Inicialização do estado de autenticação ─────────────────────────────────
  // Estratégia: getSession() como fonte primária (lê localStorage, instantâneo
  // para sessões válidas). onAuthStateChange() como listener de mudanças reativas.
  useEffect(() => {
    let isMounted = true;
    let initTimedOut = false;
    const authEventTimers = new Set();

    const initFailSafe = setTimeout(() => {
      if (!isMounted) return;
      initTimedOut = true;
      clearPersistedAuthSession();
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }, AUTH_INIT_TIMEOUT_MS);

    const initAuth = async () => {
      try {
        // getSession() lê do localStorage. Se houver token expirado, tenta refresh
        // via rede (pode demorar). Limitamos a 4 segundos para evitar spinner eterno.
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          AUTH_STEP_TIMEOUT_MS,
          { data: { session: null }, timedOut: true },
        );

        if (!isMounted || initTimedOut) return;

        let session = sessionResult?.data?.session;
        if (!session && !sessionResult?.timedOut) {
          session = await withTimeout(restoreAuthSession(), AUTH_STEP_TIMEOUT_MS, null);
        }

        if (!isMounted || initTimedOut) return;

        if (session?.user) {
          const { user, shouldSignOut } = await resolveSessionUser(session);

          if (!isMounted || initTimedOut) return;

          if (user) {
            try {
              const profile = await fetchProfile(user);
              if (!isMounted || initTimedOut) return;
              setUser(profile);
              setIsAuthenticated(true);
              setAuthError(null);
            } catch (profileError) {
              if (isMounted) await rejectUnauthorizedSession(profileError);
            }
          } else if (shouldSignOut) {
            // Sessão inválida no servidor — limpa localmente
            if (isMounted) {
              setUser(null);
              setIsAuthenticated(false);
            }
            clearPersistedAuthSession();
            await withTimeout(supabase.auth.signOut(), AUTH_STEP_TIMEOUT_MS, null);
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('[Leo Flow] Erro ao inicializar sessão:', err);
        if (isMounted) {
          setUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        clearTimeout(initFailSafe);
        if (isMounted && !initTimedOut) {
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      const timer = setTimeout(async () => {
        authEventTimers.delete(timer);
        if (!isMounted) return;

        if (event === 'SIGNED_IN' && session?.user) {
          try {
            const profile = await fetchProfile(session.user);
            if (!isMounted) return;
            persistAuthSession(session);
            setUser(profile);
            setIsAuthenticated(true);
            setAuthError(null);
          } catch (err) {
            console.error('[Leo Flow] Erro ao carregar perfil após login:', err);
            if (isMounted) await rejectUnauthorizedSession(err);
          }
        } else if (event === 'SIGNED_OUT') {
          clearPersistedAuthSession();
          setUser(null);
          setIsAuthenticated(false);
        } else if (event === 'USER_UPDATED' && session?.user) {
          try {
            const profile = await fetchProfile(session.user);
            if (isMounted) setUser(profile);
          } catch { /* silencioso */ }
        }
        if (event === 'TOKEN_REFRESHED' && session) persistAuthSession(session);
      }, 0);
      authEventTimers.add(timer);
    });

    return () => {
      isMounted = false;
      clearTimeout(initFailSafe);
      authEventTimers.forEach((timer) => clearTimeout(timer));
      subscription.unsubscribe();
    };
  }, [fetchProfile, rejectUnauthorizedSession]);

  // ─── checkUserAuth — compatibilidade com ProtectedRoute ──────────────────────
  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const sessionResult = await withTimeout(
        supabase.auth.getSession(),
        AUTH_STEP_TIMEOUT_MS,
        { data: { session: null }, timedOut: true },
      );
      const session = sessionResult?.data?.session;
      const restoredSession = session || (!sessionResult?.timedOut
        ? await withTimeout(restoreAuthSession(), AUTH_STEP_TIMEOUT_MS, null)
        : null);
      if (restoredSession?.user) {
        const { user, shouldSignOut } = await resolveSessionUser(restoredSession);

        if (user) {
          try {
            const profile = await fetchProfile(user);
            setUser(profile);
            setIsAuthenticated(true);
            setAuthError(null);
          } catch (profileError) {
            await rejectUnauthorizedSession(profileError);
          }
        } else if (shouldSignOut) {
          setUser(null);
          setIsAuthenticated(false);
          clearPersistedAuthSession();
          await withTimeout(supabase.auth.signOut(), AUTH_STEP_TIMEOUT_MS, null);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('[Leo Flow] checkUserAuth error:', error);
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, [fetchProfile, rejectUnauthorizedSession]);

  // ─── Login ────────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const profile = await withTimeout(
        base44.auth.loginViaEmailPassword(email, password),
        10000,
        null,
      );
      if (!profile) throw new Error('O servidor demorou para responder. Tente novamente.');
      setUser(profile);
      setIsAuthenticated(true);
      setAuthChecked(true);
      return profile;
    } catch (error) {
      setAuthError({
        type: isAccessDeniedError(error) ? 'user_not_registered' : 'invalid_credentials',
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
    setAuthError(null);
    setAuthChecked(true);
    try {
      clearPersistedAuthSession();
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

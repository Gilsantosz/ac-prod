import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { clearPersistedAuthSession, persistAuthSession, restoreAuthSession, supabase } from '@/lib/supabaseClient';
import { base44 } from '@/lib/localDb';
import { navTo } from '@/lib/navigation';
import { clearOperatorSession } from '@/lib/operatorSessionService';
import {
  clearProfileRequestState,
  fetchProfileSingleFlight,
  getCachedProfile,
  invalidateProfileCache,
  isAccessDeniedError,
  isDefinitiveSessionError,
  isTransientAuthError,
  retryDelay,
} from '@/lib/authResilience';
import { createAuthCorrelationId, measureAuthStep, recordAuthMetric } from '@/lib/authTelemetry';
import {
  clearSessionActivity,
  getLastSessionActivity,
  isSessionInactive,
  recordSessionActivity,
  SESSION_ACTIVITY_STORAGE_KEY,
  SESSION_INACTIVITY_MS,
} from '@/lib/sessionActivity';

const AuthContext = createContext();
const AUTH_STEP_TIMEOUT_MS = 8000;
const AUTH_INIT_TIMEOUT_MS = 12000;

export const AUTH_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  AUTHENTICATED: 'authenticated',
  PROFILE_LOADING: 'profile_loading',
  PROFILE_DEGRADED: 'profile_degraded',
  RECONNECTING: 'reconnecting',
  UNAUTHORIZED: 'unauthorized',
  SIGNED_OUT: 'signed_out',
});

const withTimeout = (promise, timeoutMs, fallback) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
]);

const redirectTo = (path) => {
  navTo(path);
};

const resolveSessionUser = async (session) => {
  if (!session?.user) return { user: null, shouldSignOut: false };

  let userResult;
  try {
    userResult = await supabase.auth.getUser();
  } catch (error) {
    if (isTransientAuthError(error)) return { user: session.user, shouldSignOut: false };
    return { user: null, shouldSignOut: isDefinitiveSessionError(error) };
  }

  if (userResult?.data?.user && !userResult?.error) {
    return { user: userResult.data.user, shouldSignOut: false };
  }

  if (isTransientAuthError(userResult?.error)) {
    console.warn('[Auth] Validação remota temporariamente indisponível; usando sessão válida local.');
    return { user: session.user, shouldSignOut: false };
  }

  return { user: null, shouldSignOut: isDefinitiveSessionError(userResult?.error) };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authStatus, setAuthStatus] = useState(AUTH_STATES.INITIALIZING);
  const authGeneration = useRef(0);
  const profileRetry = useRef({ timer: null, attempt: 0 });

  const cancelProfileRetry = useCallback(() => {
    if (profileRetry.current.timer) clearTimeout(profileRetry.current.timer);
    profileRetry.current = { timer: null, attempt: 0 };
  }, []);

  // ─── Busca o perfil completo (com role e permissions da tabela profiles) ────
  const fetchProfile = useCallback((supabaseUser, options = {}) => (
    fetchProfileSingleFlight(supabase, supabaseUser, options)
  ), []);

  const rejectUnauthorizedSession = useCallback(async (error) => {
    authGeneration.current += 1;
    cancelProfileRetry();
    clearProfileRequestState();
    clearPersistedAuthSession();
    clearSessionActivity();
    setUser(null);
    setIsAuthenticated(false);
    setAuthStatus(AUTH_STATES.UNAUTHORIZED);
    setAuthError({
      type: isAccessDeniedError(error) ? 'user_not_registered' : 'auth_required',
      message: error?.message || 'Não foi possível validar o acesso.',
    });
    await withTimeout(clearOperatorSession(), AUTH_STEP_TIMEOUT_MS, null);
    await withTimeout(supabase.auth.signOut({ scope: 'local' }), AUTH_STEP_TIMEOUT_MS, null);
  }, [cancelProfileRetry]);

  const expireInactiveSession = useCallback(async ({ redirect = true } = {}) => {
    authGeneration.current += 1;
    cancelProfileRetry();
    clearProfileRequestState();
    clearPersistedAuthSession();
    clearSessionActivity();
    setUser(null);
    setIsAuthenticated(false);
    setAuthStatus(AUTH_STATES.SIGNED_OUT);
    setAuthChecked(true);
    setAuthError({
      type: 'inactivity_logout',
      message: 'Sessão encerrada após 30 minutos sem atividade. Digite suas credenciais para continuar.',
    });

    await withTimeout(clearOperatorSession(), AUTH_STEP_TIMEOUT_MS, null);
    await withTimeout(supabase.auth.signOut({ scope: 'local' }), AUTH_STEP_TIMEOUT_MS, null);
    if (redirect) redirectTo('/login');
  }, [cancelProfileRetry]);

  const validateProfileSession = useCallback(async (session, options = {}) => {
    if (!session?.user) return null;
    const correlationId = options.correlationId || createAuthCorrelationId();
    const generation = options.generation ?? authGeneration.current;
    persistAuthSession(session);
    if (session.access_token && typeof supabase.realtime?.setAuth === 'function') {
      try {
        await measureAuthStep(correlationId, 'realtime_set_auth', () => (
          supabase.realtime.setAuth(session.access_token)
        ));
      } catch (error) {
        recordAuthMetric({ correlationId, step: 'realtime_set_auth', result: 'degraded', error });
      }
    }
    if (generation !== authGeneration.current) return null;

    setAuthStatus(AUTH_STATES.PROFILE_LOADING);
    setIsAuthenticated(true);
    setAuthError(null);
    try {
      const profile = await fetchProfile(session.user, {
        force: options.force === true,
        correlationId,
      });
      if (generation !== authGeneration.current) return null;
      cancelProfileRetry();
      recordSessionActivity();
      recordAuthMetric({ correlationId, step: 'permissions_loaded', result: 'success' });
      setUser(profile);
      setIsAuthenticated(true);
      setAuthStatus(AUTH_STATES.AUTHENTICATED);
      setAuthError(null);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      recordAuthMetric({ correlationId, step: 'auth_provider_complete', result: 'success' });
      return profile;
    } catch (error) {
      if (generation !== authGeneration.current) return null;
      if (isAccessDeniedError(error)) {
        await rejectUnauthorizedSession(error);
        return null;
      }
      if (!isTransientAuthError(error) && error?.code !== 'PROFILE_UNAVAILABLE') throw error;

      const cachedProfile = getCachedProfile(session.user.id, { allowExpired: true });
      if (cachedProfile) setUser(cachedProfile);
      setIsAuthenticated(true);
      setAuthStatus(cachedProfile ? AUTH_STATES.PROFILE_DEGRADED : AUTH_STATES.RECONNECTING);
      setAuthError(null);
      setAuthChecked(true);
      setIsLoadingAuth(false);
      recordAuthMetric({ correlationId, step: 'auth_provider_complete', result: 'degraded', error });

      const attempt = profileRetry.current.attempt;
      profileRetry.current.attempt += 1;
      profileRetry.current.timer = setTimeout(() => {
        profileRetry.current.timer = null;
        validateProfileSession(session, {
          correlationId,
          generation,
          force: true,
        }).catch((retryError) => {
          console.warn('[Auth] Nova tentativa de perfil falhou:', retryError?.code || retryError?.message);
        });
      }, retryDelay(attempt));
      return cachedProfile;
    }
  }, [cancelProfileRetry, fetchProfile, rejectUnauthorizedSession]);

  // ─── Inicialização do estado de autenticação ─────────────────────────────────
  // Estratégia: getSession() como fonte primária (lê localStorage, instantâneo
  // para sessões válidas). onAuthStateChange() como listener de mudanças reativas.
  useEffect(() => {
    let isMounted = true;
    let initTimedOut = false;
    const authEventTimers = new Set();
    const generation = ++authGeneration.current;
    const correlationId = createAuthCorrelationId();

    const initFailSafe = setTimeout(() => {
      if (!isMounted) return;
      initTimedOut = true;
      // Não apaga nem invalida uma sessão por indisponibilidade temporária.
      setAuthStatus(AUTH_STATES.RECONNECTING);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      recordAuthMetric({ correlationId, step: 'auth_initialization', result: 'degraded', error: { code: 'INIT_TIMEOUT' } });
    }, AUTH_INIT_TIMEOUT_MS);

    const initAuth = async () => {
      try {
        if (isSessionInactive()) {
          await expireInactiveSession({ redirect: false });
          return;
        }

        const sessionResult = await measureAuthStep(
          correlationId,
          'get_session',
          () => supabase.auth.getSession(),
        );

        if (!isMounted || generation !== authGeneration.current) return;

        let session = sessionResult?.data?.session;
        if (!session && !sessionResult?.error) {
          session = await restoreAuthSession({ correlationId });
        }

        if (!isMounted || generation !== authGeneration.current) return;

        if (session?.user) {
          const { user, shouldSignOut } = await resolveSessionUser(session);

          if (!isMounted || generation !== authGeneration.current) return;

          if (user) {
            await validateProfileSession({ ...session, user }, { correlationId, generation });
          } else if (shouldSignOut) {
            await rejectUnauthorizedSession(sessionResult?.error || { code: 'SESSION_INVALID' });
          } else {
            setIsAuthenticated(true);
            setAuthStatus(AUTH_STATES.RECONNECTING);
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
          setAuthStatus(AUTH_STATES.SIGNED_OUT);
        }
      } catch (err) {
        console.error('[Auth] Erro ao inicializar sessão:', err?.code || err?.message);
        if (isMounted) {
          if (isDefinitiveSessionError(err)) await rejectUnauthorizedSession(err);
          else setAuthStatus(AUTH_STATES.RECONNECTING);
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

        const eventCorrelationId = createAuthCorrelationId();
        if (event === 'SIGNED_IN' && session?.user) {
          await validateProfileSession(session, {
            correlationId: eventCorrelationId,
            generation: authGeneration.current,
          });
        } else if (event === 'SIGNED_OUT') {
          authGeneration.current += 1;
          cancelProfileRetry();
          clearProfileRequestState();
          clearPersistedAuthSession();
          clearSessionActivity();
          setUser(null);
          setIsAuthenticated(false);
          setAuthStatus(AUTH_STATES.SIGNED_OUT);
        } else if (event === 'USER_UPDATED' && session?.user) {
          invalidateProfileCache(session.user.id);
          await validateProfileSession(session, {
            correlationId: eventCorrelationId,
            generation: authGeneration.current,
            force: true,
          });
        } else if (event === 'TOKEN_REFRESHED' && session) {
          persistAuthSession(session);
          if (session.access_token && typeof supabase.realtime?.setAuth === 'function') {
            await measureAuthStep(eventCorrelationId, 'realtime_token_refreshed', () => (
              supabase.realtime.setAuth(session.access_token)
            ));
          }
          recordAuthMetric({ correlationId: eventCorrelationId, step: 'token_refreshed', result: 'success' });
        }
      }, 0);
      authEventTimers.add(timer);
    });

    return () => {
      isMounted = false;
      clearTimeout(initFailSafe);
      cancelProfileRetry();
      authEventTimers.forEach((timer) => clearTimeout(timer));
      subscription.unsubscribe();
    };
  }, [cancelProfileRetry, expireInactiveSession, rejectUnauthorizedSession, validateProfileSession]);

  // ─── Inatividade real: 30 minutos sem interação com o sistema ──────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    let logoutStarted = false;
    let lastActivityWrite = getLastSessionActivity() || 0;
    const activityWriteThrottleMs = 5000;

    const performIdleLogout = () => {
      if (logoutStarted) return;
      logoutStarted = true;
      expireInactiveSession();
    };

    const checkInactivity = () => {
      if (isSessionInactive()) {
        performIdleLogout();
        return true;
      }
      return false;
    };

    const markActivity = () => {
      if (logoutStarted || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastActivityWrite < activityWriteThrottleMs) return;
      lastActivityWrite = recordSessionActivity(now) || lastActivityWrite;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!checkInactivity()) {
        // Voltar à página é atividade. Fechar o PWA, ocultar a aba ou suspender
        // o computador não encerra a sessão antes dos 30 minutos.
        lastActivityWrite = recordSessionActivity() || lastActivityWrite;
      }
    };

    const handleStorage = (event) => {
      if (event.key === SESSION_ACTIVITY_STORAGE_KEY && checkInactivity()) {
        performIdleLogout();
      }
    };

    const activityEvents = [
      'pointerdown',
      'pointermove',
      'keydown',
      'touchstart',
      'wheel',
      'scroll',
    ];

    lastActivityWrite = recordSessionActivity() || lastActivityWrite;
    activityEvents.forEach((eventName) => {
      document.addEventListener(eventName, markActivity, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('popstate', markActivity);
    window.addEventListener('hashchange', markActivity);
    window.addEventListener('storage', handleStorage);

    const inactivityInterval = setInterval(checkInactivity, 15_000);

    return () => {
      clearInterval(inactivityInterval);
      activityEvents.forEach((eventName) => {
        document.removeEventListener(eventName, markActivity, { capture: true });
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('popstate', markActivity);
      window.removeEventListener('hashchange', markActivity);
      window.removeEventListener('storage', handleStorage);
    };
  }, [expireInactiveSession, isAuthenticated]);

  // ─── checkUserAuth — compatibilidade com ProtectedRoute ──────────────────────
  const checkUserAuth = useCallback(async () => {
    if (isLoadingAuth || [AUTH_STATES.PROFILE_LOADING, AUTH_STATES.RECONNECTING].includes(authStatus)) return;
    setIsLoadingAuth(true);
    const correlationId = createAuthCorrelationId();
    try {
      if (isSessionInactive()) {
        await expireInactiveSession();
        return;
      }

      const sessionResult = await measureAuthStep(
        correlationId,
        'get_session',
        () => supabase.auth.getSession(),
      );
      const session = sessionResult?.data?.session;
      const restoredSession = session || (!sessionResult?.error
        ? await restoreAuthSession({ correlationId })
        : null);
      if (restoredSession?.user) {
        const { user, shouldSignOut } = await resolveSessionUser(restoredSession);

        if (user) {
          await validateProfileSession(
            { ...restoredSession, user },
            { correlationId, generation: authGeneration.current },
          );
        } else if (shouldSignOut) {
          await rejectUnauthorizedSession(sessionResult?.error || { code: 'SESSION_INVALID' });
        } else {
          setIsAuthenticated(true);
          setAuthStatus(AUTH_STATES.RECONNECTING);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
        setAuthStatus(AUTH_STATES.SIGNED_OUT);
      }
    } catch (error) {
      console.error('[Auth] checkUserAuth error:', error?.code || error?.message);
      if (isDefinitiveSessionError(error)) await rejectUnauthorizedSession(error);
      else setAuthStatus(AUTH_STATES.RECONNECTING);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, [authStatus, expireInactiveSession, isLoadingAuth, rejectUnauthorizedSession, validateProfileSession]);

  // ─── Login ────────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    const correlationId = createAuthCorrelationId();
    const generation = ++authGeneration.current;
    cancelProfileRetry();
    recordAuthMetric({ correlationId, step: 'login_click', result: 'started' });
    setIsLoadingAuth(true);
    setAuthError(null);
    setAuthStatus(AUTH_STATES.INITIALIZING);
    try {
      const result = await measureAuthStep(
        correlationId,
        'sign_in_with_password',
        () => base44.auth.loginViaEmailPassword(email, password),
      );
      recordAuthMetric({ correlationId, step: 'token_response', result: 'success' });
      const profile = await validateProfileSession(result.session, { correlationId, generation });
      setAuthChecked(true);
      return profile;
    } catch (error) {
      if (isAccessDeniedError(error)) {
        await rejectUnauthorizedSession(error);
      } else {
        setAuthStatus(AUTH_STATES.SIGNED_OUT);
        setAuthError({
          type: 'invalid_credentials',
          message: error.message || 'Credenciais inválidas',
        });
      }
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
    authGeneration.current += 1;
    cancelProfileRetry();
    clearProfileRequestState();
    setUser(null);
    setIsAuthenticated(false);
    setAuthStatus(AUTH_STATES.SIGNED_OUT);
    setAuthError(null);
    setAuthChecked(true);
    try {
      clearPersistedAuthSession();
      clearSessionActivity();
      await withTimeout(clearOperatorSession(), AUTH_STEP_TIMEOUT_MS, null);
      await supabase.auth.signOut({ scope: 'local' });
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
      authStatus,
      login,
      register,
      logout,
      navigateToLogin,
      checkUserAuth,
      sessionInactivityMs: SESSION_INACTIVITY_MS,
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

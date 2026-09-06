import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import {
  clearPersistedAuthSession, persistAuthSession, restoreAuthSession, supabase,
  lockAuthSession, unlockAuthSession, isAuthSessionLocked, getAuthSessionLock, AUTH_SESSION_LOCK_KEY,
  signInWithCredentials, waitForPendingAuthOperations,
  getPersistedAuthAccessToken, endBrowserAuthSession,
} from '@/lib/supabaseClient';
import { base44 } from '@/lib/localDb';
import { navTo } from '@/lib/navigation';
import { getDefaultPermissions } from '@/config/appRoutes';
import { clearOperatorSession, getOperatorSession } from '@/lib/operatorSessionService';
import {
  clearSessionActivity, getLastSessionActivity, isSessionInactive, recordSessionActivity,
  requestSessionActivity, SESSION_ACTIVITY_EVENT, SESSION_ACTIVITY_STORAGE_KEY,
} from '@/lib/sessionActivity';
import { getCachedSystemSettings, loadSystemSettings, subscribeSystemSettings } from '@/lib/systemSettingsService';
import { resolveSessionPolicy } from '@/lib/sessionPolicy';
import SessionTimeoutWarning from '@/components/auth/SessionTimeoutWarning';
import { isAuthAccessDeniedError, isInvalidAuthSessionError } from '@/lib/authErrors';

const AuthContext = createContext();
const AUTH_STEP_TIMEOUT_MS = 3000;
const AUTH_INIT_TIMEOUT_MS = 12000;
const withTimeout = (promise, timeoutMs, fallback) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(fallback), timeoutMs);
  Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
});
const profileAccessError = (code, message) => Object.assign(new Error(message), { code });
const isAccessDeniedError = isAuthAccessDeniedError;
const inactivityError = (minutes) => ({
  type: 'inactivity_logout',
  message: `Sessão encerrada após ${minutes} minuto(s) sem atividade. Digite suas credenciais para continuar. As coletas pendentes neste aparelho foram preservadas.`,
});

const pendingProfiles = new Map();
const readProfile = async (supabaseUser) => {
  if (!supabaseUser) return null;
  const { data: profile, error } = await withTimeout(
    supabase.from('profiles').select('*').eq('id', supabaseUser.id).maybeSingle(),
    AUTH_STEP_TIMEOUT_MS, { data: null, error: { code: 'TIMEOUT' } },
  );
  if (error?.code === 'TIMEOUT') throw profileAccessError('PROFILE_UNAVAILABLE', 'Não foi possível validar seu acesso agora. Tente novamente.');
  if (error) throw error;
  if (!profile) throw profileAccessError('USER_NOT_REGISTERED', 'Este e-mail ainda não foi cadastrado pelo administrador.');
  if (profile.active === false) throw profileAccessError('USER_INACTIVE', 'Esta conta está desativada. Procure o administrador.');
  return {
    id: supabaseUser.id, email: profile.email || supabaseUser.email, name: profile.name,
    role: profile.role, cell: profile.cell || '',
    permissions: profile.permissions || getDefaultPermissions(profile.role),
    dashboard_layout: profile.dashboard_layout || null, managed_cells: profile.managed_cells || [],
    report_delivery_enabled: profile.report_delivery_enabled === true,
    receives_daily_report: profile.receives_daily_report === true, active: true,
  };
};

// SIGNED_IN is also emitted when a tab regains focus. Coalesce concurrent
// checks, but do not cache authorization: a completed check must see revocation.
const fetchProfile = (supabaseUser, generation) => {
  if (!supabaseUser?.id) return Promise.resolve(null);
  const key = `${supabaseUser.id}:${generation}`;
  if (pendingProfiles.has(key)) return pendingProfiles.get(key);
  const pending = readProfile(supabaseUser).finally(() => {
    if (pendingProfiles.get(key) === pending) pendingProfiles.delete(key);
  });
  pendingProfiles.set(key, pending);
  return pending;
};

const resolveSessionUser = async (session) => {
  if (!session?.user) return { user: null, shouldSignOut: false };
  const result = await withTimeout(supabase.auth.getUser(), AUTH_STEP_TIMEOUT_MS,
    { data: { user: null }, error: { code: 'TIMEOUT' } });
  if (result?.data?.user && !result.error) return { user: result.data.user, shouldSignOut: false };
  if (isInvalidAuthSessionError(result?.error) || isAccessDeniedError(result?.error)) {
    return { user: null, shouldSignOut: true };
  }
  // Never accept an unvalidated profile on startup, nor revoke a working
  // session solely because Auth is slow/offline/rate-limited.
  throw result?.error || profileAccessError('AUTH_UNAVAILABLE', 'Validação de sessão indisponível.');
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(() => getAuthSessionLock()?.reason === 'inactivity'
    ? { type: 'inactivity_logout', message: 'Sessão encerrada por inatividade. Digite suas credenciais para continuar.' } : null);
  const [authConnectionError, setAuthConnectionError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [settings, setSettings] = useState(() => getCachedSystemSettings());
  const [operatorSession, setOperatorSession] = useState(() => getOperatorSession());
  const [warningSeconds, setWarningSeconds] = useState(null);
  const generationRef = useRef(0);
  const userRef = useRef(null);
  const settingsRef = useRef(settings);
  const mountedRef = useRef(true);
  const initializingRef = useRef(true);
  const loginPendingRef = useRef(false);
  const logoutTaskRef = useRef(null);
  const authCheckInFlightRef = useRef(false);
  const checkInactivityRef = useRef(() => false);
  const policy = resolveSessionPolicy(settings, user, operatorSession);
  const policyRef = useRef(policy);
  policyRef.current = policy;

  const endSession = useCallback((reason = 'logout', { redirect = true, error = null } = {}) => {
    const accessToken = getPersistedAuthAccessToken();
    generationRef.current += 1;
    loginPendingRef.current = false;
    lockAuthSession(reason);
    clearPersistedAuthSession();
    clearSessionActivity();
    checkInactivityRef.current = () => true;
    userRef.current = null;
    setUser(null);
    setIsAuthenticated(false);
    setIsLoadingAuth(false);
    setAuthChecked(true);
    setWarningSeconds(null);
    setAuthConnectionError(null);
    setAuthError(error || (reason === 'inactivity' ? inactivityError(policyRef.current.timeoutMinutes) : null));
    // O operador desaparece imediatamente. Nenhuma fila IndexedDB é apagada.
    const operatorLogout = clearOperatorSession();
    const authLogout = endBrowserAuthSession(accessToken);
    const task = Promise.allSettled([operatorLogout, authLogout]);
    logoutTaskRef.current = task;
    task.finally(() => { if (logoutTaskRef.current === task) logoutTaskRef.current = null; });
    if (redirect) navTo('/login');
    return withTimeout(task, AUTH_STEP_TIMEOUT_MS, null);
  }, []);
  const expireInactiveSession = useCallback((options) => endSession('inactivity', options), [endSession]);
  const alignSessionIdentity = useCallback((session) => {
    if (userRef.current && session?.user?.id && userRef.current.id !== session.user.id) {
      // A different account never inherits the last account's validated profile
      // while its own validation is unavailable. Cancel any older profile read.
      generationRef.current += 1;
      userRef.current = null;
      setUser(null);
      setIsAuthenticated(false);
      void clearOperatorSession({ notifyServer: false });
    }
    return generationRef.current;
  }, []);
  const rejectUnauthorizedSession = useCallback((error) => {
    if (!isAccessDeniedError(error) && !isInvalidAuthSessionError(error)) {
      const connectionError = { type: 'auth_unavailable',
        message: 'Conexão de autenticação temporariamente indisponível. Tentando novamente sem apagar sua sessão ou coletas pendentes.',
      };
      setAuthConnectionError(connectionError);
      // ProtectedRoute and Realtime treat authError as a blocking error.
      // Keep an already validated workstation mounted during retry.
      if (!userRef.current) setAuthError(connectionError);
      return Promise.resolve(null);
    }
    return endSession('access_denied', {
      redirect: false, error: {
        type: isAccessDeniedError(error) ? 'user_not_registered' : 'auth_required',
        message: error?.message || 'Não foi possível validar o acesso.',
      },
    });
  }, [endSession]);

  const commitSession = useCallback(async (profile, session, generation, { freshLogin = false } = {}) => {
    const loaded = await withTimeout(loadSystemSettings().catch(() => settingsRef.current),
      AUTH_STEP_TIMEOUT_MS, settingsRef.current);
    if (!mountedRef.current || generation !== generationRef.current || isAuthSessionLocked()) return null;
    if (loaded) { settingsRef.current = loaded; setSettings(loaded); }
    const nextPolicy = resolveSessionPolicy(loaded || settingsRef.current, profile, getOperatorSession());
    policyRef.current = nextPolicy;
    // A regra configurada/cacheada é resolvida antes de restaurar a tela.
    if (!freshLogin && isSessionInactive(Date.now(), nextPolicy.timeoutMs)) {
      await expireInactiveSession({ redirect: false });
      return null;
    }
    if (freshLogin || !getLastSessionActivity()) recordSessionActivity();
    persistAuthSession(session);
    userRef.current = profile;
    setUser(profile);
    setIsAuthenticated(true);
    setAuthError(null);
    setAuthConnectionError(null);
    return profile;
  }, [expireInactiveSession]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let timedOut = false;
    const generation = generationRef.current;
    const eventTimers = new Set();
    const isCurrent = (expected = generation) => active && !timedOut
      && generationRef.current === expected && !isAuthSessionLocked();
    const failSafe = setTimeout(() => {
      if (!active) return;
      timedOut = true;
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }, AUTH_INIT_TIMEOUT_MS);
    const initialize = async () => {
      try {
        if (isAuthSessionLocked()) return;
        const result = await withTimeout(supabase.auth.getSession(), AUTH_STEP_TIMEOUT_MS,
          { data: { session: null }, timedOut: true });
        if (!isCurrent()) return;
        if (result?.timedOut || result?.error) throw result.error || { code: 'TIMEOUT' };
        const session = result?.data?.session || (!result?.timedOut
          ? await withTimeout(restoreAuthSession(), AUTH_STEP_TIMEOUT_MS, null) : null);
        if (!isCurrent()) return;
        if (!session?.user) {
          if (getPersistedAuthAccessToken()) throw { code: 'AUTH_UNAVAILABLE' };
          return;
        }
        const resolved = await resolveSessionUser(session);
        if (!isCurrent()) return;
        if (resolved.shouldSignOut) { await endSession('invalid_session', { redirect: false }); return; }
        if (resolved.user) {
          const profile = await fetchProfile(resolved.user, generation);
          if (isCurrent()) await commitSession(profile, session, generation);
        }
      } catch (error) {
        if (isCurrent()) await rejectUnauthorizedSession(error);
      } finally {
        clearTimeout(failSafe);
        initializingRef.current = false;
        if (active) { setIsLoadingAuth(false); setAuthChecked(true); }
      }
    };
    initialize();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Invalida antes de qualquer callback assíncrono já enfileirado.
      if (event === 'SIGNED_OUT' && !isAuthSessionLocked()) {
        generationRef.current += 1;
        lockAuthSession('logout');
      }
      if (event === 'SIGNED_IN' && !loginPendingRef.current && !isAuthSessionLocked()) {
        alignSessionIdentity(session);
      }
      const eventGeneration = generationRef.current;
      const loginInProgress = loginPendingRef.current;
      const initializationInProgress = initializingRef.current;
      const timer = setTimeout(async () => {
        eventTimers.delete(timer);
        if (!active || eventGeneration !== generationRef.current) return;
        if (event === 'SIGNED_OUT') {
          clearPersistedAuthSession();
          clearSessionActivity();
          userRef.current = null;
          setUser(null);
          setIsAuthenticated(false);
          setWarningSeconds(null);
          setAuthConnectionError(null);
          void clearOperatorSession({ notifyServer: false });
          return;
        }
        if (isAuthSessionLocked()) { clearPersistedAuthSession(); return; }
        if (event === 'TOKEN_REFRESHED' && session) persistAuthSession(session);
        // SIGNED_IN de foco/refresh nunca conta como interação.
        if (loginInProgress || initializationInProgress) return;
        if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user) {
          try {
            const profile = await fetchProfile(session.user, eventGeneration);
            if (isCurrent(eventGeneration)) await commitSession(profile, session, eventGeneration);
          } catch (error) {
            if (isCurrent(eventGeneration)) await rejectUnauthorizedSession(error);
          }
        }
      }, 0);
      eventTimers.add(timer);
    });
    return () => {
      active = false;
      mountedRef.current = false;
      clearTimeout(failSafe);
      eventTimers.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, [alignSessionIdentity, commitSession, endSession, rejectUnauthorizedSession]);

  useEffect(() => {
    const rejectUnauthenticatedCapture = (event) => {
      if (!userRef.current || isAuthSessionLocked()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const updateSettings = (next) => {
      const config = next || getCachedSystemSettings();
      if (!config) return;
      settingsRef.current = config;
      policyRef.current = resolveSessionPolicy(config, userRef.current, getOperatorSession());
      setSettings(config);
      checkInactivityRef.current();
    };
    const updateOperator = () => {
      const current = getOperatorSession();
      policyRef.current = resolveSessionPolicy(settingsRef.current, userRef.current, current);
      setOperatorSession(current);
      checkInactivityRef.current();
    };
    const unsubscribe = subscribeSystemSettings(updateSettings);
    window.addEventListener(SESSION_ACTIVITY_EVENT, rejectUnauthenticatedCapture);
    window.addEventListener('operator-session-changed', updateOperator);
    return () => {
      unsubscribe();
      window.removeEventListener(SESSION_ACTIVITY_EVENT, rejectUnauthenticatedCapture);
      window.removeEventListener('operator-session-changed', updateOperator);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let active = true;
    let inFlight = false;
    let lastFetch = Date.now();
    const refreshSettings = async () => {
      if (inFlight || !active || document.visibilityState !== 'visible'
        || navigator.onLine === false || Date.now() - lastFetch < 5000) return;
      lastFetch = Date.now();
      inFlight = true;
      try { await loadSystemSettings({ force: true }); }
      catch { /* Continua com a política em cache durante falhas de rede. */ }
      finally { inFlight = false; }
    };
    const timer = setInterval(refreshSettings, 60_000);
    window.addEventListener('online', refreshSettings);
    window.addEventListener('focus', refreshSettings);
    document.addEventListener('visibilitychange', refreshSettings);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', refreshSettings);
      window.removeEventListener('focus', refreshSettings);
      document.removeEventListener('visibilitychange', refreshSettings);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let stopped = false;
    let lastActivityWrite = getLastSessionActivity() || 0;
    const check = () => {
      if (stopped) return true;
      if (isAuthSessionLocked()) {
        stopped = true;
        void endSession(getAuthSessionLock()?.reason || 'logout');
        return true;
      }
      const currentPolicy = policyRef.current;
      if (isSessionInactive(Date.now(), currentPolicy.timeoutMs)) {
        stopped = true;
        void expireInactiveSession();
        return true;
      }
      const remaining = Math.ceil((currentPolicy.timeoutMs - (Date.now() - (getLastSessionActivity() || Date.now()))) / 1000);
      setWarningSeconds(remaining > 0 && remaining <= currentPolicy.warningSeconds ? remaining : null);
      return false;
    };
    const markActivity = (event) => {
      if (check()) {
        event?.preventDefault?.();
        event?.stopImmediatePropagation?.();
        return;
      }
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastActivityWrite < 1000) return;
      lastActivityWrite = recordSessionActivity(now) || lastActivityWrite;
      setWarningSeconds(null);
    };
    const handleStorage = (event) => {
      if (event.key === SESSION_ACTIVITY_STORAGE_KEY || event.key === AUTH_SESSION_LOCK_KEY) check();
    };
    // Capturas e ações físicas renovam o prazo; foco/consultas/refresh só verificam.
    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
    activityEvents.forEach((name) => document.addEventListener(name, markActivity, { capture: true }));
    window.addEventListener(SESSION_ACTIVITY_EVENT, markActivity);
    window.addEventListener('focus', check);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', check);
    checkInactivityRef.current = check;
    check();
    const timer = setInterval(check, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      checkInactivityRef.current = () => false;
      activityEvents.forEach((name) => document.removeEventListener(name, markActivity, { capture: true }));
      window.removeEventListener(SESSION_ACTIVITY_EVENT, markActivity);
      window.removeEventListener('focus', check);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', check);
    };
  }, [endSession, expireInactiveSession, isAuthenticated]);

  const checkUserAuth = useCallback(async () => {
    let generation = generationRef.current;
    if (authCheckInFlightRef.current || isAuthSessionLocked() || checkInactivityRef.current()) return;
    authCheckInFlightRef.current = true;
    // Background recovery must not unmount the active workstation/scanner.
    if (!userRef.current) setIsLoadingAuth(true);
    try {
      const result = await withTimeout(supabase.auth.getSession(), AUTH_STEP_TIMEOUT_MS,
        { data: { session: null }, timedOut: true });
      if (result?.timedOut || result?.error) throw result.error || { code: 'TIMEOUT' };
      const session = result?.data?.session || (!result?.timedOut
        ? await withTimeout(restoreAuthSession(), AUTH_STEP_TIMEOUT_MS, null) : null);
      if (generation !== generationRef.current || isAuthSessionLocked()) return;
      if (!session?.user && getPersistedAuthAccessToken()) throw { code: 'AUTH_UNAVAILABLE' };
      generation = alignSessionIdentity(session);
      const resolved = await resolveSessionUser(session);
      if (generation !== generationRef.current || isAuthSessionLocked()) return;
      if (resolved.shouldSignOut) await endSession('invalid_session');
      else if (resolved.user) {
        const profile = await fetchProfile(resolved.user, generation);
        await commitSession(profile, session, generation);
      }
    } catch (error) {
      if (generation === generationRef.current && !isAuthSessionLocked()) await rejectUnauthorizedSession(error);
    } finally {
      authCheckInFlightRef.current = false;
      if (mountedRef.current) { setIsLoadingAuth(false); setAuthChecked(true); }
    }
  }, [alignSessionIdentity, commitSession, endSession, rejectUnauthorizedSession]);

  useEffect(() => {
    if (authConnectionError?.type !== 'auth_unavailable') return undefined;
    let stopped = false;
    let timer;
    let delay = 5000;
    const retry = async () => {
      if (stopped || isAuthSessionLocked()) return;
      if (navigator.onLine !== false && document.visibilityState === 'visible') {
        await checkUserAuth();
      }
      if (!stopped) {
        delay = Math.min(delay * 2, 30_000);
        timer = setTimeout(retry, delay);
      }
    };
    timer = setTimeout(retry, delay);
    return () => { stopped = true; clearTimeout(timer); };
  }, [authConnectionError?.type, checkUserAuth]);

  const login = async (email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    const ready = await withTimeout(Promise.all([
      logoutTaskRef.current,
      waitForPendingAuthOperations(),
    ]).then(() => true), AUTH_STEP_TIMEOUT_MS, false);
    if (!ready) {
      setIsLoadingAuth(false);
      throw new Error('A sessão anterior ainda está sendo encerrada. Aguarde alguns segundos e tente novamente.');
    }
    const generation = ++generationRef.current;
    loginPendingRef.current = true;
    unlockAuthSession();
    try {
      const result = await withTimeout(signInWithCredentials(email, password), 10000, null);
      if (generation !== generationRef.current || isAuthSessionLocked()) throw new Error('A tentativa de login foi encerrada. Tente novamente.');
      if (!result) throw new Error('O servidor demorou para responder. Tente novamente.');
      if (result.error) throw new Error('E-mail ou senha incorretos.');
      const profile = await fetchProfile(result.data.user, generation);
      const accepted = await commitSession(profile, result.data.session, generation, { freshLogin: true });
      if (!accepted) throw new Error('A tentativa de login foi encerrada. Tente novamente.');
      setAuthChecked(true);
      return accepted;
    } catch (error) {
      if (generation === generationRef.current) {
        await endSession('login_failed', { redirect: false,
          error: { type: isAccessDeniedError(error) ? 'user_not_registered' : 'invalid_credentials', message: error.message || 'Credenciais inválidas' },
        });
      }
      throw error;
    } finally {
      loginPendingRef.current = false;
      if (mountedRef.current) setIsLoadingAuth(false);
    }
  };

  const register = async (data) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try { return await base44.auth.register(data); }
    catch (error) {
      setAuthError({ type: 'registration_failed', message: error.message || 'Falha ao registrar' });
      throw error;
    } finally { setIsLoadingAuth(false); }
  };
  const logout = (shouldRedirect = true) => endSession('logout', { redirect: shouldRedirect });
  const navigateToLogin = () => navTo('/login');
  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoadingAuth, authError, authConnectionError, authChecked,
      login, register, logout, navigateToLogin, checkUserAuth,
      sessionInactivityMs: policy.timeoutMs, sessionPolicy: policy,
    }}>
      {children}
      {isAuthenticated && <SessionTimeoutWarning seconds={warningSeconds}
        timeoutMinutes={policy.timeoutMinutes} onContinue={requestSessionActivity} />}
    </AuthContext.Provider>
  );
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

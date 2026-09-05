import { createClient } from '@supabase/supabase-js';

// ✅ SEGURO: Apenas a chave anon (pública) é usada no frontend.
// A SERVICE_ROLE_KEY nunca é usada aqui — toda autorização é controlada por RLS no PostgreSQL.
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(configuredSupabaseUrl && configuredSupabaseAnonKey);

// O cliente exige URL/chave não vazias ainda durante a carga do JavaScript.
// Os valores abaixo só impedem uma tela branca quando o .env ainda não existe;
// App.jsx interrompe o sistema antes de qualquer consulta e mostra a orientação.
const supabaseUrl = configuredSupabaseUrl || 'https://unconfigured-ac-prod.supabase.co';
const supabaseAnonKey = configuredSupabaseAnonKey || 'public-anon-key-not-configured';
const supabaseProjectRef = (() => {
  try { return new URL(supabaseUrl).hostname.split('.')[0]; }
  catch { return 'unconfigured'; }
})();
const AUTH_STORAGE_KEY = `ac-prod-auth-${supabaseProjectRef}`;
const FALLBACK_SESSION_KEY = `ac-prod-auth-fallback-${supabaseProjectRef}`;
export const AUTH_SESSION_LOCK_KEY = `ac-prod-auth-locked-${supabaseProjectRef}`;
const inMemoryAuthStorage = new Map();
let memoryAuthLock = null;
let memoryOnlyAuthLock = false;
let authSessionGeneration = 0;
const pendingAuthOperations = new Set();

function trackAuthOperation(operation) {
  const pending = Promise.resolve(operation);
  pendingAuthOperations.add(pending);
  pending.then(
    () => pendingAuthOperations.delete(pending),
    () => pendingAuthOperations.delete(pending),
  );
  return pending;
}

export const waitForPendingAuthRestoration = async () => {
  // Timeouts de interface não cancelam setSession/signInWithPassword no SDK.
  // Uma nova credencial só desbloqueia a persistência após ambos terminarem.
  while (pendingAuthOperations.size) await Promise.allSettled([...pendingAuthOperations]);
};
export const waitForPendingAuthOperations = waitForPendingAuthRestoration;

export const getAuthSessionLock = () => {
  try {
    const stored = window.localStorage?.getItem(AUTH_SESSION_LOCK_KEY);
    return stored ? JSON.parse(stored) : (memoryOnlyAuthLock ? memoryAuthLock : null);
  } catch { return memoryAuthLock; }
};

export const isAuthSessionLocked = () => Boolean(getAuthSessionLock());

// O bloqueio é deste navegador/projeto. Não revoga sessões de outros aparelhos.
export const lockAuthSession = (reason = 'logout') => {
  authSessionGeneration += 1;
  memoryAuthLock = { reason, at: Date.now() };
  try {
    window.localStorage?.setItem(AUTH_SESSION_LOCK_KEY, JSON.stringify(memoryAuthLock));
    memoryOnlyAuthLock = false;
  } catch { memoryOnlyAuthLock = true; }
};

// Somente uma tentativa explícita com credenciais pode remover o bloqueio.
export const unlockAuthSession = () => {
  authSessionGeneration += 1;
  memoryAuthLock = null;
  memoryOnlyAuthLock = false;
  try { window.localStorage?.removeItem(AUTH_SESSION_LOCK_KEY); }
  catch { /* fallback em memória */ }
};

const createBrowserAuthStorage = () => {
  if (typeof window === 'undefined') return undefined;

  return {
    getItem: (key) => {
      if ((key === AUTH_STORAGE_KEY || key === FALLBACK_SESSION_KEY) && isAuthSessionLocked()) return null;
      try {
        const stored = window.localStorage?.getItem(key);
        if (stored) return stored;
      } catch { /* fallback em memória */ }

      // Migra silenciosamente a sessão da versão anterior, que usava
      // sessionStorage e era perdida ao fechar o navegador/PWA.
      try {
        const legacyTabSession = window.sessionStorage?.getItem(key);
        if (legacyTabSession) {
          window.localStorage?.setItem(key, legacyTabSession);
          window.sessionStorage?.removeItem(key);
          return legacyTabSession;
        }
      } catch { /* fallback em memória */ }

      return inMemoryAuthStorage.get(key) || null;
    },
    setItem: (key, value) => {
      // setSession/refresh já em voo não podem regravar tokens após o logout.
      if ((key === AUTH_STORAGE_KEY || key === FALLBACK_SESSION_KEY) && isAuthSessionLocked()) return;
      let persisted = false;
      try {
        window.localStorage?.setItem(key, value);
        persisted = true;
      } catch { /* fallback em memória abaixo */ }
      if (!persisted) {
        inMemoryAuthStorage.set(key, value);
      }
      try { window.sessionStorage?.removeItem(key); } catch { /* noop */ }
    },
    removeItem: (key) => {
      try { window.sessionStorage?.removeItem(key); } catch { /* noop */ }
      try { window.localStorage?.removeItem(key); } catch { /* noop */ }
      inMemoryAuthStorage.delete(key);
    },
  };
};

const authStorage = createBrowserAuthStorage();

const sessionBelongsToCurrentProject = (rawSession) => {
  try {
    const session = JSON.parse(rawSession);
    const accessToken = session?.access_token;
    if (!accessToken) return false;
    const encodedPayload = accessToken.split('.')[1];
    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(paddedPayload));
    return String(payload?.iss || '').includes(`https://${supabaseProjectRef}.supabase.co/`);
  } catch {
    return false;
  }
};

// Migra uma única vez a sessão criada antes das chaves serem isoladas por projeto.
if (authStorage && !authStorage.getItem(AUTH_STORAGE_KEY)) {
  const legacySession = authStorage.getItem('ac-prod-auth');
  if (legacySession && sessionBelongsToCurrentProject(legacySession)) {
    authStorage.setItem(AUTH_STORAGE_KEY, legacySession);
    authStorage.removeItem('ac-prod-auth');
  }
}

if (authStorage && !authStorage.getItem(FALLBACK_SESSION_KEY)) {
  const legacyFallback = authStorage.getItem('ac-prod-auth-fallback');
  if (legacyFallback && sessionBelongsToCurrentProject(legacyFallback)) {
    authStorage.setItem(FALLBACK_SESSION_KEY, legacyFallback);
    authStorage.removeItem('ac-prod-auth-fallback');
  }
}

if (!isSupabaseConfigured) {
  console.error(
    '[Leo Flow] Supabase não configurado. Crie um arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.'
  );
}

// Um link de recuperação é uma nova credencial explícita, validada pelo Auth.
// Abrir apenas a rota sem token não remove o bloqueio de inatividade.
if (typeof window !== 'undefined' && /\/reset-password\/?$/.test(window.location.pathname)) {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const value = (key) => search.get(key) || hash.get(key);
  if ((value('access_token') && value('refresh_token'))
      || (value('token_hash') && value('type') === 'recovery')
      || value('code')) unlockAuthSession();
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
  },
});

export const signInWithCredentials = (email, password) => trackAuthOperation(
  supabase.auth.signInWithPassword({ email, password }),
);

export const getPersistedAuthAccessToken = () => {
  for (const key of [AUTH_STORAGE_KEY, FALLBACK_SESSION_KEY]) {
    try {
      const session = JSON.parse(authStorage?.getItem(key) || 'null');
      if (session?.access_token) return session.access_token;
    } catch { /* Tenta a cópia de recuperação. */ }
  }
  return null;
};

export const endBrowserAuthSession = (accessToken) => Promise.allSettled([
  // O bloqueio local já apagou os tokens: passa o JWT capturado ao mesmo
  // endpoint utilizado pelo SDK para revogar apenas o refresh desta sessão.
  ...(accessToken ? [supabase.auth.admin.signOut(accessToken, 'local')] : []),
  supabase.auth.signOut({ scope: 'local' }),
]);

export const persistAuthSession = (session) => {
  if (isAuthSessionLocked()) return;
  if (!session?.access_token || !session?.refresh_token) return;
  authStorage?.setItem(FALLBACK_SESSION_KEY, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }));
};

export const clearPersistedAuthSession = () => {
  try {
    window.localStorage?.removeItem(AUTH_STORAGE_KEY);
    window.localStorage?.removeItem(FALLBACK_SESSION_KEY);
    window.localStorage?.removeItem('ac-prod-auth');
    window.localStorage?.removeItem('ac-prod-auth-fallback');
    window.sessionStorage?.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage?.removeItem(FALLBACK_SESSION_KEY);
    window.sessionStorage?.removeItem('ac-prod-auth');
    window.sessionStorage?.removeItem('ac-prod-auth-fallback');
  } catch { /* noop */ }
  authStorage?.removeItem(AUTH_STORAGE_KEY);
  authStorage?.removeItem(FALLBACK_SESSION_KEY);
};

export const restoreAuthSession = async () => {
  if (isAuthSessionLocked()) return null;
  const generation = authSessionGeneration;
  const raw = authStorage?.getItem(FALLBACK_SESSION_KEY);
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw);
    if (!stored?.access_token || !stored?.refresh_token) return null;

    const { data, error } = await Promise.race([
      trackAuthOperation(supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      })),
      new Promise((resolve) =>
        setTimeout(() => resolve({ data: { session: null }, error: { message: 'Timeout' } }), 4000)
      ),
    ]);

    if (generation !== authSessionGeneration || isAuthSessionLocked()) return null;
    if (error || !data?.session) {
      clearPersistedAuthSession();
      return null;
    }

    persistAuthSession(data.session);
    return data.session;
  } catch {
    clearPersistedAuthSession();
    return null;
  }
};

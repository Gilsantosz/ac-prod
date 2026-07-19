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
const inMemoryAuthStorage = new Map();

const createBrowserAuthStorage = () => {
  if (typeof window === 'undefined') return undefined;

  return {
    getItem: (key) => {
      try {
        const stored = window.localStorage?.getItem(key);
        if (stored) return stored;
      } catch { /* fallback para sessionStorage abaixo */ }
      try {
        const stored = window.sessionStorage?.getItem(key);
        if (stored) return stored;
      } catch { /* fallback em memória abaixo */ }
      return inMemoryAuthStorage.get(key) || null;
    },
    setItem: (key, value) => {
      let persisted = false;
      try {
        window.localStorage?.setItem(key, value);
        persisted = true;
      } catch { /* fallback para sessionStorage abaixo */ }
      if (!persisted) {
        try { window.sessionStorage?.setItem(key, value); }
        catch { /* fallback em memória abaixo */ }
      }
      inMemoryAuthStorage.set(key, value);
    },
    removeItem: (key) => {
      try { window.localStorage?.removeItem(key); }
      catch { /* noop */ }
      try { window.sessionStorage?.removeItem(key); }
      catch { /* noop */ }
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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
  },
});

export const persistAuthSession = (session) => {
  if (!session?.access_token || !session?.refresh_token) return;
  authStorage?.setItem(FALLBACK_SESSION_KEY, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }));
};

export const clearPersistedAuthSession = () => {
  authStorage?.removeItem(AUTH_STORAGE_KEY);
  authStorage?.removeItem(FALLBACK_SESSION_KEY);
};

export const restoreAuthSession = async () => {
  const raw = authStorage?.getItem(FALLBACK_SESSION_KEY);
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw);
    if (!stored?.access_token || !stored?.refresh_token) return null;

    const { data, error } = await Promise.race([
      supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      }),
      new Promise((resolve) =>
        setTimeout(() => resolve({ data: { session: null }, error: { message: 'Timeout' } }), 4000)
      ),
    ]);

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

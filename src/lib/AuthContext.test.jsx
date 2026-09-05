import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authListener: null, settingsListener: null, settings: null, operator: null, lock: null,
  getSession: vi.fn(), getUser: vi.fn(), profile: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
  clearOperator: vi.fn(), loadSettings: vi.fn(), waitPending: vi.fn(), navTo: vi.fn(),
  persist: vi.fn(), restore: vi.fn(), clearPersisted: vi.fn(),
}));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession, getUser: mocks.getUser,
      onAuthStateChange: (listener) => { mocks.authListener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  },
  clearPersistedAuthSession: mocks.clearPersisted, persistAuthSession: mocks.persist,
  restoreAuthSession: mocks.restore,
  lockAuthSession: (reason) => { mocks.lock = { reason }; },
  unlockAuthSession: () => { mocks.lock = null; },
  isAuthSessionLocked: () => Boolean(mocks.lock), getAuthSessionLock: () => mocks.lock,
  AUTH_SESSION_LOCK_KEY: 'test-auth-lock',
  signInWithCredentials: mocks.signIn, waitForPendingAuthOperations: mocks.waitPending,
  getPersistedAuthAccessToken: () => 'current-token', endBrowserAuthSession: mocks.signOut,
}));
vi.mock('@/lib/localDb', () => ({ base44: { auth: { register: vi.fn() } } }));
vi.mock('@/lib/navigation', () => ({ navTo: mocks.navTo }));
vi.mock('@/lib/operatorSessionService', () => ({
  getOperatorSession: () => mocks.operator, clearOperatorSession: mocks.clearOperator,
}));
vi.mock('@/lib/systemSettingsService', () => ({
  getCachedSystemSettings: () => mocks.settings,
  loadSystemSettings: mocks.loadSettings,
  subscribeSystemSettings: (listener) => { mocks.settingsListener = listener; return vi.fn(); },
}));

import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { clearSessionActivity, getLastSessionActivity, recordSessionActivity, requestSessionActivity } from '@/lib/sessionActivity';

const NOW = Date.UTC(2026, 8, 5, 12);
const authUser = { id: 'manager-1', email: 'manager@example.com' };
const session = { user: authUser, access_token: 'access', refresh_token: 'refresh' };
const profile = { ...authUser, name: 'Gestor', active: true, role: 'admin', cell: '' };
let context;
function Probe() {
  context = useAuth();
  return <div data-testid="auth">{context.isAuthenticated ? context.user.name : 'login'}</div>;
}
async function start() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
}
async function advance(ms) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('AuthProvider inactivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    clearSessionActivity();
    mocks.lock = null;
    mocks.operator = null;
    mocks.settings = { default_timeout_minutes: 2, warning_seconds: 30, role_timeouts: {}, cell_timeouts: {}, sectors: [], cell_catalog: [] };
    mocks.getSession.mockResolvedValue({ data: { session } });
    mocks.getUser.mockResolvedValue({ data: { user: authUser } });
    mocks.profile.mockResolvedValue({ data: profile });
    mocks.signIn.mockResolvedValue({ data: { session, user: authUser } });
    mocks.loadSettings.mockImplementation(async () => mocks.settings);
    mocks.waitPending.mockResolvedValue();
    mocks.signOut.mockResolvedValue();
    mocks.clearOperator.mockImplementation(async () => {
      mocks.operator = null;
      window.dispatchEvent(new CustomEvent('operator-session-changed'));
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('restaura a regra cacheada maior que 30 minutos sem reiniciar a atividade', async () => {
    mocks.settings.default_timeout_minutes = 60;
    recordSessionActivity(NOW - 40 * 60_000);
    await start();
    expect(context.isAuthenticated).toBe(true);
    expect(context.sessionInactivityMs).toBe(60 * 60_000);
    expect(getLastSessionActivity()).toBe(NOW - 40 * 60_000);
    await advance(20 * 60_000);
    expect(context.isAuthenticated).toBe(false);
    expect(mocks.signOut).toHaveBeenCalledWith('current-token');
  });

  it('usa a célula operacional e encerra ambos os logins, preservando o armazenamento de coletas', async () => {
    mocks.operator = { id: 'op-1', selected_cell_id: 'cell-1' };
    mocks.settings.cell_catalog = [{ id: 'cell-1', name: 'Corte' }];
    mocks.settings.cell_timeouts = { 'cell-1': 1 };
    mocks.settings.role_timeouts = { admin: 30, operator: 5 };
    localStorage.setItem('collection-event-fixture', 'pending-reading');
    await start();
    expect(context.sessionInactivityMs).toBe(60_000);
    await advance(60_000);
    expect(context.isAuthenticated).toBe(false);
    expect(mocks.operator).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.navTo).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('collection-event-fixture')).toBe('pending-reading');
  });

  it('foco, atualização da configuração e TOKEN_REFRESHED não renovam o prazo', async () => {
    await start();
    const last = getLastSessionActivity();
    await advance(60_000);
    act(() => { window.dispatchEvent(new Event('focus')); mocks.authListener('TOKEN_REFRESHED', session); });
    await advance(10);
    act(() => mocks.settingsListener({ ...mocks.settings, version: 2 }));
    expect(getLastSessionActivity()).toBe(last);
    await advance(60_000);
    expect(context.isAuthenticated).toBe(false);
  });

  it('mostra aviso e uma captura real renova o prazo sem consultar o banco', async () => {
    await start();
    await advance(90_000);
    expect(screen.getByText(/Sua sessão será encerrada em/)).toBeInTheDocument();
    const queries = mocks.loadSettings.mock.calls.length;
    act(() => { expect(requestSessionActivity()).toBe(true); });
    expect(screen.queryByText(/Sua sessão será encerrada em/)).not.toBeInTheDocument();
    expect(mocks.loadSettings).toHaveBeenCalledTimes(queries);
    await advance(90_000);
    expect(context.isAuthenticated).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar conectado' }));
    await advance(119_000);
    expect(context.isAuthenticated).toBe(true);
    await advance(1000);
    expect(context.isAuthenticated).toBe(false);
  });

  it('não deixa a primeira interação após suspensão ressuscitar a sessão vencida', async () => {
    await start();
    vi.setSystemTime(NOW + 3 * 60_000);
    act(() => { expect(requestSessionActivity()).toBe(false); });
    expect(context.isAuthenticated).toBe(false);
    expect(getLastSessionActivity()).toBeNull();
  });

  it('recusa um callback de scanner tardio mesmo depois de desmontar o monitor autenticado', async () => {
    await start();
    await advance(120_000);
    expect(context.isAuthenticated).toBe(false);
    act(() => { expect(requestSessionActivity()).toBe(false); });
    expect(getLastSessionActivity()).toBeNull();
  });

  it('aplica um prazo menor publicado sem contar a atualização como atividade', async () => {
    await start();
    await advance(70_000);
    act(() => mocks.settingsListener({ ...mocks.settings, default_timeout_minutes: 1 }));
    expect(context.isAuthenticated).toBe(false);
    expect(context.authError.type).toBe('inactivity_logout');
  });

  it('uma busca de perfil pendente não autentica novamente após logout', async () => {
    await start();
    const pending = deferred();
    mocks.profile.mockReturnValueOnce(pending.promise);
    act(() => mocks.authListener('SIGNED_IN', session));
    await advance(1);
    await act(async () => { await context.logout(false); });
    await act(async () => { pending.resolve({ data: profile }); });
    expect(context.isAuthenticated).toBe(false);
    expect(mocks.lock).toEqual({ reason: 'logout' });
  });

  it('SIGNED_OUT externo invalida uma busca de perfil ainda em voo', async () => {
    await start();
    const pending = deferred();
    mocks.profile.mockReturnValueOnce(pending.promise);
    act(() => mocks.authListener('SIGNED_IN', session));
    await advance(1);
    act(() => mocks.authListener('SIGNED_OUT', null));
    await advance(1);
    await act(async () => { pending.resolve({ data: profile }); });
    expect(context.isAuthenticated).toBe(false);
    expect(mocks.lock).toEqual({ reason: 'logout' });
  });

  it('não desbloqueia um novo login enquanto operações antigas estão pendentes', async () => {
    await start();
    await act(async () => { await context.logout(false); });
    mocks.waitPending.mockReturnValueOnce(new Promise(() => {}));
    let error;
    act(() => { context.login('new@example.com', 'password').catch((value) => { error = value; }); });
    await advance(3000);
    expect(error.message).toMatch(/ainda está sendo encerrada/);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.lock).toEqual({ reason: 'logout' });
  });

  it('exige credenciais após expirar e permite novo login explícito', async () => {
    await start();
    await advance(120_000);
    act(() => mocks.authListener('SIGNED_IN', session));
    await advance(1);
    expect(context.isAuthenticated).toBe(false);
    await act(async () => { await context.login('manager@example.com', 'password'); });
    expect(context.isAuthenticated).toBe(true);
    expect(mocks.lock).toBeNull();
    expect(getLastSessionActivity()).toBeGreaterThan(NOW + 119_000);
  });
});

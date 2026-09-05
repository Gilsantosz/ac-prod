import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These cases intentionally use the installed Supabase Auth SDK. Mocking
// signInWithPassword/setSession would miss their writes before they resolve.
const PROJECT = 'auth-session-race';
let projectSequence = 0;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function authSession(id) {
  const user = {
    id, email: `${id}@example.test`, aud: 'authenticated', role: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  };
  const encode = (value) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const payload = { sub: id, exp: Math.floor(Date.now() / 1000) + 3600, iss: `https://${PROJECT}.supabase.co/auth/v1` };
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.test-signature`,
    refresh_token: `refresh-${id}`, token_type: 'bearer', expires_in: 3600, user,
  };
}

describe('Supabase real SDK session races', () => {
  let client;
  let api;
  let requests;
  let pendingResponses;
  let authKey;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const projectRef = `${PROJECT}-${++projectSequence}`;
    authKey = `ac-prod-auth-${projectRef}`;
    vi.stubEnv('VITE_SUPABASE_URL', `https://${projectRef}.supabase.co`);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-anon-key');
    vi.stubGlobal('BroadcastChannel', undefined);
    localStorage.clear();
    sessionStorage.clear();
    requests = [];
    pendingResponses = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init = {}) => {
      const url = String(input);
      const request = { url, init, response: deferred(), started: true };
      requests.push(request);
      pendingResponses.push(request.response);
      return request.response.promise;
    }));
    api = await import('@/lib/supabaseClient');
    client = api.supabase;
    await client.auth.initialize();
    client.auth.stopAutoRefresh();
  });

  afterEach(async () => {
    pendingResponses.forEach((pending) => pending.resolve(new Response('{}', { status: 400 })));
    await vi.advanceTimersByTimeAsync(0);
    client?.auth.stopAutoRefresh();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function nextRequest(index = requests.length - 1) {
    await vi.advanceTimersByTimeAsync(0);
    return requests[index];
  }

  function respond(request, data, status = 200) {
    request.response.resolve(new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    }));
  }

  it('keeps a timed-out restoration locked until the actual SDK write has settled', async () => {
    const oldSession = authSession('old-user');
    const newSession = authSession('new-user');
    api.persistAuthSession(oldSession);
    const restoration = api.restoreAuthSession();
    const oldRequest = await nextRequest(0);
    expect(oldRequest.url).toContain('/auth/v1/user');

    // The caller's timeout must not be confused with SDK completion.
    await vi.advanceTimersByTimeAsync(4001);
    expect(await restoration).toBeNull();
    api.lockAuthSession('inactivity');
    api.clearPersistedAuthSession();
    let drained = false;
    const draining = api.waitForPendingAuthRestoration().then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);
    expect(api.isAuthSessionLocked()).toBe(true);

    respond(oldRequest, oldSession.user);
    await draining;
    expect(localStorage.getItem(authKey)).toBeNull();
    api.unlockAuthSession();
    const login = api.signInWithCredentials('new-user@example.test', 'new-password');
    const newRequest = await nextRequest(1);
    respond(newRequest, newSession);
    expect((await login).data.user.id).toBe('new-user');
    expect(JSON.parse(localStorage.getItem(authKey)).user.id).toBe('new-user');
  });

  it('drains a previous password request before unlocking a later login', async () => {
    const oldSession = authSession('old-user');
    const newSession = authSession('new-user');
    const previousLogin = api.signInWithCredentials('old-user@example.test', 'old-password');
    const oldRequest = await nextRequest(0);
    expect(oldRequest.url).toContain('grant_type=password');
    api.lockAuthSession('login_failed');
    api.clearPersistedAuthSession();
    let drained = false;
    const draining = api.waitForPendingAuthRestoration().then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);

    respond(oldRequest, oldSession);
    await previousLogin;
    await draining;
    expect(localStorage.getItem(authKey)).toBeNull();
    api.unlockAuthSession();
    const freshLogin = api.signInWithCredentials('new-user@example.test', 'new-password');
    respond(await nextRequest(1), newSession);
    expect((await freshLogin).data.user.id).toBe('new-user');
    expect(JSON.parse(localStorage.getItem(authKey)).user.id).toBe('new-user');
  });

  it('revokes the captured session on the server with local scope after immediately locking the screen', async () => {
    const session = authSession('current-user');
    const login = api.signInWithCredentials('current-user@example.test', 'password');
    respond(await nextRequest(0), session);
    await login;
    const capturedToken = api.getPersistedAuthAccessToken();
    expect(capturedToken).toBe(session.access_token);

    api.lockAuthSession('inactivity');
    api.clearPersistedAuthSession();
    const logout = api.endBrowserAuthSession(capturedToken);
    const logoutRequest = await nextRequest(1);
    expect(api.isAuthSessionLocked()).toBe(true);
    expect(localStorage.getItem(authKey)).toBeNull();
    expect(logoutRequest.url).toContain('/auth/v1/logout?scope=local');
    expect(logoutRequest.init.method).toBe('POST');
    expect(new Headers(logoutRequest.init.headers).get('Authorization')).toBe(`Bearer ${session.access_token}`);
    respond(logoutRequest, {});
    await logout;
    expect(requests.filter((request) => request.url.includes('/logout'))).toHaveLength(1);
    expect(api.isAuthSessionLocked()).toBe(true);
  });
});

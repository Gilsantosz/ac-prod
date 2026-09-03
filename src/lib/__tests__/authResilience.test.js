import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearProfileRequestState,
  fetchProfileSingleFlight,
  isAccessDeniedError,
  isDefinitiveSessionError,
  isTransientAuthError,
  retryDelay,
} from '@/lib/authResilience';

function deferredQuery() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => query),
    abortSignal: vi.fn(() => query),
    then: (done, reject) => promise.then(done, reject),
  };
  return { query, resolve };
}

describe('auth resilience', () => {
  beforeEach(() => clearProfileRequestState());

  it('coalesces concurrent profile reads for the same user', async () => {
    const pending = deferredQuery();
    const supabase = { from: vi.fn(() => pending.query) };
    const user = { id: 'user-1', email: 'safe@example.test' };

    const first = fetchProfileSingleFlight(supabase, user);
    const second = fetchProfileSingleFlight(supabase, user);
    expect(first).toBe(second);
    expect(supabase.from).toHaveBeenCalledTimes(1);

    pending.resolve({ data: { name: 'Teste', role: 'operator', active: true }, error: null });
    await expect(first).resolves.toMatchObject({ id: 'user-1', name: 'Teste', active: true });
  });

  it('separates temporary profile failures from definitive access removal', () => {
    expect(isTransientAuthError({ status: 503 })).toBe(true);
    expect(isTransientAuthError({ code: 'PROFILE_UNAVAILABLE' })).toBe(true);
    expect(isAccessDeniedError({ code: 'USER_INACTIVE' })).toBe(true);
    expect(isAccessDeniedError({ status: 503 })).toBe(false);
  });

  it('clears a session only for definitive refresh/user errors', () => {
    expect(isDefinitiveSessionError({ code: 'refresh_token_not_found' })).toBe(true);
    expect(isDefinitiveSessionError({ message: 'Invalid Refresh Token' })).toBe(true);
    expect(isDefinitiveSessionError({ status: 504, message: 'Timeout' })).toBe(false);
  });

  it('uses bounded exponential backoff with jitter', () => {
    expect(retryDelay(0, { random: () => 0 })).toBe(563);
    expect(retryDelay(8, { random: () => 1 })).toBe(18_750);
  });
});


import { describe, expect, it } from 'vitest';
import { isAuthAccessDeniedError, isInvalidAuthSessionError } from '@/lib/authErrors';

describe('auth error classification', () => {
  it.each([
    { code: 'session_expired', status: 400 },
    { code: 'session_not_found' },
    { code: 'refresh_token_already_used' },
    { code: 'refresh_token_not_found' },
    { code: 'user_banned' },
    { code: 'user_not_found' },
    { code: 'PGRST301' },
    { name: 'AuthSessionMissingError' },
    { status: 401 },
  ])('recognizes an invalid or revoked session: %j', (error) => {
    expect(isInvalidAuthSessionError(error)).toBe(true);
  });

  it.each([
    { code: 'TIMEOUT' }, { code: 'request_timeout' },
    { code: 'unexpected_failure', status: 500 },
    { code: 'over_request_rate_limit', status: 429 },
    { name: 'AuthRetryableFetchError', status: 503 },
    { code: '57014' }, new TypeError('Failed to fetch'), null,
  ])('never infers credential revocation from availability errors: %j', (error) => {
    expect(isInvalidAuthSessionError(error)).toBe(false);
    expect(isAuthAccessDeniedError(error)).toBe(false);
  });

  it.each([{ code: 'USER_INACTIVE' }, { code: 'USER_NOT_REGISTERED' }, { code: '42501' }, { status: 403 }])(
    'retains profile/RLS access denials: %j', (error) => {
      expect(isAuthAccessDeniedError(error)).toBe(true);
    },
  );
});

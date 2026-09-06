// A service outage is not evidence that a credential was revoked. Only these
// Auth responses may invalidate durable credentials; RLS is still enforced by
// the server on every data request.
const INVALID_SESSION_CODES = new Set([
  'bad_jwt', 'invalid_credentials', 'refresh_token_already_used',
  'refresh_token_not_found', 'session_expired', 'session_not_found',
  'user_banned', 'user_not_found', 'PGRST301', 'PGRST302',
]);

export function isInvalidAuthSessionError(error) {
  return INVALID_SESSION_CODES.has(error?.code)
    || error?.name === 'AuthSessionMissingError'
    || Number(error?.status) === 401;
}

export function isAuthAccessDeniedError(error) {
  return ['USER_NOT_REGISTERED', 'USER_INACTIVE', '42501'].includes(error?.code)
    || Number(error?.status) === 403;
}

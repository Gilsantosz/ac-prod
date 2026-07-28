import { describe, expect, it, vi } from 'vitest';
import {
  clearRecoveryCredentialsFromUrl,
  resolvePasswordRecoverySession,
} from '@/lib/passwordRecovery';

const createAuth = (overrides = {}) => ({
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
  ...overrides,
});

describe('passwordRecovery', () => {
  it('cria a sessão a partir dos tokens do link implícito', async () => {
    const session = { user: { id: 'user-1' } };
    const auth = createAuth({
      setSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    });
    const location = {
      search: '',
      hash: '#access_token=access-1&refresh_token=refresh-1&type=recovery',
    };

    await expect(resolvePasswordRecoverySession(auth, location)).resolves.toEqual(session);
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    });
  });

  it('aceita token_hash de recuperação', async () => {
    const session = { user: { id: 'user-2' } };
    const auth = createAuth({
      verifyOtp: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    });
    const location = {
      search: '?token_hash=hash-1&type=recovery',
      hash: '',
    };

    await expect(resolvePasswordRecoverySession(auth, location)).resolves.toEqual(session);
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hash-1',
      type: 'recovery',
    });
  });

  it('mostra uma mensagem clara quando o Supabase informa link expirado', async () => {
    const auth = createAuth();
    const location = {
      search: '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      hash: '',
    };

    await expect(resolvePasswordRecoverySession(auth, location))
      .rejects
      .toThrow('Este link de recuperação expirou');
  });

  it('rejeita acesso direto sem sessão de recuperação', async () => {
    const auth = createAuth();
    const location = { search: '', hash: '' };

    await expect(resolvePasswordRecoverySession(auth, location))
      .rejects
      .toThrow('Link de recuperação inválido ou expirado');
  });

  it('remove credenciais sensíveis da barra de endereço', () => {
    window.history.replaceState(
      null,
      '',
      '/ac-prod/reset-password?code=secret#access_token=token&type=recovery',
    );

    clearRecoveryCredentialsFromUrl(window.location);

    expect(window.location.pathname).toBe('/ac-prod/reset-password');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});

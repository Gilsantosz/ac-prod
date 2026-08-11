import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc } }));

import { clearOperatorSession, loginOperator } from '@/lib/operatorSessionService';

describe('operatorSessionService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    await clearOperatorSession({ notifyServer: false });
  });

  it('usa o login exclusivo quando o propósito é reposição', async () => {
    rpc.mockResolvedValue({
      data: {
        success: true,
        scope: 'replacement',
        session_id: 'session-1',
        session_token: 'token-1',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        operator: {
          id: 'operator-1', name: 'Operador Teste', login_name: 'operador.teste',
          registration_masked: '***23', cells: [], machines: [], replacement_enabled: true,
        },
      },
      error: null,
    });

    const session = await loginOperator('operador.teste', '00123', { purpose: 'replacement' });

    expect(rpc).toHaveBeenCalledWith('replacement_operator_login_v2', expect.objectContaining({
      p_login_name: 'operador.teste', p_registration: '00123',
    }));
    expect(session).toMatchObject({ id: 'operator-1', purpose: 'replacement', token: 'token-1' });
  });

  it('mantém o login produtivo genérico como padrão', async () => {
    rpc.mockResolvedValue({ data: { success: false, error: 'Credenciais inválidas.' }, error: null });

    await expect(loginOperator('operador.teste', 'errada')).rejects.toThrow('Credenciais inválidas.');
    expect(rpc).toHaveBeenCalledWith('operator_login_v2', expect.any(Object));
  });
});

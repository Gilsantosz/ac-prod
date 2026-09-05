import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc } }));

import {
  clearOperatorSession, getOperatorSession, heartbeatOperatorSession,
  isOperatorSessionSupersededError, loginOperator, setOperatorSessionContext,
} from '@/lib/operatorSessionService';

function loginResult(id = 'session-1') {
  return { data: { success: true, session_id: id, session_token: `token-${id}`,
    expires_at: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
    operator: { id: 'op-1', name: 'Operador', login_name: 'operador', cells: [], machines: [] },
  }, error: null };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

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

  it('remove a credencial imediatamente mesmo quando o logout remoto demora', async () => {
    rpc.mockResolvedValueOnce(loginResult());
    await loginOperator('operador', '123');
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise);
    const logout = clearOperatorSession();
    expect(getOperatorSession()).toBeNull();
    pending.resolve({ data: { success: true } });
    await logout;
  });

  it('um heartbeat iniciado antes do logout não restaura o operador', async () => {
    rpc.mockResolvedValueOnce(loginResult());
    await loginOperator('operador', '123');
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise);
    const heartbeat = heartbeatOperatorSession();
    await clearOperatorSession({ notifyServer: false });
    pending.resolve({ data: { success: true, expires_at: new Date(Date.now() + 8 * 60 * 60_000).toISOString() } });
    await heartbeat;
    expect(getOperatorSession()).toBeNull();
  });

  it('resposta de login após cancelamento é encerrada no servidor e não restaurada', async () => {
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise).mockResolvedValue({ data: { success: true } });
    const login = loginOperator('operador', '123');
    await clearOperatorSession({ notifyServer: false });
    pending.resolve(loginResult('late-session'));
    await expect(login).rejects.toThrow(/encerrada ou alterada/);
    expect(getOperatorSession()).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('logout_operator_session', { p_session_token: 'token-late-session' });
  });

  it('contexto pendente não ressuscita uma sessão encerrada', async () => {
    rpc.mockResolvedValueOnce(loginResult());
    await loginOperator('operador', '123');
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise);
    const context = setOperatorSessionContext('cell-1');
    await clearOperatorSession({ notifyServer: false });
    pending.resolve({ data: { success: true, cell_name: 'Corte' } });
    await expect(context).rejects.toThrow(/encerrada ou alterada/);
    expect(getOperatorSession()).toBeNull();
  });

  it('identifica uma resposta de contexto substituída sem confundi-la com falha remota', async () => {
    rpc.mockResolvedValueOnce(loginResult());
    await loginOperator('operador', '123');
    const firstPending = deferred();
    rpc
      .mockReturnValueOnce(firstPending.promise)
      .mockResolvedValueOnce({ data: { success: true, cell_name: 'Usinagem' }, error: null });

    const firstContext = setOperatorSessionContext('cell-1');
    await setOperatorSessionContext('cell-2');
    firstPending.resolve({ data: { success: true, cell_name: 'Corte' }, error: null });

    const superseded = await firstContext.catch((error) => error);
    expect(isOperatorSessionSupersededError(superseded)).toBe(true);
    expect(getOperatorSession()).toMatchObject({ selected_cell_id: 'cell-2' });
  });

  it('heartbeat preserva a seleção de célula feita enquanto ele aguardava', async () => {
    rpc.mockResolvedValueOnce(loginResult());
    await loginOperator('operador', '123');
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: { success: true, cell_name: 'Usinagem' } });
    const heartbeat = heartbeatOperatorSession();
    await setOperatorSessionContext('cell-2');
    pending.resolve({ data: { success: true } });
    await heartbeat;
    expect(getOperatorSession()).toMatchObject({ selected_cell_id: 'cell-2', selected_cell_name: 'Usinagem' });
  });

  it('logout remoto antigo não apaga um novo operador', async () => {
    rpc.mockResolvedValueOnce(loginResult());
    await loginOperator('operador', '123');
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(loginResult('new-session'));
    const logout = clearOperatorSession();
    await loginOperator('outro', '321');
    pending.resolve({ data: { success: true } });
    await logout;
    expect(getOperatorSession()).toMatchObject({ session_id: 'new-session' });
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionOperatorContext } from '@/hooks/useCollectionOperatorContext';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { clearOperatorSession, loginOperator } from '@/lib/operatorSessionService';

const { rpc, abortSignals } = vi.hoisted(() => ({ rpc: vi.fn(), abortSignals: [] }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: {
  rpc: (...args) => {
    const request = Promise.resolve(rpc(...args));
    request.abortSignal = (signal) => { abortSignals.push(signal); return request; };
    return request;
  },
} }));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function login(id = 'session-1') {
  rpc.mockResolvedValueOnce({ data: {
    success: true, session_id: id, session_token: `token-${id}`,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    operator: { id: 'operator-1', name: 'Corte', cells: [], machines: [] },
  } });
  return loginOperator('operator-test', 'test');
}

function renderContext(machineId = 'machine-1') {
  return renderHook(({ selectedMachineId }) => {
    const { session, setContext } = useOperatorSession();
    return useCollectionOperatorContext({
      session, setContext, cellId: 'cell-1', machineId: selectedMachineId,
    });
  }, { initialProps: { selectedMachineId: machineId } });
}

const confirmed = { data: { success: true, cell_name: 'Corte', machine_name: 'Máquina' } };

beforeEach(async () => {
  await clearOperatorSession({ notifyServer: false });
  sessionStorage.clear();
  localStorage.clear();
  rpc.mockReset();
});

describe('confirmação do posto da coleta', () => {
  it('aguarda a gravação do posto no servidor antes de liberar a captura', async () => {
    await login();
    const pending = deferred();
    rpc.mockReturnValueOnce(pending.promise);
    const { result } = renderContext();
    expect(result.current.contextReady).toBe(false);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_operator_session_context', expect.objectContaining({
      p_session_token: 'token-session-1', p_cell_id: 'cell-1', p_machine_id: 'machine-1',
    })));
    expect(result.current.contextReady).toBe(false);
    await act(async () => pending.resolve(confirmed));
    await waitFor(() => expect(result.current.contextReady).toBe(true));
  });

  it('um novo login reconfirma a mesma máquina que estava salva', async () => {
    await login();
    rpc.mockResolvedValueOnce(confirmed);
    const { result } = renderContext();
    await waitFor(() => expect(result.current.contextReady).toBe(true));
    const pending = deferred();
    await act(async () => {
      await login('session-2');
      rpc.mockReturnValueOnce(pending.promise);
    });
    expect(result.current.contextReady).toBe(false);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_operator_session_context', expect.objectContaining({
      p_session_token: 'token-session-2', p_machine_id: 'machine-1',
    })));
    await act(async () => pending.resolve(confirmed));
    await waitFor(() => expect(result.current.contextReady).toBe(true));
  });

  it('não grava um posto nulo nem libera todas as máquinas para a coleta', async () => {
    await login();
    rpc.mockResolvedValueOnce(confirmed);
    const { result, rerender } = renderContext(null);
    expect(result.current.contextReady).toBe(false);
    expect(result.current.contextMessage).toContain('Selecione a máquina');
    expect(rpc).toHaveBeenCalledTimes(1);
    rerender({ selectedMachineId: 'machine-1' });
    await waitFor(() => expect(result.current.contextReady).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('recusa outra máquina depois de confirmar o posto, sem alterar a sessão de reenvio', async () => {
    await login();
    rpc.mockResolvedValueOnce(confirmed);
    const { result, rerender } = renderContext();
    await waitFor(() => expect(result.current.contextReady).toBe(true));
    const countBeforeSwitch = rpc.mock.calls.length;
    rerender({ selectedMachineId: 'machine-2' });
    expect(result.current.contextReady).toBe(false);
    expect(result.current.contextMessage).toContain('Trocar Operador');
    expect(rpc).toHaveBeenCalledTimes(countBeforeSwitch);
  });

  it('permite corrigir a primeira seleção enquanto nenhuma máquina foi confirmada', async () => {
    await login();
    const first = deferred();
    const second = deferred();
    rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderContext();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    rerender({ selectedMachineId: 'machine-2' });
    expect(result.current.contextReady).toBe(false);
    await act(async () => first.resolve(confirmed));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_operator_session_context', expect.objectContaining({ p_machine_id: 'machine-2' })));
    expect(result.current.contextReady).toBe(false);
    await act(async () => second.resolve(confirmed));
    await waitFor(() => expect(result.current.contextReady).toBe(true));
  });

  it('na reabertura preserva o posto salvo e não envia preferências antigas ao servidor', async () => {
    await login();
    rpc.mockResolvedValueOnce(confirmed);
    const firstMount = renderContext();
    await waitFor(() => expect(firstMount.result.current.contextReady).toBe(true));
    firstMount.unmount();
    const countBeforeReopen = rpc.mock.calls.length;
    const reopened = renderContext('machine-old-preference');
    expect(reopened.result.current.contextReady).toBe(false);
    expect(reopened.result.current.contextMessage).toContain('Posto fixo');
    expect(rpc).toHaveBeenCalledTimes(countBeforeReopen);
    rpc.mockResolvedValueOnce(confirmed);
    reopened.rerender({ selectedMachineId: 'machine-1' });
    await waitFor(() => expect(reopened.result.current.contextReady).toBe(true));
    expect(rpc).toHaveBeenLastCalledWith('set_operator_session_context', expect.objectContaining({ p_machine_id: 'machine-1' }));
  });

  it('permite recuperar uma falha de conexão sem novo login', async () => {
    await login();
    rpc.mockRejectedValueOnce(new Error('Sem conexão'));
    const { result } = renderContext();
    await waitFor(() => expect(result.current.error).toBe('Sem conexão'));
    expect(result.current.contextReady).toBe(false);
    rpc.mockResolvedValueOnce(confirmed);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.contextReady).toBe(true));
    expect(result.current.error).toBeNull();
  });
});

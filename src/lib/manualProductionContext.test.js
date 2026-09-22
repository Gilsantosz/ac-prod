import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOperatorSession, getConfirmedOperatorContext, getOperatorSession,
  loginOperator, setOperatorSessionContext,
} from '@/lib/operatorSessionService';
import { registerManualQuantitativeEntry } from '@/lib/manualProductionService';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), volumeError: null }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/lib/runtimeEnvironment', () => ({ projectScopedStorageKey: (key) => `volume-context-test:${key}` }));
vi.mock('@/lib/productionStagePolicyService', () => ({
  canonicalProductionStage: (name) => String(name).trim().toLowerCase() === 'furação' ? 'drill' : 'cut',
}));

// Synthetic responses at the transport boundary; session persistence/confirmation
// and the volume service are real. Server authorization is tested separately in SQL.
const cell = { id: '00000000-0000-4000-8000-000000000101', name: 'Furação ' };
const machine = { id: '00000000-0000-4000-8000-000000000102', name: 'Posto de teste', cell_name: 'Furação' };
const basePayload = { pcp_import_batch_id: '00000000-0000-4000-8000-000000000103',
  general_lot_code: 'TESTE', cell_name: 'Furação', quantity: 1, date: '2026-09-22' };
const volumeCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'register_untraceable_stage_quantity');

beforeEach(async () => {
  await clearOperatorSession({ notifyServer: false });
  sessionStorage.clear(); localStorage.clear();
  mocks.volumeError = null;
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation((name) => {
    let response;
    if (name === 'operator_login_v2') {
      response = { data: { success: true, session_id: crypto.randomUUID(), session_token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(), scope: 'production',
        operator: { id: '00000000-0000-4000-8000-000000000104', name: 'Operador teste',
          shift: '3º Turno', cells: [cell], machines: [machine] } }, error: null };
    } else if (name === 'set_operator_session_context') {
      response = { data: { success: true, cell_name: cell.name, machine_name: machine.name }, error: null };
    } else if (name === 'register_untraceable_stage_quantity') {
      response = { data: mocks.volumeError ? null : { success: true, quantity: 1, remaining_after: 9 }, error: mocks.volumeError };
    } else throw new Error(`Unexpected RPC: ${name}`);
    const request = Promise.resolve(response);
    request.abortSignal = () => request;
    return request;
  });
});
afterEach(async () => { await clearOperatorSession({ notifyServer: false }); });

async function confirmLogin(machineId = machine.id) {
  await loginOperator('teste-volume', 'TEST-ONLY');
  return setOperatorSessionContext(cell.id, machineId, 'Coletor Chão de Fábrica');
}

describe('baixa por volume com contexto preenchido pelo login', () => {
  it.each(['Furação', ' Furação ', 'FURAÇÃO'])('usa a mesma sessão confirmada ao receber o rótulo %s', async (label) => {
    const confirmed = await confirmLogin();
    expect(getConfirmedOperatorContext(confirmed)).toMatchObject({ cellId: cell.id, machineId: machine.id });
    const result = await registerManualQuantitativeEntry({ ...basePayload, cell_name: label });
    expect(result.success).toBe(true);
    expect(volumeCalls()).toHaveLength(1);
    expect(volumeCalls()[0][1].p_payload).toMatchObject({
      cell_name: cell.name, stage_code: 'drill', shift: '3º Turno', operator: 'Operador teste',
      operatorSessionToken: confirmed.token, deviceId: confirmed.device_id,
    });
    expect(getOperatorSession().session_id).toBe(confirmed.session_id);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'set_operator_session_context')).toHaveLength(1);
  });

  it('não libera uma sessão que ainda não confirmou o posto', async () => {
    await loginOperator('teste-volume', 'TEST-ONLY');
    await expect(registerManualQuantitativeEntry(basePayload)).rejects.toThrow('Confirme a célula e o posto');
    expect(volumeCalls()).toHaveLength(0);
  });

  it('não troca automaticamente a célula confirmada por outra', async () => {
    await confirmLogin();
    await expect(registerManualQuantitativeEntry({ ...basePayload, cell_name: 'Corte' })).rejects.toThrow('Confirme a célula e o posto');
    expect(volumeCalls()).toHaveLength(0);
  });

  it('mantém o bloqueio se nenhum posto foi confirmado', async () => {
    await confirmLogin(null);
    await expect(registerManualQuantitativeEntry(basePayload)).rejects.toThrow('Confirme a célula e o posto');
    expect(volumeCalls()).toHaveLength(0);
  });

  it('continua respeitando uma rejeição real do contexto pelo servidor', async () => {
    await confirmLogin();
    mocks.volumeError = { code: '42501', message: 'OPERATOR_CONTEXT_REQUIRED' };
    await expect(registerManualQuantitativeEntry(basePayload)).rejects.toThrow('Confirme a célula e o posto');
    expect(volumeCalls()).toHaveLength(1);
  });
});

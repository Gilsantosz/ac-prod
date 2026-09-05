import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_TIMEOUT_MINUTES, resolveSessionPolicy } from '@/lib/sessionPolicy';

const CUT_CELL = '10000000-0000-0000-0000-000000000001';
const EDGE_CELL = '20000000-0000-0000-0000-000000000002';

function settings(overrides = {}) {
  return {
    default_timeout_minutes: 30,
    warning_seconds: 60,
    role_timeouts: { operator: 10, admin: 120 },
    cell_timeouts: { [CUT_CELL]: 5 },
    sectors: [{ id: 'lsm', name: 'LSM', cell_ids: [CUT_CELL, EDGE_CELL], timeout_minutes: 15 }],
    cell_catalog: [{ id: CUT_CELL, name: 'Corte' }, { id: EDGE_CELL, name: 'Borda' }],
    ...overrides,
  };
}

describe('resolveSessionPolicy', () => {
  it('aplica a célula atual antes do nível de acesso, setor e padrão', () => {
    const policy = resolveSessionPolicy(settings(), { role: 'admin', cell: CUT_CELL });

    expect(policy).toEqual({
      timeoutMinutes: 5,
      timeoutMs: 300_000,
      warningSeconds: 60,
      scope: 'cell',
      scopeLabel: 'Célula: Corte',
      cellId: CUT_CELL,
    });
  });

  it('aplica o nível de acesso antes do setor quando a célula herda', () => {
    const policy = resolveSessionPolicy(settings(), { role: 'admin', cell: EDGE_CELL });

    expect(policy.timeoutMinutes).toBe(120);
    expect(policy.scope).toBe('role');
    expect(policy.scopeLabel).toBe('Nível de acesso: Administrador');
  });

  it('resolve o setor pela associação da célula e herda o padrão sem associação', () => {
    const configured = settings({ role_timeouts: {} });
    expect(resolveSessionPolicy(configured, { role: 'viewer', cell: EDGE_CELL })).toMatchObject({
      timeoutMinutes: 15, scope: 'sector', scopeLabel: 'Setor: LSM',
    });
    expect(resolveSessionPolicy(configured, { role: 'viewer', sector: 'LSM' })).toMatchObject({
      timeoutMinutes: 30, scope: 'global', cellId: null,
    });
  });

  it('resolve nomes de células sem diferenciar maiúsculas e espaços externos', () => {
    expect(resolveSessionPolicy(settings(), { role: 'admin', cell: '  cOrTe  ' })).toMatchObject({
      timeoutMinutes: 5, scope: 'cell', cellId: CUT_CELL,
    });
  });

  it('mantém a política de UUID mesmo quando o catálogo ainda não está disponível', () => {
    expect(resolveSessionPolicy(settings({ cell_catalog: [] }), { cell: CUT_CELL })).toMatchObject({
      timeoutMinutes: 5, scope: 'cell', cellId: CUT_CELL,
    });
  });

  it('não escolhe uma célula por nome ambíguo ou desconhecido', () => {
    const configured = settings({ cell_catalog: [
      { id: CUT_CELL, name: 'Corte' }, { id: EDGE_CELL, name: 'Corte' },
    ] });
    expect(resolveSessionPolicy(configured, { cell: 'Corte' })).toMatchObject({ scope: 'global', cellId: null });
    expect(resolveSessionPolicy(settings(), { cell: 'Sem cadastro' })).toMatchObject({ scope: 'global', cellId: null });
  });

  it('usa a célula selecionada na sessão operacional antes da primária e do perfil', () => {
    const policy = resolveSessionPolicy(settings(), { role: 'admin', cell: CUT_CELL }, {
      selected_cell_id: EDGE_CELL,
      primary_cell: CUT_CELL,
    });

    expect(policy).toMatchObject({ timeoutMinutes: 10, scope: 'role', cellId: EDGE_CELL });
    expect(policy.scopeLabel).toBe('Nível de acesso: Operador');
  });

  it('usa a célula primária como alternativa operacional e não herda a célula do administrador', () => {
    expect(resolveSessionPolicy(settings(), { role: 'admin', cell: EDGE_CELL }, {
      selected_cell_id: null, primary_cell: CUT_CELL,
    })).toMatchObject({ timeoutMinutes: 5, scope: 'cell', cellId: CUT_CELL });
    expect(resolveSessionPolicy(settings(), { role: 'admin', cell: CUT_CELL }, {})).toMatchObject({
      timeoutMinutes: 10, scope: 'role', cellId: null,
    });
  });

  it('respeita aliases de papéis já suportados pelo sistema', () => {
    expect(resolveSessionPolicy(settings(), { role: 'user' })).toMatchObject({ timeoutMinutes: 10, scope: 'role' });
    expect(resolveSessionPolicy(settings({ role_timeouts: { supervisor: 20 } }), { role: 'leader' }))
      .toMatchObject({ timeoutMinutes: 20, scope: 'role' });
  });

  it.each([null, undefined, {}, { default_timeout_minutes: 0 }, { default_timeout_minutes: 1441 }])(
    'mantém o prazo seguro quando a configuração está ausente ou inválida: %j', (configured) => {
      expect(resolveSessionPolicy(configured)).toMatchObject({
        timeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
        timeoutMs: DEFAULT_SESSION_TIMEOUT_MINUTES * 60_000,
        warningSeconds: 60,
        scope: 'global',
      });
    },
  );

  it.each([0, -1, 1441, 1.5, NaN, Infinity, true, [], {}, '', '1.5', 'invalid'])(
    'ignora prazo inválido de célula e papel, herdando o setor: %j', (invalid) => {
      const configured = settings({ cell_timeouts: { [CUT_CELL]: invalid }, role_timeouts: { admin: invalid } });
      expect(resolveSessionPolicy(configured, { role: 'admin', cell: CUT_CELL }))
        .toMatchObject({ timeoutMinutes: 15, scope: 'sector' });
    },
  );

  it('aceita prazos inteiros nos limites permitidos e valores textuais do formulário', () => {
    expect(resolveSessionPolicy(settings({ default_timeout_minutes: 1 }))).toMatchObject({ timeoutMinutes: 1, warningSeconds: 59 });
    expect(resolveSessionPolicy(settings({ default_timeout_minutes: 1440 }))).toMatchObject({ timeoutMs: 86_400_000 });
    expect(resolveSessionPolicy(settings({ default_timeout_minutes: '45' }))).toMatchObject({ timeoutMinutes: 45 });
  });

  it('permite aviso desativado e limita o aviso para ocorrer antes da expiração', () => {
    expect(resolveSessionPolicy(settings({ warning_seconds: 0 })).warningSeconds).toBe(0);
    expect(resolveSessionPolicy(settings({ default_timeout_minutes: 2, warning_seconds: 300 })).warningSeconds).toBe(119);
    expect(resolveSessionPolicy(settings({ warning_seconds: 301 })).warningSeconds).toBe(60);
    expect(resolveSessionPolicy(settings({ warning_seconds: -1 })).warningSeconds).toBe(60);
  });

  it('escolhe o menor prazo de setor se uma configuração antiga duplicar a associação', () => {
    const configured = settings({
      role_timeouts: {},
      cell_timeouts: {},
      sectors: [
        { id: 'lsm', name: 'LSM', cell_ids: [CUT_CELL], timeout_minutes: 40 },
        { id: 'cs', name: 'CS', cell_ids: [CUT_CELL], timeout_minutes: 12 },
      ],
    });
    expect(resolveSessionPolicy(configured, { cell: CUT_CELL }))
      .toMatchObject({ timeoutMinutes: 12, scope: 'sector', scopeLabel: 'Setor: CS' });
  });
});

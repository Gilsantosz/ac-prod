import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils/renderWithProviders';
import SystemSettings from './SystemSettings';
import { loadSystemSettings, saveSystemSettings } from '@/lib/systemSettingsService';

const auth = vi.hoisted(() => ({ user: { id: 'admin-1', role: 'admin' }, isLoadingAuth: false }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/systemSettingsService', () => ({ loadSystemSettings: vi.fn(), saveSystemSettings: vi.fn() }));

const initial = {
  default_timeout_minutes: 30,
  warning_seconds: 60,
  role_timeouts: { operator: 10 },
  cell_timeouts: {},
  sectors: [],
  version: 4,
  cell_catalog: [{ id: 'cell-1', name: 'Corte', active: true }, { id: 'cell-2', name: 'Borda', active: true }],
};

describe('Configurações do sistema', () => {
  beforeEach(() => {
    auth.user = { id: 'admin-1', role: 'admin' };
    auth.isLoadingAuth = false;
    loadSystemSettings.mockResolvedValue(structuredClone(initial));
    saveSystemSettings.mockImplementation(async (payload) => ({ ...payload, version: 5 }));
  });

  it('bloqueia acesso direto de gestor e não carrega configurações administrativas', () => {
    auth.user = { role: 'manager', permissions: { manage_users: true, manage_system_settings: true } };
    renderWithProviders(<SystemSettings />);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(loadSystemSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Salvar configurações' })).not.toBeInTheDocument();
  });

  it('salva tempo padrão e remove regra em branco para restaurar a herança', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SystemSettings />);
    const timeout = await screen.findByLabelText('Tempo sem atividade');
    await user.clear(timeout);
    await user.type(timeout, '45');
    await user.click(screen.getByRole('tab', { name: 'Por acesso' }));
    await user.clear(screen.getByLabelText('Operador / Usuário'));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));
    await waitFor(() => expect(saveSystemSettings).toHaveBeenCalledWith(expect.objectContaining({ default_timeout_minutes: 45, role_timeouts: {}, version: 4 })));
    expect(await screen.findByText(/Configurações salvas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar configurações' })).toBeDisabled();
  });

  it('mantém a edição após conflito de versão e permite recarregar explicitamente', async () => {
    const user = userEvent.setup();
    saveSystemSettings.mockRejectedValueOnce(Object.assign(new Error('Conflito de versão'), { code: '40001' }));
    renderWithProviders(<SystemSettings />);
    const timeout = await screen.findByLabelText('Tempo sem atividade');
    await user.clear(timeout);
    await user.type(timeout, '15');
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Outro administrador alterou');
    expect(timeout).toHaveValue(15);
    expect(loadSystemSettings).toHaveBeenCalledTimes(1);
    loadSystemSettings.mockResolvedValueOnce({ ...initial, default_timeout_minutes: 20, version: 5 });
    await user.click(screen.getByRole('button', { name: 'Descartar e recarregar' }));
    await waitFor(() => expect(screen.getByLabelText('Tempo sem atividade')).toHaveValue(20));
  });

  it('associa células a setores sem duplicar a mesma célula em outro setor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SystemSettings />);
    await screen.findByLabelText('Tempo sem atividade');
    await user.click(screen.getByRole('tab', { name: 'Por setor' }));
    await user.click(screen.getByRole('button', { name: 'Adicionar setor' }));
    await user.type(screen.getByLabelText('Nome do setor 1'), 'LSM');
    await user.click(screen.getByRole('checkbox', { name: 'Corte' }));
    await user.type(screen.getByLabelText('Tempo do setor 1'), '25');
    await user.click(screen.getByRole('button', { name: 'Adicionar setor' }));
    await user.type(screen.getByLabelText('Nome do setor 2'), 'CS');
    expect(screen.getByRole('checkbox', { name: 'Corte Já pertence a LSM' })).toBeDisabled();
    await user.click(screen.getAllByRole('checkbox', { name: 'Borda' })[1]);
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));
    await waitFor(() => expect(saveSystemSettings).toHaveBeenCalledWith(expect.objectContaining({ sectors: [
      expect.objectContaining({ name: 'LSM', cell_ids: ['cell-1'], timeout_minutes: 25 }),
      expect.objectContaining({ name: 'CS', cell_ids: ['cell-2'], timeout_minutes: null }),
    ] })));
  });

  it('valida regras de outras abas antes de salvar e mantém a edição inválida visível', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SystemSettings />);
    await screen.findByLabelText('Tempo sem atividade');
    await user.click(screen.getByRole('tab', { name: 'Por acesso' }));
    await user.clear(screen.getByLabelText('Operador / Usuário'));
    await user.type(screen.getByLabelText('Operador / Usuário'), '0');
    await user.click(screen.getByRole('tab', { name: 'Geral' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tempo por nível de acesso: informe um número inteiro');
    expect(saveSystemSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Por acesso' }));
    expect(screen.getByLabelText('Operador / Usuário')).toHaveValue(0);
  });

  it('permite remover explicitamente referências a células excluídas para recuperar uma configuração salvável', async () => {
    const user = userEvent.setup();
    loadSystemSettings.mockResolvedValueOnce({
      ...initial,
      cell_timeouts: { 'removed-cell': 12, 'cell-1': 15 },
      sectors: [{ id: 'sector-1', name: 'LSM', cell_ids: ['removed-cell', 'cell-1'], timeout_minutes: 20 }],
    });
    renderWithProviders(<SystemSettings />);
    const cleanup = await screen.findByRole('button', { name: 'Remover referências a células excluídas' });
    expect(saveSystemSettings).not.toHaveBeenCalled();
    await user.click(cleanup);
    expect(screen.queryByRole('button', { name: 'Remover referências a células excluídas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));
    await waitFor(() => expect(saveSystemSettings).toHaveBeenCalledWith(expect.objectContaining({
      cell_timeouts: { 'cell-1': 15 },
      sectors: [{ id: 'sector-1', name: 'LSM', cell_ids: ['cell-1'], timeout_minutes: 20 }],
    })));
  });
});

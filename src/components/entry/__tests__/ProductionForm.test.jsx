import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductionForm from '@/components/entry/ProductionForm';
import { renderWithProviders } from '@/test/utils/renderWithProviders';

const profile = { id: 'user-test', name: 'Operador Teste', role: 'operator', cell: 'Corte' };

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: profile }) }));
vi.mock('@/hooks/useCells', () => ({
  useCells: () => ({
    activeCells: [{ id: 'cell-cut', name: 'Corte' }],
    getShiftHours: () => 8,
    getCell: () => ({ id: 'cell-cut', name: 'Corte', notes: '' }),
  }),
}));
vi.mock('@/lib/localDb', () => ({
  base44: { entities: { DailyGoal: { filter: vi.fn().mockResolvedValue([]) } } },
}));

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const result = renderWithProviders(<ProductionForm onSubmit={onSubmit} saving={false} />);
  return { ...result, onSubmit };
}

function producedInput() {
  return document.querySelector('#produzido-main');
}

describe('ProductionForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-19T11:15:00-03:00'));
  });

  afterEach(() => vi.useRealTimers());

  it('renderiza os campos atuais sem remover compatibilidade', () => {
    renderForm();
    expect(screen.getByText('Produzido')).toBeInTheDocument();
    expect(screen.getByLabelText('Refugos')).toBeInTheDocument();
    expect(screen.getByLabelText('Parada (min)')).toBeInTheDocument();
    expect(screen.getByLabelText('Observações')).toBeInTheDocument();
  });

  it('registra uma produção válida', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onSubmit } = renderForm();
    await user.type(producedInput(), '10');
    await user.click(screen.getByRole('button', { name: /registrar produção/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ produced: 10, cell: 'Corte', operator: 'Operador Teste' });
  });

  it('não permite quantidade negativa', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(producedInput(), { target: { value: '-1' } });
    fireEvent.submit(producedInput().closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('não podem ser negativos');
  });

  it('exige observação quando há refugo', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(producedInput(), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Refugos'), { target: { value: '1' } });
    fireEvent.submit(producedInput().closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('observação para registrar refugos');
  });

  it('exige motivo quando há parada', () => {
    const { onSubmit } = renderForm();
    fireEvent.change(producedInput(), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Parada (min)'), { target: { value: '15' } });
    fireEvent.submit(producedInput().closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('motivo ou a ocorrência da parada');
  });

  it('alerta quando a eficiência fica abaixo de 70%', () => {
    renderForm();
    fireEvent.change(producedInput(), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Meta / hora'), { target: { value: '100' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Eficiência abaixo de 70%');
  });

  it('mantém célula e operador vindos do perfil', () => {
    renderForm();
    expect(screen.getByText(/Célula vinculada:/)).toHaveTextContent('Corte');
    expect(screen.getByLabelText(/Operador/)).toHaveValue('Operador Teste');
  });

  it('aceita um salvamento offline enfileirado pelo chamador', async () => {
    const offlineSave = vi.fn().mockResolvedValue({ queued: true });
    renderForm(offlineSave);
    fireEvent.change(producedInput(), { target: { value: '4' } });
    fireEvent.submit(producedInput().closest('form'));
    await waitFor(() => expect(offlineSave).toHaveBeenCalledOnce());
  });

  it('preserva os campos antigos depois do salvamento', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(producedInput(), { target: { value: '5' } });
    fireEvent.submit(producedInput().closest('form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Refugos')).toBeInTheDocument();
    expect(screen.getByLabelText('Parada (min)')).toBeInTheDocument();
  });

  it('mantém o payload extensível para OP, lote, produto e etapa futuros', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(producedInput(), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Observações'), { target: { value: 'OP-TEST-001 / LSM-TEST-001 / Corte' } });
    fireEvent.submit(producedInput().closest('form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].notes).toContain('LSM-TEST-001');
  });
});

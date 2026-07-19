import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import { renderWithProviders } from '@/test/utils/renderWithProviders';

const baseProps = {
  mode: 'scanner',
  onModeChange: vi.fn(),
  loading: false,
  feedback: null,
  cellName: 'Corte',
  shift: '1º Turno',
  operator: 'Operador Teste',
};

function renderPanel(props = {}) {
  const onRead = props.onRead || vi.fn().mockResolvedValue({ success: true, status: 'approved' });
  const result = renderWithProviders(<TraceabilityScannerPanel {...baseProps} {...props} onRead={onRead} />);
  return { ...result, onRead };
}

describe('TraceabilityScannerPanel', () => {
  it('mantém foco automático no input do scanner', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText('Identificação produtiva')).toHaveFocus());
  });

  it('envia o código ao serviço ao pressionar Enter', async () => {
    const user = userEvent.setup();
    const { onRead } = renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');
    await user.type(input, 'LSM-TEST-001-P001{Enter}');
    await waitFor(() => expect(onRead).toHaveBeenCalledOnce());
    expect(onRead.mock.calls[0][0]).toMatchObject({
      rawValue: 'LSM-TEST-001-P001',
      readerType: 'keyboard_barcode',
      cellName: 'Corte',
    });
  });

  it('limpa o campo depois de uma leitura válida', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');
    await user.type(input, 'LSM-TEST-001-P001{Enter}');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('devolve o foco ao input para a próxima leitura', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');
    await user.type(input, 'LSM-TEST-001-P001{Enter}');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it.each([
    ['duplicated', 'Etiqueta já processada'],
    ['wrong_step', 'Etapa esperada: Marcenaria'],
  ])('mostra alerta para %s', (status, message) => {
    renderPanel({ feedback: { success: false, status, message } });
    const feedback = screen.getByRole('status');
    expect(feedback).toHaveAttribute('data-status', status);
    expect(feedback).toHaveClass('border-amber-300');
  });

  it('mostra feedback verde para leitura aprovada', () => {
    renderPanel({ feedback: { success: true, status: 'approved', message: 'Baixa concluída' } });
    expect(screen.getByRole('status')).toHaveClass('border-emerald-300');
  });

  it('mostra feedback vermelho para leitura rejeitada', () => {
    renderPanel({ feedback: { success: false, status: 'rejected', message: 'Peça reprovada' } });
    expect(screen.getByRole('status')).toHaveClass('border-red-300');
  });

  it('posiciona o contexto do lote logo após o campo do leitor e antes do botão', () => {
    renderPanel({
      readerContext: <div data-testid="reader-context">Lote geral 15587</div>,
      feedback: { success: true, status: 'approved', message: 'Baixa concluída' },
    });

    const input = screen.getByLabelText('Identificação produtiva');
    const inputContainer = input.parentElement;
    const reader = input.closest('form');
    const readerContext = screen.getByTestId('reader-context');
    const siblings = [...reader.parentElement.children];
    const formChildren = [...reader.children];

    expect(formChildren.indexOf(readerContext)).toBe(formChildren.indexOf(inputContainer) + 1);
    expect(formChildren.indexOf(readerContext)).toBeLessThan(
      formChildren.indexOf(screen.getByRole('button', { name: 'Processar leitura' }))
    );
    expect(siblings.indexOf(reader)).toBeLessThan(siblings.indexOf(screen.getByRole('status')));
  });

  it('não cria evento para uma leitura vazia ou inválida', () => {
    const { onRead } = renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.submit(input.closest('form'));
    expect(onRead).not.toHaveBeenCalled();
  });

  it('envia a confirmação explícita na digitação manual', async () => {
    const user = userEvent.setup();
    const { onRead } = renderPanel({ mode: 'manual' });
    await user.type(screen.getByLabelText('Identificação produtiva'), 'LSM-TEST-001-P001');
    await user.click(screen.getByText('Confirmo que conferi a identificação digitada.'));
    await user.click(screen.getByRole('button', { name: 'Confirmar baixa manual' }));
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({
      readerType: 'manual',
      confirmed: true,
    }));
  });
});

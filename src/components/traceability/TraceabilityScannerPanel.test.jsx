import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TraceabilityScannerPanel from './TraceabilityScannerPanel';

vi.mock('./ScannerModeSelector', () => ({
  default: () => <div data-testid="scanner-mode-selector" />,
}));

vi.mock('./MobileCameraScanner', () => ({
  default: () => <div data-testid="mobile-camera-scanner" />,
}));

function renderScanner(overrides = {}) {
  const onRead = overrides.onRead || vi.fn().mockResolvedValue({ success: true, status: 'approved' });
  render(
    <TraceabilityScannerPanel
      mode="scanner"
      onModeChange={vi.fn()}
      onRead={onRead}
      loading={false}
      feedback={null}
      cellName="Borda"
      shift="1º Turno"
      operator="Operador Teste"
      machine={{ id: 'machine-1', name: 'Coladeira 01' }}
      readerContext={null}
      onOpenDowntime={vi.fn()}
      onToggleKiosk={vi.fn()}
      activeDowntime={null}
      volumeEntry={null}
      {...overrides}
    />,
  );
  return { onRead, input: screen.getByLabelText('Identificação produtiva') };
}

describe('TraceabilityScannerPanel — captura rápida de 8 dígitos', () => {
  it('não dispara com 7 dígitos e dispara imediatamente no oitavo', async () => {
    const user = userEvent.setup();
    const { onRead, input } = renderScanner();

    await user.type(input, '0995000');
    expect(onRead).not.toHaveBeenCalled();
    expect(input).toHaveValue('0995000');

    await user.type(input, '1');

    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({
      rawValue: '09950001',
      fastPath: true,
      exactDigitCapture: true,
      expectedCodeLength: 8,
      readerType: 'keyboard_barcode',
    }));
    expect(input).toHaveValue('');
  });

  it('aceita uma segunda peça enquanto a primeira ainda aguarda o servidor', async () => {
    const user = userEvent.setup();
    let resolveFirst;
    const firstRequest = new Promise((resolve) => { resolveFirst = resolve; });
    const onRead = vi.fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce({ success: true, status: 'approved' });
    const { input } = renderScanner({ onRead });

    await user.type(input, '09950001');
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('');

    await user.type(input, '09950002');
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue('');
    expect(onRead.mock.calls.map(([payload]) => payload.rawValue)).toEqual(['09950001', '09950002']);

    resolveFirst({ success: true, status: 'approved' });
  });

  it('não duplica a leitura quando o coletor envia Enter após o oitavo dígito', async () => {
    const user = userEvent.setup();
    const { onRead, input } = renderScanner();

    await user.type(input, '09950001{enter}');

    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('');
  });

  it('bloqueia numeração maior que 8 dígitos em vez de truncar silenciosamente', () => {
    const { onRead, input } = renderScanner();

    fireEvent.change(input, { target: { value: '099500011' } });

    expect(onRead).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent(/excedeu o limite de 8 dígitos/);
  });

  it('bloqueia caracteres não numéricos', () => {
    const { onRead, input } = renderScanner();

    fireEvent.change(input, { target: { value: 'ABC09950001' } });

    expect(onRead).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/somente dígitos/);
  });

  it('mantém o scanner bloqueado até o Supabase confirmar o contexto operacional', async () => {
    const user = userEvent.setup();
    const { onRead, input } = renderScanner({
      contextReady: false,
      contextMessage: 'Validando a célula do operador no servidor...',
    });

    expect(input).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/validando a célula do operador/i);
    await user.type(input, '09950001');
    expect(onRead).not.toHaveBeenCalled();
  });
});

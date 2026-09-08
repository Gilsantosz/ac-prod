import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TraceabilityScannerPanel from '@/components/traceability/TraceabilityScannerPanel';
import { renderWithProviders } from '@/test/utils/renderWithProviders';
import CollectionLotBanner from '@/components/collection/CollectionLotBanner';
import { mergeCollectionFeedback, resolveCollectionLotContext } from '@/lib/collectionFeedback';
import { enrichCollectionResult } from '@/lib/collectionResultMetadata';

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

  it('registra no 8º dígito e ignora o Enter enviado pelo scanner', async () => {
    const user = userEvent.setup();
    const { onRead } = renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');

    await user.type(input, '09950001{Enter}');

    await waitFor(() => expect(onRead).toHaveBeenCalledOnce());
    expect(onRead.mock.calls[0][0]).toMatchObject({
      rawValue: '09950001',
      readerType: 'keyboard_barcode',
      cellName: 'Corte',
      exactDigitCapture: true,
      expectedCodeLength: 8,
    });
  });

  it('limpa o campo imediatamente depois da captura válida', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');

    await user.type(input, '09950001');

    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('devolve o foco ao input para a próxima leitura', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');

    await user.type(input, '09950001');

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

  it('uma aprovação confirmada nunca mantém a mensagem antiga de processamento', () => {
    renderPanel({ feedback: { collection_state: 'APPROVED', status: 'approved', message: 'Leitura preservada e aguardando processamento.' } });
    expect(screen.getByText('PEÇA LIBERADA — OK')).toBeInTheDocument();
    expect(screen.getByText('Leitura aprovada.')).toBeInTheDocument();
    expect(screen.queryByText(/aguardando processamento/i)).not.toBeInTheDocument();
  });

  it('mostra feedback verde para leitura aprovada', () => {
    renderPanel({ feedback: { success: true, status: 'approved', message: 'Baixa concluída' } });
    expect(screen.getByRole('status')).toHaveClass('border-emerald-300');
  });

  it('exibe peça e ambos os lotes assim que o HTTP completa a aprovação do Broadcast', () => {
    const compact = { client_event_id: 'event-3', decision: 'approved' };
    const initial = mergeCollectionFeedback(null, compact);
    const view = (feedback) => <TraceabilityScannerPanel {...baseProps} onRead={vi.fn()}
      feedback={feedback} readerContext={<CollectionLotBanner {...resolveCollectionLotContext({ feedback })} />} />;
    const { rerender } = renderWithProviders(view(initial));
    expect(screen.getByText('PEÇA LIBERADA — OK')).toBeInTheDocument();
    expect(screen.queryByText('09890703')).not.toBeInTheDocument();
    const result = enrichCollectionResult(compact, { decision: 'approved',
      item: { id: 'piece-3', traceability_code: '09890703', piece_name: 'PECA TESTE 03' },
      lot: { id: 'lot-1', lot_code: '947001', general_lot_code: 'TESTECOLETA20260907' },
      customer_name: 'CLIENTE TESTE',
    });
    rerender(view(mergeCollectionFeedback(initial, result)));
    expect(screen.getByText('09890703')).toBeInTheDocument();
    expect(screen.getByText('TESTECOLETA20260907')).toBeInTheDocument();
    expect(screen.getAllByText('947001')).toHaveLength(2);
    expect(screen.getByText('PEÇA LIBERADA — OK')).toBeInTheDocument();
    expect(screen.queryByText(/aguardando processamento/i)).not.toBeInTheDocument();
  });

  it('mantém ACK do banco neutro mesmo se um payload legado trouxer success', () => {
    renderPanel({
      feedback: {
        success: true,
        status: 'database_acknowledged',
        collection_state: 'DATABASE_ACKNOWLEDGED',
        message: 'Recebida no banco',
      },
    });
    const feedback = screen.getByRole('status');
    expect(feedback).toHaveClass('border-blue-500/30');
    expect(feedback).not.toHaveClass('border-emerald-300');
    expect(screen.queryByText('PEÇA LIBERADA — OK')).not.toBeInTheDocument();
  });

  it('mostra feedback vermelho para leitura rejeitada', () => {
    renderPanel({ feedback: { success: false, status: 'rejected', message: 'Peça reprovada' } });
    expect(screen.getByRole('status')).toHaveClass('border-red-300');
  });

  it('mantém o contexto do lote dentro do leitor, após o campo e antes do feedback', () => {
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

    expect(reader.contains(readerContext)).toBe(true);
    expect(formChildren.indexOf(readerContext)).toBeGreaterThan(formChildren.indexOf(inputContainer));
    expect(siblings.indexOf(reader)).toBeLessThan(siblings.indexOf(screen.getByRole('status')));
  });

  it('não cria evento para uma leitura vazia ou inválida', () => {
    const { onRead } = renderPanel();
    const input = screen.getByLabelText('Identificação produtiva');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.submit(input.closest('form'));
    expect(onRead).not.toHaveBeenCalled();
  });

  it('envia a confirmação explícita na digitação manual de 8 dígitos', async () => {
    const user = userEvent.setup();
    const { onRead } = renderPanel({ mode: 'manual' });

    await user.type(screen.getByLabelText('Identificação produtiva'), '09950001');
    await user.click(screen.getByText('Confirmo que conferi os 8 dígitos informados.'));
    await user.click(screen.getByRole('button', { name: 'Confirmar baixa manual' }));

    await waitFor(() => expect(onRead).toHaveBeenCalledOnce());
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({
      rawValue: '09950001',
      readerType: 'manual',
      confirmed: true,
      expectedCodeLength: 8,
    }));
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  getCollectionHistory: vi.fn(),
  getCollectionHistoryCount: vi.fn(),
  subscribeToCollectionHistory: vi.fn(),
  unsubscribeFromCollectionHistory: vi.fn(),
}));

vi.mock('@/lib/collectionService', () => mocks);
vi.mock('../CollectionReadItem', () => ({
  default: () => <div data-testid="collection-read-item" />,
}));

import CollectionRecentReadsPanel from '../CollectionRecentReadsPanel';

describe('CollectionRecentReadsPanel realtime refresh', () => {
  let realtimeCallback;
  let queryClient;
  const renderPanel = (children) => render(children, {
    wrapper: ({ children: content }) => <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    realtimeCallback = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    mocks.getCollectionHistory.mockResolvedValue([]);
    mocks.getCollectionHistoryCount.mockResolvedValue(0);
    mocks.subscribeToCollectionHistory.mockImplementation(({ callback }) => {
      realtimeCallback = callback;
      return { topic: 'collection-history-test' };
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('limita uma rajada de eventos a uma consulta por janela de 750 ms', async () => {
    const view = renderPanel(
      <CollectionRecentReadsPanel
        cellId="cell-1"
        cellName="Corte"
        workstationId="workstation-1"
        operatorId="operator-1"
        shift="1º Turno"
        onSelectPiece={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(realtimeCallback).toEqual(expect.any(Function));
    expect(mocks.getCollectionHistory).toHaveBeenCalledWith(expect.objectContaining({
      cellId: 'cell-1',
      cellName: 'Corte',
      workstationId: null,
    }));
    mocks.getCollectionHistory.mockClear();
    mocks.getCollectionHistoryCount.mockClear();
    expect(mocks.subscribeToCollectionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ cellId: 'cell-1', cellName: 'Corte' }),
    );

    act(() => {
      for (let index = 0; index < 20; index += 1) realtimeCallback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(1);

    act(() => {
      for (let index = 0; index < 20; index += 1) realtimeCallback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(749);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(2);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(mocks.unsubscribeFromCollectionHistory).toHaveBeenCalledTimes(1);
  });

  it('só restringe o histórico à máquina quando o usuário escolhe esse filtro', async () => {
    const view = renderPanel(
      <CollectionRecentReadsPanel
        cellId="cell-1"
        cellName="Usinagem CNC"
        workstationId="machine-1"
        operatorId="operator-1"
        shift="1º Turno"
        onSelectPiece={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.getCollectionHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ workstationId: null }),
    );

    mocks.getCollectionHistory.mockClear();
    fireEvent.change(screen.getByDisplayValue('Todas as máquinas'), {
      target: { value: 'current' },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.getCollectionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ cellId: 'cell-1', workstationId: 'machine-1' }),
    );
    view.unmount();
  });

  it('compartilha a consulta entre painel e modo foco e não sobrepõe sinais ao GET inicial', async () => {
    let finish;
    mocks.getCollectionHistory.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const props = {
      cellId: 'cell-1', cellName: 'Corte', workstationId: 'machine-1',
      operatorId: 'operator-1', shift: '1º Turno', onSelectPiece: vi.fn(),
    };
    const view = renderPanel(<>
      <CollectionRecentReadsPanel {...props} />
      <CollectionRecentReadsPanel {...props} />
    </>);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    act(() => {
      for (let index = 0; index < 100; index += 1) realtimeCallback();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish([]);
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});

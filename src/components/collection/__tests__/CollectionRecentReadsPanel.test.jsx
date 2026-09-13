import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

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

import CollectionRecentReadsPanel, {
  getCollectionHistoryFallbackDelay,
} from '../CollectionRecentReadsPanel';

describe('CollectionRecentReadsPanel realtime refresh', () => {
  let realtimeCallback;
  let realtimeStatusCallback;
  let queryClient;
  const renderPanel = (children) => render(children, {
    wrapper: ({ children: content }) => <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    realtimeCallback = null;
    realtimeStatusCallback = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    mocks.getCollectionHistory.mockResolvedValue([]);
    mocks.getCollectionHistoryCount.mockResolvedValue(0);
    mocks.subscribeToCollectionHistory.mockImplementation(({ callback, onStatus }) => {
      realtimeCallback = callback;
      realtimeStatusCallback = onStatus;
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

  it('atualiza os KPIs da célula pelo canal filtrado e pelo fallback periódico', async () => {
    const fetchKpis = vi.fn().mockResolvedValue({ approved: 1 });
    const fetchShiftKpis = vi.fn().mockResolvedValue({ approved: 1 });
    const KpiObserver = () => {
      useQuery({
        queryKey: ['collection-kpis', 'Corte', 'machine-1'],
        queryFn: fetchKpis,
      });
      useQuery({
        queryKey: ['operator-shift-kpis', 'operator-1', '1º Turno'],
        queryFn: fetchShiftKpis,
      });
      return null;
    };
    const view = renderPanel(<>
      <KpiObserver />
      <CollectionRecentReadsPanel
        cellId="cell-1"
        cellName="Corte"
        workstationId="machine-1"
        operatorId="operator-1"
        shift="1º Turno"
        onSelectPiece={vi.fn()}
      />
    </>);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchKpis).toHaveBeenCalledTimes(1);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(1);

    act(() => realtimeCallback());
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(fetchKpis).toHaveBeenCalledTimes(2);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(2);

    act(() => realtimeStatusCallback('SUBSCRIBED'));
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(fetchKpis).toHaveBeenCalledTimes(3);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(3);

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchKpis).toHaveBeenCalledTimes(3);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(3);

    act(() => realtimeStatusCallback('TIMED_OUT'));
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(fetchKpis).toHaveBeenCalledTimes(3);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(3);

    await act(async () => vi.advanceTimersByTimeAsync(4_751));
    expect(fetchKpis).toHaveBeenCalledTimes(4);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it('mantém o jitter do fallback entre 15 e 19 segundos', () => {
    expect(getCollectionHistoryFallbackDelay(-1)).toBe(15_000);
    expect(getCollectionHistoryFallbackDelay(0)).toBe(15_000);
    expect(getCollectionHistoryFallbackDelay(0.5)).toBe(17_000);
    expect(getCollectionHistoryFallbackDelay(1)).toBe(19_000);
    expect(getCollectionHistoryFallbackDelay(2)).toBe(19_000);
  });
});

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
  COLLECTION_HISTORY_FALLBACK_MAX_MS,
  COLLECTION_HISTORY_FALLBACK_MIN_MS,
  collectionHistoryRowFromRealtimePayload,
  getCollectionHistoryFallbackDelay,
} from '../CollectionRecentReadsPanel';

describe('CollectionRecentReadsPanel realtime refresh', () => {
  let realtimeCallback;
  let realtimeStatusCallback;
  let queryClient;
  const renderPanel = (children) => render(children, {
    wrapper: ({ children: content }) => <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>,
  });
  const flushInitialQuery = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'));
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
    vi.restoreAllMocks();
  });

  it('aplica INSERT e UPDATE terminais no cache sem novo GET ou COUNT', async () => {
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

    await flushInitialQuery();
    expect(realtimeCallback).toEqual(expect.any(Function));
    const historyQuery = queryClient.getQueryCache().findAll({ queryKey: ['stageReadings'] })[0];
    await act(async () => queryClient.cancelQueries({ queryKey: historyQuery.queryKey, exact: true }));
    act(() => queryClient.setQueryData(historyQuery.queryKey, { readings: [], totalCount: 0 }));
    mocks.getCollectionHistory.mockClear();
    mocks.getCollectionHistoryCount.mockClear();

    act(() => realtimeCallback({
      eventType: 'INSERT',
      new: {
        id: 'event-1',
        client_event_id: 'client-event-1',
        cell_id: 'cell-1',
        cell_name: 'Corte',
        shift: '1º Turno',
        result_status: 'approved',
        status: 'synced',
        raw_value: '09908511',
        general_lot_code: '15587',
        lot_code: '14403',
        order_number: '143403',
        customer_name: 'Cliente Exemplo',
        created_at: '2026-09-13T05:00:00.000Z',
      },
    }));
    await act(async () => { await Promise.resolve(); });

    expect(mocks.getCollectionHistory).not.toHaveBeenCalled();
    expect(mocks.getCollectionHistoryCount).not.toHaveBeenCalled();
    const cached = queryClient.getQueryCache().findAll({ queryKey: ['stageReadings'] })[0].state.data;
    expect(cached.totalCount).toBe(1);
    expect(cached.readings[0]).toMatchObject({
      id: 'event-1',
      event_status: 'approved',
      pcp_batch_name: '15587',
      lot_code: '14403',
      client_name: 'Cliente Exemplo',
    });

    act(() => realtimeCallback({
      eventType: 'UPDATE',
      new: {
        ...cached.readings[0],
        id: 'event-1',
        client_event_id: 'client-event-1',
        projected_at: '2026-09-13T05:00:02.000Z',
      },
    }));
    const updated = queryClient.getQueryCache().findAll({ queryKey: ['stageReadings'] })[0].state.data;
    expect(updated.totalCount).toBe(1);
    expect(updated.readings[0].projected_at).toBe('2026-09-13T05:00:02.000Z');

    view.unmount();
    expect(mocks.unsubscribeFromCollectionHistory).toHaveBeenCalledTimes(1);
  });

  it('não consulta o banco ao receber SUBSCRIBED', async () => {
    const view = renderPanel(
      <CollectionRecentReadsPanel cellId="cell-1" cellName="Corte" shift="1º Turno" onSelectPiece={vi.fn()} />,
    );
    await flushInitialQuery();
    mocks.getCollectionHistory.mockClear();
    mocks.getCollectionHistoryCount.mockClear();

    act(() => realtimeStatusCallback('SUBSCRIBED'));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(mocks.getCollectionHistory).not.toHaveBeenCalled();
    expect(mocks.getCollectionHistoryCount).not.toHaveBeenCalled();
    expect(screen.getByText('Ativa (Realtime)')).toBeInTheDocument();
    view.unmount();
  });

  it('desliga totalmente a assinatura e reconcilia por HTTP entre 60 e 90 segundos', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const view = renderPanel(
      <CollectionRecentReadsPanel
        cellId="cell-1"
        cellName="Corte"
        operatorId="operator-1"
        shift="1º Turno"
        realtimeEnabled={false}
        onSelectPiece={vi.fn()}
      />,
    );
    await flushInitialQuery();
    expect(mocks.subscribeToCollectionHistory).not.toHaveBeenCalled();
    expect(screen.getByText('Automática (60–90 s)')).toBeInTheDocument();
    mocks.getCollectionHistory.mockClear();
    mocks.getCollectionHistoryCount.mockClear();

    await act(async () => vi.advanceTimersByTimeAsync(COLLECTION_HISTORY_FALLBACK_MIN_MS + 749));
    expect(mocks.getCollectionHistory).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.unsubscribeFromCollectionHistory).not.toHaveBeenCalled();
  });

  it('permite que a página centralize a reconciliação sem timer local', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const view = renderPanel(
      <CollectionRecentReadsPanel
        cellId="cell-1"
        cellName="Corte"
        shift="1º Turno"
        realtimeEnabled={false}
        periodicReconciliationEnabled={false}
        onSelectPiece={vi.fn()}
      />,
    );
    await flushInitialQuery();
    mocks.getCollectionHistory.mockClear();
    mocks.getCollectionHistoryCount.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLECTION_HISTORY_FALLBACK_MAX_MS + 750);
    });

    expect(mocks.subscribeToCollectionHistory).not.toHaveBeenCalled();
    expect(mocks.getCollectionHistory).not.toHaveBeenCalled();
    expect(mocks.getCollectionHistoryCount).not.toHaveBeenCalled();
    view.unmount();
  });

  it('só restringe o histórico à máquina quando o usuário escolhe esse filtro', async () => {
    const view = renderPanel(
      <CollectionRecentReadsPanel
        cellId="cell-1"
        cellName="Usinagem CNC"
        workstationId="machine-1"
        operatorId="operator-1"
        shift="1º Turno"
        realtimeEnabled={false}
        onSelectPiece={vi.fn()}
      />,
    );

    await flushInitialQuery();
    expect(mocks.getCollectionHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ workstationId: null }),
    );

    mocks.getCollectionHistory.mockClear();
    fireEvent.change(screen.getByDisplayValue('Todas as máquinas'), {
      target: { value: 'current' },
    });
    await flushInitialQuery();

    expect(mocks.getCollectionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ cellId: 'cell-1', workstationId: 'machine-1' }),
    );
    view.unmount();
  });

  it('compartilha o GET inicial entre painel e modo foco e não refaz por evento', async () => {
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
    act(() => realtimeCallback({
      eventType: 'INSERT',
      new: {
        id: 'event-2', cell_id: 'cell-1', cell_name: 'Corte', shift: '1º Turno',
        result_status: 'approved', raw_value: '09908512', created_at: new Date().toISOString(),
      },
    }));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    await act(async () => { finish([]); });
    view.unmount();
  });

  it('reutiliza o cache já resolvido ao montar o segundo painel do modo foco', async () => {
    const props = {
      cellId: 'cell-1', cellName: 'Corte', workstationId: 'machine-1',
      operatorId: 'operator-1', shift: '1º Turno', realtimeEnabled: false,
      periodicReconciliationEnabled: false, onSelectPiece: vi.fn(),
    };
    const view = renderPanel(<CollectionRecentReadsPanel {...props} />);
    await flushInitialQuery();
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(1);

    view.rerender(<>
      <CollectionRecentReadsPanel {...props} />
      <CollectionRecentReadsPanel {...props} refetchOnMount={false} />
    </>);
    await flushInitialQuery();

    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('não apaga uma leitura confirmada quando um GET anterior termina depois do ACK', async () => {
    const generation = { current: 0 };
    const view = renderPanel(<CollectionRecentReadsPanel cellId="cell-1" cellName="Corte"
      shift="1º Turno" realtimeEnabled={false} periodicReconciliationEnabled={false}
      localResultGenerationRef={generation} onSelectPiece={vi.fn()} />);
    await flushInitialQuery();
    const key = queryClient.getQueryCache().findAll({ queryKey: ['stageReadings'] })[0].queryKey;
    let finishSnapshot;
    mocks.getCollectionHistory.mockImplementationOnce(() => new Promise((resolve) => { finishSnapshot = resolve; }));
    act(() => { void queryClient.invalidateQueries({ queryKey: key, exact: true }); });
    await flushInitialQuery();
    const confirmed = { id: 'reading-confirmed', client_event_id: 'event-confirmed',
      reading_status: 'approved', created_at: new Date().toISOString() };
    act(() => {
      generation.current += 1;
      queryClient.setQueryData(key, { readings: [confirmed], totalCount: 1 });
    });
    await act(async () => { finishSnapshot([]); });
    // Entrega a notificação assíncrona do React Query antes de medir o prazo
    // iniciado pelo efeito de reconciliação do painel.
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(queryClient.getQueryData(key)).toMatchObject({
      readings: [confirmed], totalCount: 1, counter_reconciliation_required: true,
    });
    mocks.getCollectionHistory.mockResolvedValue([confirmed]);
    mocks.getCollectionHistoryCount.mockResolvedValue(1);
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData(key).counter_reconciliation_required).toBeUndefined();
    expect(queryClient.getQueryData(key).totalCount).toBe(1);
    view.unmount();
  });

  it('compartilha também o ciclo HTTP entre painel normal e modo foco', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const props = {
      cellId: 'cell-1',
      cellName: 'Corte',
      operatorId: 'operator-1',
      shift: '1º Turno',
      realtimeEnabled: false,
      onSelectPiece: vi.fn(),
    };
    const view = renderPanel(<>
      <CollectionRecentReadsPanel {...props} />
      <CollectionRecentReadsPanel {...props} />
    </>);
    await flushInitialQuery();
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    mocks.getCollectionHistory.mockClear();
    mocks.getCollectionHistoryCount.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLECTION_HISTORY_FALLBACK_MIN_MS + 750);
    });

    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('reconcilia histórico e KPIs somente na janela periódica', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchKpis = vi.fn().mockResolvedValue({ approved: 1 });
    const fetchShiftKpis = vi.fn().mockResolvedValue({ approved: 1 });
    const KpiObserver = () => {
      useQuery({ queryKey: ['collection-kpis', 'Corte', 'machine-1'], queryFn: fetchKpis });
      useQuery({ queryKey: ['operator-shift-kpis', 'operator-1', '1º Turno'], queryFn: fetchShiftKpis });
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
        realtimeEnabled={false}
        onSelectPiece={vi.fn()}
      />
    </>);

    await flushInitialQuery();
    expect(fetchKpis).toHaveBeenCalledTimes(1);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(COLLECTION_HISTORY_FALLBACK_MIN_MS + 750));
    expect(fetchKpis).toHaveBeenCalledTimes(2);
    expect(fetchShiftKpis).toHaveBeenCalledTimes(2);
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(2);
    expect(mocks.getCollectionHistoryCount).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('normaliza snapshots terminais e ignora estados ainda em processamento', () => {
    expect(collectionHistoryRowFromRealtimePayload({
      new: { id: 'pending', status: 'processing', result_payload: {} },
    })).toBeNull();
    expect(collectionHistoryRowFromRealtimePayload({
      new: {
        id: 'blocked', result_status: 'wrong_step', raw_value: '09908513',
        general_lot_code: 'GER-1', customer_name: 'Cliente', created_at: '2026-09-13T05:00:00Z',
      },
    })).toMatchObject({
      id: 'blocked', event_status: 'blocked', pcp_batch_name: 'GER-1', client_name: 'Cliente',
    });
  });

  it('mantém o jitter do fallback entre 60 e 90 segundos', () => {
    expect(getCollectionHistoryFallbackDelay(-1)).toBe(60_000);
    expect(getCollectionHistoryFallbackDelay(0)).toBe(60_000);
    expect(getCollectionHistoryFallbackDelay(0.5)).toBe(75_000);
    expect(getCollectionHistoryFallbackDelay(1)).toBe(90_000);
    expect(getCollectionHistoryFallbackDelay(2)).toBe(90_000);
  });
});

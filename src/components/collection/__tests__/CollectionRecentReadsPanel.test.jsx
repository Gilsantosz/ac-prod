import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    realtimeCallback = null;
    mocks.getCollectionHistory.mockResolvedValue([]);
    mocks.getCollectionHistoryCount.mockResolvedValue(0);
    mocks.subscribeToCollectionHistory.mockImplementation(({ callback }) => {
      realtimeCallback = callback;
      return { topic: 'collection-history-test' };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('limita uma rajada de eventos a uma consulta por janela de cinco segundos', async () => {
    const view = render(
      <CollectionRecentReadsPanel
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
    mocks.getCollectionHistory.mockClear();

    act(() => {
      for (let index = 0; index < 20; index += 1) realtimeCallback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);

    act(() => {
      for (let index = 0; index < 20; index += 1) realtimeCallback();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.getCollectionHistory).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(mocks.unsubscribeFromCollectionHistory).toHaveBeenCalledTimes(1);
  });
});

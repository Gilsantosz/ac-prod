import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { getQueue } from '@/lib/offlineQueue';

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

describe('useOfflineSync', () => {
  beforeEach(() => {
    localStorage.clear();
    setOnline(false);
  });

  afterEach(() => setOnline(true));

  it('enfileira a entrada offline sem perder os dados', async () => {
    const create = vi.fn();
    const { result } = renderHook(() => useOfflineSync(create));

    await act(() => result.current.save({ cell: 'Corte', produced: 10 }));

    expect(create).not.toHaveBeenCalled();
    expect(getQueue()).toEqual([
      expect.objectContaining({ cell: 'Corte', produced: 10, _tempId: expect.any(String) }),
    ]);
    expect(result.current.pending).toBe(1);
  });

  it('sincroniza a fila quando a conexão retorna', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const onSynced = vi.fn();
    const { result } = renderHook(() => useOfflineSync(create, onSynced));
    await act(() => result.current.save({ cell: 'Corte', produced: 5 }));

    setOnline(true);
    act(() => window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ cell: 'Corte', produced: 5 }));
    await waitFor(() => expect(getQueue()).toHaveLength(0));
    expect(onSynced).toHaveBeenCalledWith(1);
  });
});

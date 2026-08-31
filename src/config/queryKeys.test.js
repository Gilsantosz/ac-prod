import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MES_QUERY_KEYS,
  flushPendingMesInvalidation,
  invalidateAllMesQueries,
} from '@/config/queryKeys';

describe('MES query invalidation debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('consolida vários eventos Realtime em uma única rodada de refetch', async () => {
    vi.useFakeTimers();
    const queryClient = { invalidateQueries: vi.fn() };

    const firstTimer = invalidateAllMesQueries(queryClient);
    const secondTimer = invalidateAllMesQueries(queryClient);
    const thirdTimer = invalidateAllMesQueries(queryClient);

    expect(firstTimer).toBe(secondTimer);
    expect(secondTimer).toBe(thirdTimer);

    await vi.advanceTimersByTimeAsync(749);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(
      Object.keys(MES_QUERY_KEYS).length,
    );
  });

  it('permite atualização manual imediata sem deixar timer duplicado', async () => {
    vi.useFakeTimers();
    const queryClient = { invalidateQueries: vi.fn() };

    invalidateAllMesQueries(queryClient);
    flushPendingMesInvalidation(queryClient);

    const expectedCalls = Object.keys(MES_QUERY_KEYS).length;
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(expectedCalls);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(expectedCalls);
  });
});

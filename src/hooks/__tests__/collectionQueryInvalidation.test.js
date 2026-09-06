import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createCollectionQueryInvalidator } from '@/hooks/collectionQueryInvalidation';

describe('collection invalidation backpressure', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('consolida mil eventos em uma invalidação sem adiar uma rajada contínua', async () => {
    const queryClient = { invalidateQueries: vi.fn().mockResolvedValue() };
    const invalidator = createCollectionQueryInvalidator(queryClient);
    for (let tick = 0; tick < 10; tick += 1) {
      for (let index = 0; index < 100; index += 1) {
        invalidator.enqueue({ queryKey: ['collection-kpis'] });
      }
      await vi.advanceTimersByTimeAsync(75);
    }
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      { predicate: expect.any(Function), refetchType: 'active' },
      { cancelRefetch: false },
    );
    invalidator.stop();
  });

  it('reúne escopos sem invalidar outra célula ou outra família de queries', async () => {
    const queryClient = { invalidateQueries: vi.fn().mockResolvedValue() };
    const invalidator = createCollectionQueryInvalidator(queryClient);
    invalidator.enqueue({ queryKey: ['collection-kpis', 'Corte'] });
    invalidator.enqueue({ queryKey: ['stageReadings', 'Bordo'] });
    await vi.advanceTimersByTimeAsync(750);
    const { predicate } = queryClient.invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: ['collection-kpis', 'Corte', 'machine-1'] })).toBe(true);
    expect(predicate({ queryKey: ['stageReadings', 'Bordo', null] })).toBe(true);
    expect(predicate({ queryKey: ['collection-kpis', 'Bordo'] })).toBe(false);
    expect(predicate({ queryKey: ['profile'] })).toBe(false);
    invalidator.stop();
  });

  it('não sobrepõe GETs lentos e preserva uma atualização posterior', async () => {
    let finish;
    const request = new Promise((resolve) => { finish = resolve; });
    const queryClient = { invalidateQueries: vi.fn().mockReturnValueOnce(request).mockResolvedValue() };
    const invalidator = createCollectionQueryInvalidator(queryClient);
    invalidator.enqueue({ queryKey: ['stageReadings'] });
    await vi.advanceTimersByTimeAsync(750);
    for (let index = 0; index < 100; index += 1) {
      invalidator.enqueue({ queryKey: ['stageReadings'] });
    }
    await vi.advanceTimersByTimeAsync(5_000);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(749);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    invalidator.stop();
  });

  it('refaz a fotografia após um GET iniciado antes do evento, sem cancelá-lo', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let finish;
    const queryKey = ['stageReadings', 'Corte', null];
    const queryFn = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(['new']);
    const first = queryClient.fetchQuery({ queryKey, queryFn });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const invalidator = createCollectionQueryInvalidator(queryClient);
    invalidator.enqueue({ queryKey });
    await vi.advanceTimersByTimeAsync(750);
    expect(queryFn).toHaveBeenCalledTimes(1);
    finish(['old']);
    await first;
    await vi.advanceTimersByTimeAsync(750);
    // A query sem observador não refaz rede, mas recebe a invalidação final.
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(queryKey).isInvalidated).toBe(true);
    invalidator.stop();
    queryClient.clear();
  });
});

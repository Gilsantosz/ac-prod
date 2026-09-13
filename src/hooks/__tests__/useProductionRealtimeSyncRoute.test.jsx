import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
  scheduleInvalidation: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

vi.mock('@/hooks/collectionQueryInvalidation', () => ({
  scheduleCollectionQueryInvalidation: mocks.scheduleInvalidation,
}));

import { useProductionRealtimeSync } from '@/hooks/useProductionRealtimeSync';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useProductionRealtimeSync por rota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.removeChannel.mockResolvedValue('ok');
    mocks.channel.mockImplementation(() => {
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => channel),
      };
      return channel;
    });
  });

  it('remove o canal ao entrar na coleta e abre outro ao sair', () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useProductionRealtimeSync({ enabled }),
      { initialProps: { enabled: true }, wrapper: createWrapper() },
    );

    const firstChannel = mocks.channel.mock.results[0].value;
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    expect(firstChannel.on).toHaveBeenCalledTimes(27);

    rerender({ enabled: false });
    expect(mocks.removeChannel).toHaveBeenCalledWith(firstChannel);

    rerender({ enabled: true });
    const secondChannel = mocks.channel.mock.results[1].value;
    expect(mocks.channel).toHaveBeenCalledTimes(2);
    expect(secondChannel).not.toBe(firstChannel);
    expect(secondChannel.on).toHaveBeenCalledTimes(27);

    unmount();
    expect(mocks.removeChannel).toHaveBeenLastCalledWith(secondChannel);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export function renderWithProviders(ui, options = {}) {
  const queryClient = options.queryClient || new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return {
    queryClient,
    ...render(
      <MemoryRouter initialEntries={options.initialEntries || ['/']}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </MemoryRouter>,
      options.renderOptions,
    ),
  };
}

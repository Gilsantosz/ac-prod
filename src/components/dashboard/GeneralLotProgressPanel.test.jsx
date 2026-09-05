import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { from } }));
import GeneralLotProgressPanel from './GeneralLotProgressPanel';

describe('lotes do recorte selecionado', () => {
  it('consulta a relação com os lotes filtrados e limpa o resultado ao selecionar um recorte vazio', async () => {
    const inFilter = vi.fn();
    from.mockImplementation(() => {
      let ids = [];
      const query = { select: () => query, order: () => query, in: (column, values) => {
        inFilter(column, values);
        if (column === 'production_lots.id') ids = values;
        return query;
      }, limit: async () => ({ data: ids.map(id => ({ id, general_lot_code: `LOTE-${id}`, progress_percent: 50, completed_parts: 5, total_parts: 10 })), error: null }) };
      return query;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Page = ({ ids }) => <QueryClientProvider client={client}><GeneralLotProgressPanel lotIds={ids} /></QueryClientProvider>;
    const view = render(<Page ids={['A']} />);
    expect(await screen.findByText('LOTE-A')).toBeInTheDocument();
    view.rerender(<Page ids={['B']} />);
    expect(await screen.findByText('LOTE-B')).toBeInTheDocument();
    expect(screen.queryByText('LOTE-A')).not.toBeInTheDocument();
    expect(inFilter).toHaveBeenCalledWith('production_lots.id', ['B']);
    view.rerender(<Page ids={[]} />);
    await waitFor(() => expect(screen.getByText('Nenhum lote PCP vinculado aos registros selecionados.')).toBeInTheDocument());
    expect(screen.queryByText('LOTE-B')).not.toBeInTheDocument();
    expect(from).toHaveBeenCalledTimes(2);
  });
});

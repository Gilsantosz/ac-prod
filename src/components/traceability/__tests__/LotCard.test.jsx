import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LotCard from '@/components/traceability/LotCard';
import { renderWithProviders } from '@/test/utils/renderWithProviders';

const routeProgress = [
  { id: 'cut', step_name: 'cut', total: 30, collected: 0, pending: 30 },
  { id: 'edge', step_name: 'edge', total: 30, collected: 0, pending: 30 },
  { id: 'drill', step_name: 'drill', total: 30, collected: 0, pending: 30 },
  { id: 'cnc', step_name: 'cnc', total: 30, collected: 0, pending: 30 },
  { id: 'joinery', step_name: 'joinery', total: 2, collected: 1, pending: 1 },
];

function renderCard() {
  return renderWithProviders(
    <LotCard
      lot={{
        id: 'lot-1',
        lot_code: '143357',
        current_stage: 'cut',
        current_step: 'cut',
        current_cell: 'Corte',
        status: 'in_progress',
        production_orders: { customer_name: 'Cliente Teste' },
        traceability_progress: { total: 30, completed: 0, pending: 30, percent: 0.82 },
        route_progress: routeProgress,
      }}
      onAdvance={vi.fn()}
      onBlock={vi.fn()}
      onUnblock={vi.fn()}
    />
  );
}

describe('LotCard', () => {
  it('comunica a base real do percentual e não adianta a etapa sem coleta', () => {
    renderCard();

    expect(screen.getByText('Etapa atual real: Corte')).toBeInTheDocument();
    expect(screen.getByText('Base: 1/122 operações confirmadas')).toBeInTheDocument();
    expect(screen.getAllByText('0/30')).toHaveLength(4);
    expect(screen.getByText('0 peças finalizadas')).toBeInTheDocument();
  });

  it('permite abrir as etapas ocultas para explicar o percentual', async () => {
    const user = userEvent.setup();
    renderCard();

    expect(screen.queryByText('Marcenaria')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver mais 1 etapa' }));
    expect(screen.getByText('Marcenaria')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });
});

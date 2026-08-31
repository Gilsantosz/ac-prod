import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import ReplacementOrderCard from '@/components/replacement/ReplacementOrderCard';

function TraceabilityDestination() {
  const location = useLocation();
  return <div data-testid="traceability-destination">{location.pathname}{location.search}</div>;
}

const requestedOrder = {
  id: 'replacement-order-1',
  replacement_code: 'REP-20260730-7006',
  status: 'requested',
  priority: 'normal',
  created_at: '2026-07-30T02:21:40.000Z',
  resolved_client_lot: '940002',
  resolved_general_lot: '26072640',
  route_steps: ['cut', 'edge', 'drill'],
  original_piece: {
    piece_uid: '09950020',
    piece_name: 'PEÇA TESTE 20',
    route_steps: ['cut', 'edge', 'drill'],
  },
};

describe('ReplacementOrderCard', () => {
  it('abre a Rastreabilidade Geral na aba Kanban ao clicar no botão', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/reposicao']}>
        <Routes>
          <Route
            path="/reposicao"
            element={(
              <ReplacementOrderCard
                order={requestedOrder}
                onApprove={vi.fn()}
                onRelease={vi.fn()}
                onComplete={vi.fn()}
                onCancel={vi.fn()}
              />
            )}
          />
          <Route path="/rastreabilidade" element={<TraceabilityDestination />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('link', { name: 'Rastreabilidade' }));

    expect(screen.getByTestId('traceability-destination'))
      .toHaveTextContent('/rastreabilidade?tab=kanban');
  });

  it('exibe Aprovar Reposição e Concluir Forçada para a autoridade permitida', () => {
    render(
      <MemoryRouter>
        <ReplacementOrderCard
          order={requestedOrder}
          onApprove={vi.fn()}
          onRelease={vi.fn()}
          onComplete={vi.fn()}
          onCancel={vi.fn()}
          userPermissions={{
            approve_replacements: true,
            manage_replacements: true,
            force_complete_replacements: true,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Aprovar Reposição' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir Forçada' })).toBeInTheDocument();
  });

  it('não mostra decisões de reposição para operador sem autoridade', () => {
    render(
      <MemoryRouter>
        <ReplacementOrderCard
          order={requestedOrder}
          onApprove={vi.fn()}
          onRelease={vi.fn()}
          onComplete={vi.fn()}
          onCancel={vi.fn()}
          userPermissions={{}}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Aprovar Reposição' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Concluir Forçada' })).not.toBeInTheDocument();
  });
});

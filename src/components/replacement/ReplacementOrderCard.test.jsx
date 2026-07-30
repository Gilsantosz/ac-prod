import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import ReplacementOrderCard from '@/components/replacement/ReplacementOrderCard';

function TraceabilityDestination() {
  const location = useLocation();
  return <div data-testid="traceability-destination">{location.pathname}{location.search}</div>;
}

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
                order={{
                  id: 'replacement-order-1',
                  replacement_code: 'REP-20260730-7006',
                  status: 'requested',
                  priority: 'normal',
                  created_at: '2026-07-30T02:21:40.000Z',
                  resolved_client_lot: '940002',
                  resolved_general_lot: '26072640',
                  original_piece: {
                    piece_uid: '09950020',
                    piece_name: 'PEÇA TESTE 20',
                  },
                }}
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
});

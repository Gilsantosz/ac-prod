import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ClientLotHierarchy,
  StageProgressGrid,
} from '@/components/lot-tracking/LotTrackingCards';

const stages = [
  {
    stage_code: 'cut',
    stage_label: 'Corte',
    required_pieces: 10,
    completed_pieces: 10,
    progress_percent: 100,
    remaining_pieces: 0,
  },
  {
    stage_code: 'drill',
    stage_label: 'Furação',
    required_pieces: 10,
    completed_pieces: 4,
    progress_percent: 40,
    remaining_pieces: 6,
  },
];

const clientLots = [
  {
    lot_id: 'lot-1',
    lot_code: '940001',
    customer_name: 'Cliente Teste',
    total_pieces: 10,
    stages,
  },
  {
    lot_id: 'lot-2',
    lot_code: '940002',
    customer_name: 'Cliente Teste',
    total_pieces: 10,
    stages,
  },
];

function MultiLotHarness() {
  const [expandedLotIds, setExpandedLotIds] = useState([]);

  return (
    <ClientLotHierarchy
      clientLots={clientLots}
      selectedLotIds={expandedLotIds}
      onSelect={(lot) => setExpandedLotIds((current) =>
        current.includes(lot.lot_id)
          ? current.filter((id) => id !== lot.lot_id)
          : [...current, lot.lot_id]
      )}
      renderDetailPanel={(lot) => (
        <div data-testid={`detail-${lot.lot_id}`}>Detalhe {lot.lot_code}</div>
      )}
    />
  );
}

describe('LotTrackingCards', () => {
  it('mantém mais de um lote aberto e fecha somente o lote clicado', async () => {
    const user = userEvent.setup();
    render(<MultiLotHarness />);

    await user.click(screen.getByRole('button', { name: /940001/i }));
    expect(screen.getByTestId('detail-lot-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /940002/i }));
    expect(screen.getByTestId('detail-lot-1')).toBeInTheDocument();
    expect(screen.getByTestId('detail-lot-2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /940001/i }));
    expect(screen.queryByTestId('detail-lot-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-lot-2')).toBeInTheDocument();
  });

  it('exibe Furação como etapa produtiva rastreável', () => {
    render(<StageProgressGrid stages={stages} />);

    expect(screen.getByText('Furação')).toBeInTheDocument();
    expect(screen.getByText('4/10')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });
});

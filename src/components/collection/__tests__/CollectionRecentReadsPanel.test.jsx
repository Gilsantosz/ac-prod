import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionRecentReadsPanel from '../CollectionRecentReadsPanel';
import CollectionPieceDetailPanel from '../CollectionPieceDetailPanel';

const collectionServiceMocks = vi.hoisted(() => ({
  getCollectionHistory: vi.fn(),
  getCollectionHistoryCount: vi.fn(),
  subscribeToCollectionHistory: vi.fn(),
  unsubscribeFromCollectionHistory: vi.fn(),
}));

vi.mock('@/lib/collectionService', () => collectionServiceMocks);

const unresolvedRead = {
  id: 'event-not-found-1',
  event_status: 'not_found',
  traceability_code: 'FECHA',
  raw_value: 'FECHA',
  piece_id: null,
  created_at: '2026-07-27T22:08:00.000Z',
  operator_name: 'Aelio/corte',
  registration: '1111',
  cell_name: 'Corte',
  shift: '1º Turno',
  machine_name: 'Nanshing',
  message: 'Código não localizado no cadastro',
};

function HistoryWithDetail() {
  const [selectedPiece, setSelectedPiece] = useState(null);

  return (
    <div>
      <CollectionRecentReadsPanel
        cellName="Corte"
        workstationId={null}
        operatorId="operator-1"
        shift="1º Turno"
        selectedPiece={selectedPiece}
        onSelectPiece={setSelectedPiece}
        onRejectPiece={vi.fn()}
        onCreateOccurrence={vi.fn()}
        onOpenTraceability={vi.fn()}
      />
      <CollectionPieceDetailPanel piece={selectedPiece} />
    </div>
  );
}

describe('CollectionRecentReadsPanel', () => {
  beforeEach(() => {
    collectionServiceMocks.getCollectionHistory.mockResolvedValue([unresolvedRead]);
    collectionServiceMocks.getCollectionHistoryCount.mockResolvedValue(1);
    collectionServiceMocks.subscribeToCollectionHistory.mockReturnValue({ id: 'channel-test' });
  });

  it('abre com um clique o detalhe de uma coleta não localizada', async () => {
    const user = userEvent.setup();
    render(<HistoryWithDetail />);

    expect(screen.getByText('Nenhuma peça selecionada')).toBeInTheDocument();

    const card = await screen.findByRole('button', { name: 'Abrir detalhes da coleta FECHA' });
    await user.click(card);

    expect(screen.queryByText('Nenhuma peça selecionada')).not.toBeInTheDocument();
    expect(screen.getByText('Coleta registrada sem peça vinculada')).toBeInTheDocument();
    expect(screen.getAllByText('NÃO LOCALIZADA')).toHaveLength(2);
    expect(screen.getAllByText(/Aelio\/corte/)).toHaveLength(2);
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('permite selecionar o card pelo teclado', async () => {
    const user = userEvent.setup();
    render(<HistoryWithDetail />);

    const card = await screen.findByRole('button', { name: 'Abrir detalhes da coleta FECHA' });
    card.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByText('Coleta registrada sem peça vinculada')).toBeInTheDocument();
  });

  it('abre Ocorrência sem disparar a seleção do card', async () => {
    const user = userEvent.setup();
    const onSelectPiece = vi.fn();
    const onCreateOccurrence = vi.fn();

    render(
      <CollectionRecentReadsPanel
        cellName="Corte"
        workstationId={null}
        operatorId="operator-1"
        shift="1º Turno"
        selectedPiece={null}
        onSelectPiece={onSelectPiece}
        onRejectPiece={vi.fn()}
        onCreateOccurrence={onCreateOccurrence}
        onOpenTraceability={vi.fn()}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Ocorrência' }));

    await waitFor(() => expect(onCreateOccurrence).toHaveBeenCalledWith(unresolvedRead));
    expect(onSelectPiece).not.toHaveBeenCalled();
  });
});

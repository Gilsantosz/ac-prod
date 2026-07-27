import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CollectionFullscreenKiosk from '../CollectionFullscreenKiosk';

// Mock dependencies that rely on router or external state
vi.mock('@/components/traceability/TraceabilityScannerPanel', () => ({
  default: () => <div data-testid="mock-scanner-panel">Painel de Bipagem</div>
}));

vi.mock('@/components/collection/CollectionRecentReadsPanel', () => ({
  default: () => <div data-testid="mock-recent-reads-panel">Histórico Recente</div>
}));

vi.mock('@/components/collection/ActiveDowntimeBanner', () => ({
  default: () => <div data-testid="mock-active-downtime-banner">Parada Ativa Banner</div>
}));

describe('CollectionFullscreenKiosk Component', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    cellName: 'Bordo',
    machine: { id: 'm1', name: 'Coladeira SCM' },
    shift: '1º Turno',
    operator: 'Pedro',
    operatorId: 'op1',
    mode: 'scanner',
    setMode: vi.fn(),
    handleRead: vi.fn(),
    feedback: {
      order: { customer_name: 'Cliente Exemplo LTDA' }
    },
    cellStats: {
      expected: 120,
      approved: 85,
      rejected: 3,
      pending: 32,
    },
    currentGeneralLot: {
      general_lot_code: '26072640',
      progress_percent: 70.83,
    },
    currentClientLotCode: 'LOTE-CLI-001',
    activeDowntime: null,
    refetchActiveDowntime: vi.fn(),
    refreshData: vi.fn(),
    onOpenDowntime: vi.fn(),
    selectedPiece: null,
    onSelectPiece: vi.fn(),
    handleOpenRejectModal: vi.fn(),
    handleOpenReadingOccurrence: vi.fn(),
    handleOpenTraceabilityDrawer: vi.fn(),
    refreshReadsSignal: 0,
  };

  it('não renderiza quando open é false', () => {
    render(<CollectionFullscreenKiosk {...defaultProps} open={false} />);
    expect(screen.queryByTestId('collection-fullscreen-kiosk')).not.toBeInTheDocument();
  });

  it('renderiza o modo kiosk em tela cheia com lotes e KPIs operacionais', () => {
    render(<CollectionFullscreenKiosk {...defaultProps} />);

    // Kiosk Container
    expect(screen.getByTestId('collection-fullscreen-kiosk')).toBeInTheDocument();

    // Lotes e progresso geral
    expect(screen.getByText('26072640')).toBeInTheDocument();
    expect(screen.getByText('LOTE-CLI-001')).toBeInTheDocument();
    expect(screen.getByText('Cliente Exemplo LTDA')).toBeInTheDocument();
    expect(screen.getByText('70,8%')).toBeInTheDocument();

    // Os 4 KPIs solicitados
    expect(screen.getByText('120')).toBeInTheDocument(); // Previsto
    expect(screen.getByText('85')).toBeInTheDocument();  // Aprovado
    expect(screen.getByText('3')).toBeInTheDocument();   // Reprovado
    expect(screen.getByText('32')).toBeInTheDocument();  // Pendente

    // Painéis de coleta e histórico recente
    expect(screen.getByTestId('mock-scanner-panel')).toBeInTheDocument();
    expect(screen.getByTestId('mock-recent-reads-panel')).toBeInTheDocument();
  });

  it('permite abrir o modal de parada e fechar o modo kiosk', () => {
    render(<CollectionFullscreenKiosk {...defaultProps} />);

    // Registrar Parada
    const downtimeBtn = screen.getByRole('button', { name: /Parada/i });
    fireEvent.click(downtimeBtn);
    expect(defaultProps.onOpenDowntime).toHaveBeenCalledTimes(1);

    // Sair Tela Cheia
    const closeBtn = screen.getByRole('button', { name: /Sair Tela Cheia/i });
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

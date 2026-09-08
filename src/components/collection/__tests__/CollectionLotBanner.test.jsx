import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CollectionLotBanner from '@/components/collection/CollectionLotBanner';

describe('lotes em ambos os modos da coleta', () => {
  it.each([false, true])('mantém os rótulos visíveis sem dados no modo foco=%s', (focus) => {
    render(<CollectionLotBanner focus={focus} clientLotCode="CLI-001" />);
    expect(screen.getByText('Lote Geral')).toBeInTheDocument();
    expect(screen.getByText('Lote do Cliente')).toBeInTheDocument();
    expect(screen.getByText('CLI-001')).toBeInTheDocument();
    expect(screen.getByText('Aguardando identificação')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it.each([false, true])('exibe os mesmos lotes e progresso informado em foco=%s', (focus) => {
    render(<CollectionLotBanner focus={focus} generalLot={{ general_lot_code: 'GER-001', progress_percent: 70.83 }} clientLotCode="CLI-001" customerName="Cliente A" />);
    expect(screen.getByText('GER-001')).toBeInTheDocument();
    expect(screen.getByText('CLI-001')).toBeInTheDocument();
    expect(screen.getByText('Cliente A')).toBeInTheDocument();
    expect(screen.getByText('70,8%')).toBeInTheDocument();
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionVolumeEntryPanel from '../CollectionVolumeEntryPanel';
import {
  fetchAvailableGeneralLots,
  registerManualQuantitativeEntry,
} from '@/lib/manualProductionService';

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }) => (
    <select
      aria-label="Lote Geral ativo"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Selecione o lote</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));

vi.mock('@/lib/manualProductionService', () => ({
  fetchAvailableGeneralLots: vi.fn(),
  registerManualQuantitativeEntry: vi.fn(),
}));

vi.mock('@/lib/productionStagePolicyService', () => ({
  canonicalProductionStage: () => 'packaging',
  fetchProductionStagePolicies: vi.fn(async () => ([
    { stage_code: 'packaging', manual_quantity_allowed: true },
  ])),
}));

vi.mock('@/config/queryKeys', () => ({
  invalidateAllMesQueries: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const lot = {
  batchId: 'batch-26072640',
  code: '26072640',
  stageProgress: {
    required_pieces: 40,
    effective_completed_pieces: 1,
    remaining_pieces: 39,
  },
};

function renderPanel(props = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <CollectionVolumeEntryPanel
        cellName="Embalagem"
        shift="1º Turno"
        operator="Camila/embalagem"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('CollectionVolumeEntryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAvailableGeneralLots.mockResolvedValue([lot]);
    registerManualQuantitativeEntry.mockResolvedValue({
      success: true,
      quantity: 39,
      remaining_after: 0,
      stage_completed: true,
      batch_completed: false,
      general_lot_code: '26072640',
      cell_name: 'Embalagem',
    });
  });

  it('direciona a quantidade digitada por engano na observação para o campo correto', async () => {
    renderPanel();

    const lotSelect = screen.getByRole('combobox', { name: 'Lote Geral ativo' });
    await screen.findByRole('option', { name: 'Lote 26072640 · saldo 39' });
    fireEvent.change(lotSelect, { target: { value: lot.batchId } });

    const quantity = screen.getByTestId('collection-volume-quantity');
    await waitFor(() => {
      expect(quantity).toHaveFocus();
      expect(screen.getByText('Digite a quantidade produzida entre 1 e 39.')).toBeInTheDocument();
    });

    const notes = screen.getByLabelText('Observação em texto (opcional)');
    fireEvent.change(notes, { target: { value: '39' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O número 39 foi digitado em Observação',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mover para volume' }));

    expect(quantity).toHaveValue(39);
    expect(notes).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Concluir etapa com este volume' })).toBeEnabled();
  });

  it('contabiliza o saldo informado no lote e célula selecionados', async () => {
    const onSuccess = vi.fn();
    renderPanel({ onSuccess });

    const lotSelect = screen.getByRole('combobox', { name: 'Lote Geral ativo' });
    await screen.findByRole('option', { name: 'Lote 26072640 · saldo 39' });
    fireEvent.change(lotSelect, { target: { value: lot.batchId } });
    await screen.findByRole('button', { name: 'Usar saldo 39' });
    fireEvent.click(screen.getByRole('button', { name: 'Usar saldo 39' }));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir etapa com este volume' }));

    await waitFor(() => {
      expect(registerManualQuantitativeEntry).toHaveBeenCalledWith(expect.objectContaining({
        pcp_import_batch_id: 'batch-26072640',
        general_lot_code: '26072640',
        cell_name: 'Embalagem',
        shift: '1º Turno',
        operator: 'Camila/embalagem',
        quantity: 39,
      }));
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('explica por que a contabilização está bloqueada durante uma parada', async () => {
    renderPanel({
      disabled: true,
      disabledReason: 'Parada ativa: Ajuste de setup. Encerre a parada antes de contabilizar o volume.',
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Parada ativa: Ajuste de setup');
    expect(screen.getByRole('button', { name: 'Contabilizar volume produzido' })).toBeDisabled();
  });
});

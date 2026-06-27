import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ManualCompleteEntryForm from '@/components/entry/ManualCompleteEntryForm';
import ManualQuickEntryForm from '@/components/entry/ManualQuickEntryForm';
import { renderWithProviders } from '@/test/utils/renderWithProviders';

const user = { id: 'operator-1', name: 'Operador Teste', role: 'operator', cell: 'Corte' };
const resolvedFields = {
  production_order_id: 'order-1',
  order_id: 'order-1',
  lot_id: 'lot-1',
  order_item_id: 'item-1',
  order_number: '142355',
  lot_code: 'LOTE-142355',
  load_number: '15479',
  customer_trade_name: '3CARRARIAS',
  customer_legal_name: '3 CARRARIAS INDUSTRIA LTDA',
  customer_name: '3CARRARIAS',
  product_code: 'MDF-18',
  product_name: 'Painel MDF 18mm',
  route_name: 'Rota Marcenaria',
  process_step: 'Corte',
  finalization_date: '2026-07-06',
  pallet_number: '10802',
  traceability_status: 'resolved',
};

vi.mock('@/hooks/useCells', () => ({
  useCells: () => ({
    activeCells: [{ id: 'cell-cut', name: 'Corte' }],
    getShiftHours: () => 8,
    getCell: () => ({ id: 'cell-cut', name: 'Corte', notes: '' }),
  }),
}));

vi.mock('@/lib/localDb', () => ({
  base44: { entities: { DailyGoal: { filter: vi.fn().mockResolvedValue([]) } } },
}));

vi.mock('@/lib/productionLookupService', () => ({
  resolveProductionContext: async () => ({
    contextFound: true,
    matchedBy: 'order',
    productionOrder: { id: 'order-1' },
    lot: { id: 'lot-1' },
    item: { id: 'item-1' },
    route: { step_name: 'Corte' },
    warnings: [],
  }),
  productionContextToEntryFields: () => resolvedFields,
}));

async function resolveOrder() {
  fireEvent.change(screen.getByLabelText('Pedido'), { target: { value: '142355' } });
  fireEvent.click(screen.getByRole('button', { name: /buscar contexto/i }));
  await waitFor(() => expect(screen.getByLabelText('Cliente')).toHaveValue('3CARRARIAS'));
}

describe('formulários manuais com contexto produtivo', () => {
  it('resolve e salva o contexto completo no modo rápido', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ManualQuickEntryForm user={user} onSubmit={onSubmit} />);

    await resolveOrder();
    fireEvent.change(document.querySelector('#quick-produced'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar produção/i }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      produced: 12,
      order_number: '142355',
      lot_code: 'LOTE-142355',
      load_number: '15479',
      pallet_number: '10802',
      traceability_status: 'resolved',
    });
  });

  it('usa o mesmo resolvedor e preserva a etapa no modo completo', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<ManualCompleteEntryForm user={user} onSubmit={onSubmit} />);

    await resolveOrder();
    fireEvent.change(document.querySelector('#complete-produced'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /registrar apontamento completo/i }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      produced: 8,
      production_order_id: 'order-1',
      lot_id: 'lot-1',
      product_name: 'Painel MDF 18mm',
      process_step: 'Corte',
      traceability_status: 'resolved',
    });
  });
});

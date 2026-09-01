import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils/renderWithProviders';
import DailySummary from '@/pages/DailySummary';
import {
  fetchDailySummaryYearBounds,
  fetchProductionEntriesRange,
  fetchProductionGoalsRange,
} from '@/lib/dailySummaryData';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Gestor Teste', role: 'manager' } }),
}));

vi.mock('@/hooks/useCells', () => ({
  useCells: () => ({
    activeCells: [
      { id: 'a', name: 'Célula A', active: true },
      { id: 'b', name: 'Célula B', active: true },
    ],
  }),
}));

vi.mock('@/lib/dailySummaryData', () => ({
  fetchDailySummaryYearBounds: vi.fn(),
  fetchProductionEntriesRange: vi.fn(),
  fetchProductionGoalsRange: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/daily/SummaryKpis', () => ({
  default: ({ summary }) => (
    <div data-testid="summary-target">
      {(summary?.totalsByUnit || []).reduce((sum, row) => sum + Number(row.target || 0), 0)}
    </div>
  ),
}));
vi.mock('@/components/daily/SummaryTable', () => ({ default: () => null }));
vi.mock('@/components/daily/DailyProductionMatrix', () => ({ default: () => null }));
vi.mock('@/components/daily/DailySummaryCharts', () => ({ default: () => null }));
vi.mock('@/components/daily/ExportDailyButton', () => ({ default: () => null }));
vi.mock('@/components/daily/CloseShiftButton', () => ({ default: () => null }));

const annualEntries = [
  { id: 'entry-a', date: '2025-01-02', shift: '1º Turno', cell: 'Célula A', produced: 80 },
  { id: 'entry-b', date: '2025-01-02', shift: '1º Turno', cell: 'Célula B', produced: 300 },
];
const annualGoals = [
  { id: 'goal-a-1', date: '2025-01-02', shift: '1º Turno', cell_name: 'Célula A', metric_unit: 'pieces', target: 100 },
  { id: 'goal-a-2', date: '2025-01-03', shift: '1º Turno', cell_name: 'Célula A', metric_unit: 'pieces', target: 150 },
  { id: 'goal-b', date: '2025-01-02', shift: '1º Turno', cell_name: 'Célula B', metric_unit: 'pieces', target: 500 },
];

describe('DailySummary filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    fetchDailySummaryYearBounds.mockResolvedValue({ oldestDate: '2024-01-01', newestDate: '2026-08-23' });
    fetchProductionEntriesRange.mockImplementation(async (fromDate) => (
      fromDate === '2025-01-01' ? annualEntries : []
    ));
    fetchProductionGoalsRange.mockImplementation(async (fromDate) => (
      fromDate === '2025-01-01' ? annualGoals : []
    ));
  });

  it('carrega o ano completo, aplica a célula imediatamente e permite atualizar novamente', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DailySummary />);

    await user.click(screen.getByRole('combobox', { name: 'Ano do resumo' }));
    await user.click(await screen.findByText('Ano completo · 2025'));

    await waitFor(() => {
      expect(fetchProductionEntriesRange).toHaveBeenCalledWith('2025-01-01', '2025-12-31');
      expect(fetchProductionGoalsRange).toHaveBeenCalledWith('2025-01-01', '2025-12-31');
      expect(screen.getByRole('heading', { name: 'Resumo Anual — 2025' })).toBeInTheDocument();
      expect(screen.getByLabelText('Data do resumo')).toBeDisabled();
      expect(screen.getByTestId('summary-target')).toHaveTextContent('750');
    });

    await user.click(screen.getByRole('button', { name: 'Filtrar por célula' }));
    await user.click(await screen.findByText('Célula A'));
    expect(screen.getByTestId('summary-target')).toHaveTextContent('250');

    const callsBeforeRefresh = fetchProductionEntriesRange.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Atualizar dados' }));
    await waitFor(() => expect(fetchProductionEntriesRange.mock.calls.length).toBeGreaterThan(callsBeforeRefresh));
  });
});

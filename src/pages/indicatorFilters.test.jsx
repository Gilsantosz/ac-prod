import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ production: vi.fn(), goals: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/dashboardData', () => ({ fetchDashboardProductionEntries: mocks.production, fetchDashboardDailyGoals: mocks.goals, fetchDashboardYearBounds: async () => ({ oldestDate: '2025-01-01', newestDate: '2026-12-31' }) }));
vi.mock('@/lib/reports/productionReportData', () => ({ fetchProductionReportSnapshot: mocks.report }));
vi.mock('@/hooks/useCells', () => ({ HOURS_KEY: {}, useCells: () => ({ activeCells: [{ name: 'Corte' }, { name: 'Bordo' }, { name: 'Embalagem' }], getCell: () => ({}) }) }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ['light', vi.fn()] }));
vi.mock('@/lib/KioskContext', () => ({ useKiosk: () => ({ kiosk: false, toggleKiosk: vi.fn() }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Teste' } }) }));
vi.mock('@/hooks/useDashboardLayout', () => ({ useDashboardLayout: (order) => ({ order, hidden: [], sizes: {}, ready: true }) }));
vi.mock('@/hooks/usePerformanceAlert', () => ({ usePerformanceAlert: vi.fn() }));
vi.mock('@/hooks/useEfficiencyDropAlert', () => ({ useEfficiencyDropAlert: vi.fn() }));
vi.mock('@/hooks/useLowEfficiencyAlert', () => ({ useLowEfficiencyAlert: () => ({ open: false, alerts: [], dismiss: vi.fn() }) }));
vi.mock('@/components/dashboard/LowEfficiencyAlertModal', () => ({ default: () => null }));
vi.mock('@/components/dashboard/CellReportButton', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DashboardLayoutSettings', () => ({ default: () => null }));
vi.mock('@/components/dashboard/SortablePanels', () => ({ default: ({ panels }) => <div>{panels.map((p) => <section key={p.id} data-testid={p.id}>{p.node}</section>)}</div> }));
vi.mock('@/components/dashboard/GeneralLotProgressPanel', () => ({ default: ({ lotIds }) => <output data-testid="lot-scope">{JSON.stringify(lotIds)}</output> }));
vi.mock('@/components/dashboard/MonthlyGoalTracker', () => ({ default: ({ tracking }) => <output data-testid="monthly-values">{JSON.stringify(tracking)}</output> }));
vi.mock('@/components/dashboard/ExportMenu', () => ({ default: ({ entries }) => <output data-testid="dashboard-export">{JSON.stringify(entries)}</output> }));
vi.mock('@/components/reports/ExportReportMenu', () => ({ default: ({ report, disabled }) => <output data-testid="report-export" data-disabled={disabled}>{JSON.stringify(report?.tables[0].rows || [])}</output> }));
vi.mock('@/components/trend/ExportTrendButton', () => ({ default: () => null }));
// Drawings are replaced with their input data; selectors, React state, queries and calculations are real.
vi.mock('recharts', () => {
  const Chart = ({ data }) => <output data-testid="chart-data">{JSON.stringify(data)}</output>;
  const Empty = () => null;
  return { ResponsiveContainer: ({ children }) => <div>{children}</div>, ComposedChart: Chart, BarChart: Chart, LineChart: Chart,
    Bar: Empty, Line: Empty, XAxis: Empty, YAxis: Empty, Tooltip: Empty, Legend: Empty, CartesianGrid: Empty, ReferenceLine: Empty, Rectangle: Empty };
});

import Dashboard from './Dashboard';
import Reports from './Reports';

const row = (date, cell, produced, shift = '1º Turno', extra = {}) => ({ date, cell, produced, target: produced * 2, shift, hour: '08:00', scrap: 0, downtime: 0, lot_id: `${cell}-${date}-${shift}`, ...extra });
const entries = [row('2026-08-01', 'Corte', 10), row('2026-08-01', 'Corte', 30, '2º Turno'), row('2026-08-01', 'Bordo', 200), row('2026-08-01', 'Embalagem', 50), row('2026-08-02', 'Corte', 90), row('2025-08-01', 'Corte', 7), row('2026-08-01', 'Corte', 999, '1º Turno', { approval_status: 'reversed' })];
const data = (testId) => JSON.parse(screen.getByTestId(testId).textContent);
function mount(Page) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
  return userEvent.setup();
}
async function selectRadix(label, text) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter', code: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: text, exact: true }));
}
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  mocks.production.mockImplementation(async (date, year) => entries.filter(e => year !== 'disabled' ? e.date.startsWith(year) : e.date.slice(0, 7) === date.slice(0, 7)));
  mocks.goals.mockResolvedValue([]);
  mocks.report.mockImplementation(async ({ period, filters = {} }) => ({ period, filters, generatedAt: '2026-09-05T12:00:00Z', comparisonPeriod: null, comparisonEntries: [], entries: entries.filter(e => e.date >= period.from && e.date <= period.to && (!filters.cell || filters.cell === 'all' || e.cell === filters.cell) && (!filters.shift || filters.shift === 'all' || e.shift === filters.shift)) }));
});

describe('filtros conectados aos indicadores e gráficos', () => {
  it('Painel aplica dia, turno, célula, unidade e ano aos gráficos e às exportações', async () => {
    const user = mount(Dashboard);
    fireEvent.change(screen.getByLabelText('Data do painel'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(data('dashboard-export').reduce((s, e) => s + e.produced, 0)).toBe(40));
    expect(data('monthly-values').produced).toBe(40); // não inclui 90 do dia seguinte
    expect(JSON.parse(screen.getByTestId('hourly').querySelector('output').textContent)[0].Produzido).toBe(40);
    await selectRadix('Turno do painel', '1º Turno');
    await waitFor(() => expect(data('dashboard-export').map(e => e.produced)).toEqual([10]));
    await user.click(screen.getByRole('button', { name: 'metros', exact: true }));
    expect(data('dashboard-export').map(e => e.produced)).toEqual([200]);
    expect(data('lot-scope')).toEqual(['Bordo-2026-08-01-1º Turno']);
    expect(screen.getByTestId('realtimeProgress')).toHaveTextContent('200 / 400 metros');
    await selectRadix('Célula do painel', 'Corte');
    expect(data('dashboard-export').map(e => e.produced)).toEqual([10]);
    fireEvent.change(screen.getByLabelText('Data do painel'), { target: { value: '2026-08-02' } });
    await waitFor(() => expect(data('dashboard-export').map(e => e.produced)).toEqual([90]));
    await selectRadix('Filtro de ano', 'Resumo anual · 2025');
    await waitFor(() => expect(data('dashboard-export').map(e => e.produced)).toEqual([7]));
    const annual = JSON.parse(screen.getByTestId('monthlyTracker').querySelector('output').textContent);
    expect(annual.find(m => m.label === 'Ago').produced).toBe(7);
    expect(mocks.goals).toHaveBeenCalledWith('2026-08-02', '2025');
  });

  it('Quiosque aplica a célula escolhida e permite voltar a todas', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    mocks.production.mockResolvedValue(entries.filter(e => e.date === '2026-08-01').map(e => ({ ...e, date: today })));
    mount(() => <Dashboard kioskModeOverride />);
    await waitFor(() => expect(data('lot-scope')).toContain('Corte-2026-08-01-1º Turno'));
    await selectRadix('Célula do quiosque', 'Bordo');
    expect(data('lot-scope')).toEqual(['Bordo-2026-08-01-1º Turno']);
    await selectRadix('Célula do quiosque', 'Todas as células');
    expect(data('lot-scope')).toContain('Corte-2026-08-01-1º Turno');
  });

  it('Relatórios mantém gráficos, tabela e arquivo no recorte e não troca a unidade quando ele está vazio', async () => {
    const user = mount(Reports);
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(data('report-export').map(e => e.produced)).toEqual([10, 30]));
    await user.click(screen.getByRole('button', { name: 'metros', exact: true }));
    expect(data('report-export').map(e => e.produced)).toEqual([200]);
    expect(JSON.parse(screen.getAllByTestId('chart-data')[0].textContent)[0].produced).toBe(200);
    expect(screen.getByRole('table')).toHaveTextContent('Bordo');
    expect(screen.getByRole('table')).not.toHaveTextContent('Corte');
    fireEvent.change(screen.getByLabelText('Turno do relatório'), { target: { value: '2º Turno' } });
    await waitFor(() => expect(data('report-export')).toEqual([]));
    expect(screen.getByRole('button', { name: 'metros', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('chart-data')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-export')).toHaveAttribute('data-disabled', 'true');
    await user.click(await screen.findByRole('button', { name: 'chapas', exact: true }));
    expect(data('report-export').map(e => e.produced)).toEqual([30]);
  });

  it('Tendência recebe os mesmos filtros de célula e turno ao trocar de aba', async () => {
    const user = mount(Reports);
    fireEvent.change(screen.getByLabelText('Célula do relatório'), { target: { value: 'Corte' } });
    fireEvent.change(screen.getByLabelText('Turno do relatório'), { target: { value: '2º Turno' } });
    await user.click(screen.getByRole('tab', { name: 'Tendência' }));
    fireEvent.change(screen.getByLabelText('Mês da tendência'), { target: { value: '2026-08' } });
    await waitFor(() => expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ period: { from: '2026-08-01', to: '2026-08-31' }, filters: { cell: 'Corte', shift: '2º Turno' }, includeComparison: false })));
    await waitFor(() => expect(screen.getAllByTestId('chart-data').length).toBe(2));
    const plotted = JSON.parse(screen.getAllByTestId('chart-data')[1].textContent);
    expect(Object.keys(plotted[0])).toEqual(['day', 'Corte']);
    expect(plotted[0].Corte).toBe(50);
  });
});

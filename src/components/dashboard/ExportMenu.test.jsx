import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExportMenu from './ExportMenu';
import ExportReportMenu from '@/components/reports/ExportReportMenu';

const mocks = vi.hoisted(() => ({
  exportReport: vi.fn(),
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Teste de exportação' } }) }));
vi.mock('@/lib/reports/reportEngine', () => ({ exportReport: mocks.exportReport }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const entry = (id, date, overrides = {}) => ({
  id, date, cell: 'Bordo', shift: '1º Turno', hour: '14:00', metric_unit: 'meters',
  produced: 10, target: 20, scrap: 0, downtime: 0, approval_status: 'valid', ...overrides,
});
const selected = entry('selected', '2026-09-21', { produced: 875 });
const previous = entry('previous', '2026-09-15', { produced: 25 });
const allEntries = [selected, previous,
  entry('too-old', '2026-09-14'), entry('future', '2026-09-22'),
  entry('other-cell', '2026-09-20', { cell: 'Corte', metric_unit: 'sheets' }),
  entry('other-shift', '2026-09-20', { shift: '2º Turno' }),
  entry('other-unit', '2026-09-20', { metric_unit: 'pieces' }),
];
const filters = { date: '2026-09-21', year: 'all', cell: 'Bordo', shift: '1º Turno', metric_unit: 'meters' };
const props = { entries: [selected], allEntries, filters };
const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Exportar' }), { key: 'ArrowDown' });
  return screen.findByRole('menu');
};
const choose = async (groupName, format = 'Excel') => {
  await openMenu();
  fireEvent.click(within(screen.getByRole('group', { name: groupName }))
    .getByRole('menuitem', { name: new RegExp(`^${format}`) }));
};
const exportedRows = (report) => report.tables.find((table) => table.primary).rows;

beforeEach(() => { vi.clearAllMocks(); mocks.exportReport.mockResolvedValue({ filename: 'teste.xlsx' }); });
afterEach(() => vi.restoreAllMocks());

describe('um único botão Exportar no painel', () => {
  it('reúne os dois períodos em um único acionador sem o botão Semana externo', async () => {
    render(<ExportMenu {...props} />);
    expect(screen.getAllByRole('button', { name: 'Exportar' })).toHaveLength(1);
    expect(screen.queryByText('Semana:')).toBeNull();
    await openMenu();
    expect(screen.getByRole('group', { name: /Período selecionado/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Últimos 7 dias/ })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    expect(screen.getByText('15/09/2026 a 21/09/2026')).toBeTruthy();
  });

  it.each([['PDF', 'pdf'], ['Excel', 'xlsx'], ['CSV', 'csv']])('mantém %s para o período selecionado', async (label, format) => {
    render(<ExportMenu {...props} />);
    await choose(/Período selecionado/, label);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledOnce());
    const [report, actualFormat] = mocks.exportReport.mock.calls[0];
    expect(actualFormat).toBe(format);
    expect(report.period).toMatchObject({ from: '2026-09-21', to: '2026-09-21' });
    expect(exportedRows(report).map((row) => row.produced)).toEqual([875]);
  });

  it.each([['PDF', 'pdf'], ['Excel', 'xlsx'], ['CSV', 'csv']])('mantém %s semanal com célula, turno e unidade selecionados', async (label, format) => {
    render(<ExportMenu {...props} />);
    await choose(/Últimos 7 dias/, label);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledOnce());
    const [report, actualFormat] = mocks.exportReport.mock.calls[0];
    expect(actualFormat).toBe(format);
    expect(report.period).toMatchObject({ from: '2026-09-15', to: '2026-09-21' });
    expect(exportedRows(report).map((row) => row.produced).sort((a, b) => a - b)).toEqual([25, 875]);
    expect(report.filters).toMatchObject(filters);
  });

  it('permite exportar a semana quando o dia selecionado não tem dados', async () => {
    render(<ExportMenu {...props} entries={[]} allEntries={[previous]} />);
    expect(screen.getByRole('button', { name: 'Exportar' })).not.toBeDisabled();
    await openMenu();
    const dailyItems = within(screen.getByRole('group', { name: /Período selecionado/ })).getAllByRole('menuitem');
    dailyItems.forEach((item) => expect(item).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(within(screen.getByRole('group', { name: /Últimos 7 dias/ })).getByRole('menuitem', { name: /^Excel/ }));
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledOnce());
  });

  it('desabilita o botão quando nenhum período tem dados no filtro', () => {
    render(<ExportMenu {...props} entries={[]} allEntries={[allEntries[4]]} />);
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
  });

  it('mantém apenas o ano selecionado quando o filtro anual está ativo', async () => {
    render(<ExportMenu {...props} filters={{ ...filters, year: '2026' }} />);
    await choose(/Ano de 2026/);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledOnce());
    expect(mocks.exportReport.mock.calls[0][0].period).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    await openMenu();
    expect(screen.queryByRole('group', { name: /Últimos 7 dias/ })).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('usa os filtros atualizados ao reabrir o menu', async () => {
    const { rerender } = render(<ExportMenu {...props} />);
    rerender(<ExportMenu {...props} entries={[previous]} filters={{ ...filters, date: '2026-09-15' }} />);
    await choose(/Período selecionado/);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledOnce());
    expect(mocks.exportReport.mock.calls[0][0].period).toMatchObject({ from: '2026-09-15', to: '2026-09-15' });
    expect(exportedRows(mocks.exportReport.mock.calls[0][0]).map((row) => row.produced)).toEqual([25]);
  });

  it('compartilha o bloqueio de exportação entre períodos e libera ao terminar', async () => {
    let resolveExport;
    mocks.exportReport.mockImplementation(() => new Promise((resolve) => { resolveExport = resolve; }));
    render(<ExportMenu {...props} />);
    await choose(/Últimos 7 dias/);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
    await act(async () => { resolveExport({ filename: 'semanal.xlsx' }); });
    expect(screen.getByRole('button', { name: 'Exportar' })).not.toBeDisabled();
  });

  it('libera nova tentativa quando o exportador falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.exportReport.mockRejectedValueOnce(new Error('Falha simulada'));
    render(<ExportMenu {...props} />);
    await choose(/Período selecionado/);
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Exportar' })).not.toBeDisabled();
    await choose(/Últimos 7 dias/);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledTimes(2));
  });

  it('preserva a API do menu de um relatório usada nas outras páginas', async () => {
    const report = { id: 'legacy' };
    const onSuccess = vi.fn();
    render(<ExportReportMenu report={report} formats={['xlsx']} onSuccess={onSuccess} />);
    await choose(/Escolha a finalidade/);
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledWith(report, 'xlsx'));
    expect(onSuccess).toHaveBeenCalledWith({ format: 'xlsx', result: { filename: 'teste.xlsx' } });
  });
});

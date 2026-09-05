import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: fromMock },
}));

import {
  DASHBOARD_PRODUCTION_SELECT,
  fetchDashboardProductionEntries,
  fetchDashboardDailyGoals,
} from '@/lib/dashboardData';

function productionQuery(page) {
  const query = {
    select: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: page, error: null }),
  };

  query.select.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.lt.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

describe('dashboardData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carrega somente a projeção necessária e preserva o contrato do dashboard', async () => {
    const query = productionQuery([
      {
        id: 'entry-1',
        date: '2026-08-31',
        cell: 'Corte',
        produced: 10,
        created_at: '2026-08-31T12:00:00Z',
      },
    ]);
    fromMock.mockReturnValue(query);

    const rows = await fetchDashboardProductionEntries('2026-08-31', 'disabled');

    expect(fromMock).toHaveBeenCalledWith('production_entries');
    expect(query.select).toHaveBeenCalledWith(DASHBOARD_PRODUCTION_SELECT);
    expect(DASHBOARD_PRODUCTION_SELECT).not.toContain('*');
    expect(query.gte).toHaveBeenCalledWith('date', '2026-07-25');
    expect(query.lt).toHaveBeenCalledWith('date', '2026-09-02');
    expect(query.range).toHaveBeenCalledWith(0, 999);
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'entry-1',
        created_date: '2026-08-31T12:00:00Z',
      }),
    ]);
  });

  it('mantém os campos usados pelos cálculos, unidades e exportações', () => {
    const fields = new Set(DASHBOARD_PRODUCTION_SELECT.split(','));
    [
      'date', 'shift', 'cell', 'hour', 'produced', 'target', 'scrap',
      'downtime', 'operator', 'approval_status', 'metric_unit',
      'planned_capacity', 'planned_target', 'realized_quantity',
      'sheet_count', 'edge_meters', 'pieces_quantity', 'covers_quantity',
      'notes', 'process_step', 'operation_name', 'route_name', 'source',
      'entry_mode', 'client_event_id', 'metric_name', 'created_at',
    ].forEach((field) => expect(fields.has(field)).toBe(true));
  });

  it('pagina períodos com mais de mil registros sem truncar o dashboard', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `entry-${index}`,
      created_at: '2026-08-31T12:00:00Z',
    }));
    const secondPage = productionQuery([
      { id: 'entry-1000', created_at: '2026-08-31T12:01:00Z' },
    ]);
    const firstQuery = productionQuery(firstPage);
    fromMock
      .mockReturnValueOnce(firstQuery)
      .mockReturnValueOnce(secondPage);

    const rows = await fetchDashboardProductionEntries('2026-08-31', 'disabled');

    expect(firstQuery.range).toHaveBeenCalledWith(0, 999);
    expect(secondPage.range).toHaveBeenCalledWith(1000, 1999);
    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)).toEqual(expect.objectContaining({
      id: 'entry-1000',
      created_date: '2026-08-31T12:01:00Z',
    }));
  });

  it('propaga erros do Supabase sem entregar dados parciais', async () => {
    const query = productionQuery([]);
    query.range.mockResolvedValue({ data: null, error: new Error('query failed') });
    fromMock.mockReturnValue(query);

    await expect(
      fetchDashboardProductionEntries('2026-08-31', 'disabled'),
    ).rejects.toThrow('query failed');
  });
  it('carrega metas do período escolhido em vez de usar somente as 200 mais recentes', async () => {
    const query = productionQuery([{ id: 'goal', date: '2025-08-01', cell: 'Corte', target: 80 }]);
    fromMock.mockReturnValue(query);
    const goals = await fetchDashboardDailyGoals('2026-09-05', '2025');
    expect(fromMock).toHaveBeenCalledWith('daily_goals');
    expect(query.gte).toHaveBeenCalledWith('date', '2025-01-01');
    expect(query.lt).toHaveBeenCalledWith('date', '2026-01-01');
    expect(query.range).toHaveBeenCalledWith(0, 999);
    expect(goals[0].target).toBe(80);
  });

});

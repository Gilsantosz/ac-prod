import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc, from } }));
import { buildLotRuntimeSummary, fetchTraceabilityBoardLots } from '../productionHistoryService';

function query(value) {
  const result = Object.fromEntries(['select', 'in', 'eq', 'or', 'order', 'limit', 'range'].map(name => [name, vi.fn().mockReturnThis()]));
  result.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return result;
}
const lot = { id: 'lot-1', lot_code: 'L1', current_stage: 'cut', planned_quantity: 1700 };
beforeEach(() => { vi.clearAllMocks(); from.mockImplementation(table => query({ data: table === 'production_lots' ? [lot] : [], count: table === 'production_lots' ? 1 : 0, error: null })); });

describe('complete grouped Kanban totals', () => {
  it('preserves every piece, approval evidence and rejected reading beyond the API row cap', () => {
    const groups = [
      { status: 'in_progress', route_steps: ['Corte', 'edge'], completed_steps: [], approved_steps: ['cut'], piece_count: 1200 },
      { status: 'planned', route_steps: ['cut', 'edge'], completed_steps: [], approved_steps: [], piece_count: 500 },
      { status: 'cancelled', route_steps: ['cut'], completed_steps: ['cut'], piece_count: 2 },
    ];
    const runtime = buildLotRuntimeSummary(lot, [], [{ status: 'rejected', step_name: 'cut', reading_count: 7 }], [], [], groups);
    expect(runtime.progress).toMatchObject({ total: 1700, completed: 1200, pending: 500, inProgress: 1200 });
    expect(runtime.routeProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_name: 'cut', total: 1700, collected: 1200, rejected: 7 }),
      expect.objectContaining({ step_name: 'edge', total: 1700, collected: 0 }),
    ]));
  });
  it('loads the summary without downloading raw pieces or readings for modern lots', async () => {
    rpc.mockResolvedValue({ data: { version: 1, piece_count: 1700, groups: [
      { lot_id: lot.id, status: 'planned', route_steps: ['cut'], completed_steps: [], piece_count: 1700 },
    ], rejected: [], latest_approved: [] }, error: null });
    const rows = await fetchTraceabilityBoardLots();
    expect(rows[0].traceability_progress.total).toBe(1700);
    expect(rows[0].production_pieces).toEqual([]);
    expect(from.mock.calls.flat()).not.toContain('production_pieces');
    expect(from.mock.calls.flat()).not.toContain('production_stage_readings');
  });
  it('fails visibly on missing counts or permission errors instead of showing partial totals', async () => {
    rpc.mockResolvedValue({ data: { version: 1, piece_count: 2000, groups: [], rejected: [], latest_approved: [] } });
    await expect(fetchTraceabilityBoardLots()).rejects.toThrow('Resumo incompleto');
    rpc.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    await expect(fetchTraceabilityBoardLots()).rejects.toMatchObject({ code: '42501' });
  });
  it('paginates the complete legacy fallback even when the server caps pages below 500', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    const offsets = [];
    from.mockImplementation(table => {
      if (table !== 'production_pieces') return query({ data: table === 'production_lots' ? [lot] : [], count: table === 'production_lots' ? 1 : 0 });
      const q = query(null); let offset;
      q.range = vi.fn((start) => { offset = start; offsets.push(start); return q; });
      q.then = resolve => resolve({ count: 1001, data: Array.from({ length: Math.min(300, 1001 - offset) }, (_, i) => ({
        id: String(offset + i), lot_id: lot.id, status: 'planned', route_steps: ['cut'], completed_steps: [],
      })) });
      return q;
    });
    const rows = await fetchTraceabilityBoardLots();
    expect(offsets).toEqual([0, 300, 600, 900]);
    expect(rows[0].traceability_progress.total).toBe(1001);
  });
});

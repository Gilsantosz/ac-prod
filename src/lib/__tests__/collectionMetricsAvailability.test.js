import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc, from } }));
vi.mock('@/lib/auditLog', () => ({ auditLog: vi.fn(), AUDIT_ACTIONS: {} }));

describe('collection metrics availability under failures', () => {
  let service;
  beforeEach(async () => {
    vi.resetModules();
    rpc.mockReset();
    from.mockReset();
    service = await import('@/lib/collectionService');
  });
  afterEach(() => vi.useRealTimers());

  it('uses the scoped snapshot and preserves explicit lot filters', async () => {
    rpc.mockResolvedValue({ data: { lot_kpis: { expected: 2113, approved: 725, pending: 1388 }, state_version: 9 } });
    await expect(service.getCollectionKpis({ cellName: ' Corte ', pcpImportBatchId: 'batch', lotId: 'lot' }))
      .resolves.toMatchObject({ expected: 2113, approved: 725, pending: 1388, state_version: 9 });
    expect(rpc).toHaveBeenCalledWith('get_collection_dashboard_snapshot_v2', expect.objectContaining({
      p_cell_name: 'Corte', p_pcp_import_batch_id: 'batch', p_lot_id: 'lot',
    }));
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['42501', '57014', 'PGRST301'])('propagates %s without expensive fallback or fabricated zeros', async (code) => {
    const error = { code, message: 'unavailable' };
    rpc.mockResolvedValue({ data: null, error });
    await expect(service.getCollectionKpis({ cellName: 'Corte' })).rejects.toEqual(error);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  it('backs off only missing RPC discovery and uses server compatibility aggregate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T22:00:00Z'));
    rpc.mockImplementation(async (name) => name === 'get_collection_dashboard_snapshot_v2'
      ? { error: { code: 'PGRST202' } }
      : { data: { expected: 2113, approved: 725 } });
    await service.getCollectionKpis({ cellName: 'Corte' });
    await service.getCollectionKpis({ cellName: 'Corte' });
    expect(rpc.mock.calls.filter(([name]) => name === 'get_collection_dashboard_snapshot_v2')).toHaveLength(1);
    expect(from).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    await service.getCollectionKpis({ cellName: 'Corte' });
    expect(rpc.mock.calls.filter(([name]) => name === 'get_collection_dashboard_snapshot_v2')).toHaveLength(2);
  });

  it('never downloads entire pieces/facts/events when both RPCs are missing', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202' } });
    await expect(service.getCollectionKpis({ cellName: 'Corte' })).rejects.toMatchObject({ code: 'PGRST202' });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects an empty successful response rather than presenting zero', async () => {
    rpc.mockResolvedValue({ data: null });
    await expect(service.getCollectionKpis({ cellName: 'Corte' })).rejects.toMatchObject({ code: 'COLLECTION_METRICS_UNAVAILABLE' });
  });

  it('preserves shift KPI errors for the caller to retain last confirmed values', async () => {
    const error = { code: 'PGRST202' };
    rpc.mockResolvedValue({ data: null, error });
    await expect(service.getOperatorShiftKpisV2('operator')).rejects.toEqual(error);
  });

  it('distinguishes an actual zero-count successful shift response', async () => {
    rpc.mockResolvedValue({ data: { approved: 0, rejected: 0, blocked: 0 } });
    await expect(service.getOperatorShiftKpisV2('operator')).resolves.toMatchObject({ approved: 0, rejected: 0, blocked: 0 });
  });
});

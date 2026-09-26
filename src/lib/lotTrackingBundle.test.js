import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc } }));
import { fetchGeneralLotTracking } from './lotTrackingService';

describe('lot detail request', () => {
  beforeEach(() => rpc.mockReset());
  it('loads route and replacement completion in one authenticated request', async () => {
    rpc.mockResolvedValue({ error: null, data: {
      tracking: { general_lots: [{ batch_id: 'batch-1', general_lot_code: '15587', client_lots: [{lot_id:'lot-1',lot_code:'143352'}] }] },
      route_progress: { batch_id:'batch-1',batch_stages:[{stage_code:'cut',required_pieces:10,completed_pieces:4}],
        lot_stages:{'lot-1':[{stage_code:'cut',required_pieces:10,completed_pieces:4}]} },
      completion_metrics: {batch_summary:{total_operations:10,completed_operations:4,replacement_pending_pieces:1},
        lot_summaries:{'lot-1':{total_operations:10,completed_operations:4,replacement_pending_pieces:1}}},
    }});
    const result=await fetchGeneralLotTracking({batchId:'batch-1',limit:1});
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_general_lot_tracking_bundle_v1',{p_batch_id:'batch-1',p_limit:1});
    expect(result.general_lots[0]).toMatchObject({general_lot_code:'15587',completed_operations:4,replacement_pending_pieces:1});
    expect(result.general_lots[0].client_lots[0]).toMatchObject({lot_code:'143352',completed_operations:4,replacement_pending_pieces:1});
  });
  it('keeps the overview as one lightweight request', async () => {
    rpc.mockResolvedValue({data:{general_lots:[]},error:null});
    await fetchGeneralLotTracking({limit:50});
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_general_lot_tracking',{p_batch_id:null,p_limit:50});
  });
  it('supports a missing migration without masking access failures', async () => {
    rpc.mockResolvedValueOnce({error:{code:'PGRST202'}}).mockResolvedValue({data:null,error:null});
    await fetchGeneralLotTracking({batchId:'batch-1'});
    expect(rpc.mock.calls.map(([name])=>name)).toEqual(['get_general_lot_tracking_bundle_v1',
      'get_general_lot_tracking','get_lot_route_stage_progress','get_lot_route_completion_metrics']);
    rpc.mockReset().mockResolvedValue({error:{code:'42501',message:'denied'}});
    await expect(fetchGeneralLotTracking({batchId:'batch-1'})).rejects.toMatchObject({code:'42501'});
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects an incomplete successful response instead of displaying false empty progress', async () => {
    rpc.mockResolvedValue({data:{tracking:{}},error:null});
    await expect(fetchGeneralLotTracking({batchId:'batch-1'})).rejects.toThrow('Resposta incompleta');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

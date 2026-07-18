import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runOperationalAlertDiagnostics, resolveAlertManually } from '../operationalAlertService';
import { supabase } from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient', () => {
  const fromMock = vi.fn();
  const rpcMock = vi.fn();
  return {
    supabase: {
      from: fromMock,
      rpc: rpcMock,
    },
  };
});

const createMockQueryBuilder = (data) => {
  const builder = Promise.resolve({ data, error: null });
  builder.not = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  builder.gte = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  builder.lte = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  builder.or = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  builder.in = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  builder.eq = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  builder.order = vi.fn().mockImplementation(() => createMockQueryBuilder(data));
  return builder;
};

describe('MES Alert Lifecycle & Diagnostics Unit Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('agrupa pecas paradas pelo mesmo lote geral + lote cliente + etapa', async () => {
    const mockPieces = [
      {
        id: 'p1',
        piece_uid: 'UID1',
        piece_name: 'Peca 1',
        current_stage: 'cut',
        status: 'planned',
        updated_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5h ago (limit is 4h)
        lot_id: 'lot-client-a',
        pcp_import_batch_id: 'lot-general-x',
        manual_joinery: false
      },
      {
        id: 'p2',
        piece_uid: 'UID2',
        piece_name: 'Peca 2',
        current_stage: 'cut',
        status: 'planned',
        updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6h ago (limit is 4h)
        lot_id: 'lot-client-a',
        pcp_import_batch_id: 'lot-general-x',
        manual_joinery: false
      }
    ];

    const mockLots = [
      {
        id: 'lot-client-a',
        lot_code: 'LOT-C-A',
        status: 'in_progress',
        customer_name: 'Cliente A',
        progress_percent: 50,
        pcp_import_batch_id: 'lot-general-x'
      }
    ];

    const mockBatches = [
      {
        id: 'lot-general-x',
        general_lot_code: 'LOT-G-X',
        progress_percent: 40
      }
    ];

    vi.mocked(supabase.from).mockImplementation((table) => {
      let data = [];
      if (table === 'production_pieces') data = mockPieces;
      else if (table === 'production_lots') data = mockLots;
      else if (table === 'promob_import_batches') data = mockBatches;
      else if (table === 'production_collection_events') data = [];
      else if (table === 'production_stage_readings') data = [];
      else if (table === 'rework_orders') data = [];

      return {
        select: vi.fn().mockImplementation(() => createMockQueryBuilder(data)),
      };
    });

    vi.mocked(supabase.rpc).mockResolvedValue({ data: { success: true }, error: null });

    const result = await runOperationalAlertDiagnostics();

    expect(result.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('reconcile_mes_alerts', expect.any(Object));
    
    const rpcArgs = vi.mocked(supabase.rpc).mock.calls[0][1];
    expect(rpcArgs.p_alerts).toHaveLength(1);
    expect(rpcArgs.p_alerts[0].signature).toBe('stuck_pieces_group:lot-general-x:lot-client-a:cut');
    expect(rpcArgs.p_alerts[0].cell).toBe('Corte');
    expect(rpcArgs.p_alerts[0].metadata.piece_count).toBe(2);
    expect(rpcArgs.p_alerts[0].metadata.general_lot_code).toBe('LOT-G-X');
    expect(rpcArgs.p_alerts[0].metadata.client_lot_code).toBe('LOT-C-A');
  });

  it('cria alertas individuais para pecas com manual_joinery = true', async () => {
    // Avançar o tempo para liberar o throttle do diagnóstico
    vi.advanceTimersByTime(15000);

    const mockPieces = [
      {
        id: 'p3',
        piece_uid: 'UID3',
        piece_name: 'Especial 3',
        current_stage: 'joinery',
        status: 'planned',
        updated_at: new Date().toISOString(),
        lot_id: 'lot-client-a',
        pcp_import_batch_id: 'lot-general-x',
        manual_joinery: true,
        manual_joinery_reason: 'Ajuste manual'
      }
    ];

    vi.mocked(supabase.from).mockImplementation((table) => {
      let data = [];
      if (table === 'production_pieces') data = mockPieces;
      return {
        select: vi.fn().mockImplementation(() => createMockQueryBuilder(data)),
      };
    });

    vi.mocked(supabase.rpc).mockResolvedValue({ data: { success: true }, error: null });

    const result = await runOperationalAlertDiagnostics();

    expect(result.success).toBe(true);
    const rpcArgs = vi.mocked(supabase.rpc).mock.calls[0][1];
    expect(rpcArgs.p_alerts).toHaveLength(1);
    expect(rpcArgs.p_alerts[0].signature).toBe('pending_special_piece:p3');
    expect(rpcArgs.p_alerts[0].cell).toBe('Marcenaria');
  });

  it('chama RPC resolve_mes_alert para resolucao manual', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { id: 'alert-123', resolved: true }, error: null });

    const result = await resolveAlertManually('alert-123', 'Obs de resolucao');

    expect(result).toEqual({ id: 'alert-123', resolved: true });
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_mes_alert', {
      p_alert_id: 'alert-123',
      p_resolution_note: 'Obs de resolucao'
    });
  });
});

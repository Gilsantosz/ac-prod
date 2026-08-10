import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc } }));
vi.mock('@/lib/operatorSessionService', () => ({ getDeviceId: () => 'browser-device' }));

import { calculateReplacementAdminSummary, collectReplacementStageV2 } from '@/lib/replacementService';

describe('replacementService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa somente a RPC v2 e preserva o contrato idempotente', async () => {
    rpc.mockResolvedValue({ data: { success: true, result_status: 'approved' }, error: null });

    await collectReplacementStageV2({
      sessionToken: 'token', barcode: 'REP-123', clientEventId: 'event-123',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('collect_replacement_stage_v2', expect.objectContaining({
      p_session_token: 'token', p_barcode: 'REP-123', p_client_event_id: 'event-123',
      p_device_id: 'browser-device',
    }));
  });

  it('não executa fallback quando o servidor bloqueia a leitura', async () => {
    rpc.mockResolvedValue({ data: { success: false, reason_code: 'PREVIOUS_STAGE_PENDING', message: 'Etapa anterior pendente.' }, error: null });

    await expect(collectReplacementStageV2({
      sessionToken: 'token', barcode: 'REP-123', clientEventId: 'event-123',
    })).rejects.toMatchObject({ retryable: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('calcula o resumo administrativo sem inflar concluídas', () => {
    const now = new Date('2026-08-10T10:00:00.000');
    const summary = calculateReplacementAdminSummary([
      { status: 'released', created_at: '2026-08-10T09:00:00.000' },
      { status: 'in_production', created_at: '2026-08-08T09:00:00.000' },
      { status: 'completed', created_at: '2026-08-10T07:00:00.000', completed_at: '2026-08-10T09:30:00.000' },
    ], now);

    expect(summary).toMatchObject({ available: 1, inProduction: 1, delayed: 1, completedThisShift: 1 });
  });
});

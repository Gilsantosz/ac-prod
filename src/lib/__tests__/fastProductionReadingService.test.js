import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { processFastProductionReading } from '@/lib/fastProductionReadingService';

vi.mock('@/lib/operatorSessionService', () => ({
  getOperatorSession: () => ({ token: 'operator-session-token' }),
}));

describe('processFastProductionReading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('faz uma única RPC com o código de 8 dígitos e preserva zero inicial', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, status: 'approved' },
      error: null,
    });

    const result = await processFastProductionReading({
      rawValue: '09950001',
      readerType: 'keyboard_barcode',
      client_event_id: 'event-1',
    });

    expect(result).toEqual({ success: true, status: 'approved' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('process_production_reading', {
      p_payload: expect.objectContaining({
        rawValue: '09950001',
        raw_value: '09950001',
        operatorSessionToken: 'operator-session-token',
        exactDigitCapture: true,
        expectedCodeLength: 8,
        fastPath: true,
      }),
    });
  });

  it('bloqueia leitura incompleta sem chamar o Supabase', async () => {
    const rpc = vi.spyOn(supabase, 'rpc');

    const result = await processFastProductionReading({
      rawValue: '0995000',
      readerType: 'keyboard_barcode',
    });

    expect(result).toMatchObject({
      success: false,
      status: 'invalid',
      reason_code: 'INVALID_CODE_LENGTH',
      expected_code_length: 8,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('bloqueia excesso de dígitos sem truncar', async () => {
    const rpc = vi.spyOn(supabase, 'rpc');

    const result = await processFastProductionReading({
      rawValue: '099500011',
      readerType: 'manual',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/excedeu o limite/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

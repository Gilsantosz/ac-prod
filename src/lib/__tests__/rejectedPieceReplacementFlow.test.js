import { describe, it, expect, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { requestReplacement, completeReplacement } from '../replacementService';
import { rejectPieceFromCollection } from '../collectionService';

describe('rejectedPieceReplacementFlow', () => {
  it('deve registrar reprovação mantendo o histórico de reprovada', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fnName, params) => {
      if (fnName === 'register_quality_rejection') {
        return {
          data: {
            success: true,
            nonconformity_id: 'nc-123',
            nc_code: 'NC-2026-00001',
            occurrence_id: 'occ-123',
            reading_id: 'read-123',
            replacement_order_id: 'repl-123'
          },
          error: null
        };
      }
      return { data: null, error: null };
    });

    const res = await rejectPieceFromCollection({
      traceabilityCode: '09908481',
      pieceId: 'pc-123',
      reason: 'Borda descascada',
      disposition: 'scrap',
      operatorName: 'Aelio'
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.replacement_order_id).toBe('repl-123');

    vi.restoreAllMocks();
  });

  it('deve solicitar reposição e gerar ordem em requested', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fnName, params) => {
      if (fnName === 'request_piece_replacement') {
        return {
          data: {
            success: true,
            replacement_order_id: 'repl-456',
            replacement_code: 'REP-20260725-1001',
            status: 'requested'
          },
          error: null
        };
      }
      return { data: null, error: null };
    });

    const res = await requestReplacement({
      originalPieceId: 'pc-123',
      reason: 'Solicitação manual de reposição',
      priority: 'high'
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.status).toBe('requested');

    vi.restoreAllMocks();
  });

  it('deve dar baixa na reposição atualizando peça original para replaced', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fnName, params) => {
      if (fnName === 'complete_piece_replacement') {
        return {
          data: {
            success: true,
            status: 'completed'
          },
          error: null
        };
      }
      return { data: null, error: null };
    });

    const res = await completeReplacement('repl-456', { notes: 'Baixa concluída' });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.status).toBe('completed');

    vi.restoreAllMocks();
  });
});
